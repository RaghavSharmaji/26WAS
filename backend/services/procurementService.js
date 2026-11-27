const crypto = require('crypto');
const mongoose = require('mongoose');
const Item = require('../model/Item');
const Supplier = require('../model/Supplier');
const Warehouse = require('../model/Warehouse');
const Location = require('../model/Location');
const Pallet = require('../model/Pallets');
const PurchaseOrder = require('../model/PurchaseOrder');
const GoodsReceipt = require('../model/GoodsReceipt');
const Putaway = require('../model/Putaway');

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function validId(value, label) {
  if (!mongoose.Types.ObjectId.isValid(value)) throw httpError(400, `${label} is invalid`);
  return String(value);
}

function integer(value, label, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) throw httpError(400, `${label} must be a whole number of at least ${min}`);
  return value;
}

function idempotencyKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw httpError(400, 'A valid Idempotency-Key header is required');
  }
  return value;
}

function hashRequest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function reference(prefix) {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${prefix}-${day}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function assertWarehouseAccess(req, warehouseId, session) {
  const id = String(warehouseId);
  if (req.tenant?.companyId) {
    if (req.tenant.warehouseScoped && !(req.tenant.allowedWarehouseIds || []).map(String).includes(id)) {
      throw httpError(403, 'You are not assigned to the purchase order warehouse', 'WAREHOUSE_ACCESS_DENIED');
    }
    if (req.tenant.activeWarehouseId && String(req.tenant.activeWarehouseId) !== id) {
      throw httpError(403, 'The purchase order belongs to a different selected warehouse', 'WAREHOUSE_ACCESS_DENIED');
    }
  }
  let query = Warehouse.findOne({ _id: warehouseId, ...(req.tenant?.companyId ? { companyId: req.tenant.companyId } : {}) });
  if (session) query = query.session(session);
  const warehouse = await query.select('_id active').lean().exec();
  if (!warehouse || warehouse.active === false) throw httpError(404, 'An active warehouse in your company was not found');
  return warehouse;
}

async function loadPoLines(lines, session) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) throw httpError(400, 'A purchase order must contain between 1 and 100 product lines');
  const seen = new Set();
  const result = [];
  for (const [index, line] of lines.entries()) {
    const productId = validId(line?.productId, `lines[${index}].productId`);
    if (seen.has(productId)) throw httpError(400, 'A product may only appear once on a purchase order');
    seen.add(productId);
    const orderedQuantity = integer(line.orderedQuantity, `lines[${index}].orderedQuantity`, { min: 1 });
    const unitCost = line.unitCost === undefined ? 0 : Number(line.unitCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw httpError(400, `lines[${index}].unitCost must be zero or greater`);
    let query = Item.findById(productId).select('_id name skuNumber size department').session(session);
    const product = await query.lean().exec();
    if (!product) throw httpError(404, `Product on line ${index + 1} is not available in this company`);
    result.push({
      productId: product._id, skuNumber: product.skuNumber, productName: product.name,
      orderedQuantity, receivedQuantity: 0, unitCost
    });
  }
  return result;
}

function remainingQuantity(line) {
  return Math.max(0, Number(line.orderedQuantity) - Number(line.receivedQuantity || 0));
}

function poStatus(lines) {
  if (lines.every(line => Number(line.receivedQuantity || 0) >= Number(line.orderedQuantity))) return 'completed';
  if (lines.some(line => Number(line.receivedQuantity || 0) > 0)) return 'partially_received';
  return 'submitted';
}

async function createPurchaseOrder({ supplierId, warehouseId, lines, notes = '', userId, req }) {
  validId(supplierId, 'supplierId');
  validId(warehouseId, 'warehouseId');
  if (typeof notes !== 'string' || notes.length > 1000) throw httpError(400, 'notes must be at most 1000 characters');
  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      await assertWarehouseAccess(req, warehouseId, session);
      let supplierQuery = Supplier.findOne({ _id: supplierId, active: { $ne: false } }).session(session);
      const supplier = await supplierQuery.lean().exec();
      if (!supplier) throw httpError(404, 'Active supplier was not found in this company');
      const validatedLines = await loadPoLines(lines, session);
      [created] = await PurchaseOrder.create([{
        warehouseId, supplierId, reference: reference('PO'), status: 'draft', lines: validatedLines,
        notes: notes.trim(), createdBy: userId, revision: 0
      }], { session });
    });
    return created;
  } finally { await session.endSession(); }
}

async function updateDraftPurchaseOrder({ purchaseOrderId, expectedRevision, supplierId, warehouseId, lines, notes = '', req }) {
  validId(purchaseOrderId, 'purchaseOrderId');
  validId(supplierId, 'supplierId');
  validId(warehouseId, 'warehouseId');
  integer(expectedRevision, 'expectedRevision');
  if (typeof notes !== 'string' || notes.length > 1000) throw httpError(400, 'notes must be at most 1000 characters');
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const po = await PurchaseOrder.findById(purchaseOrderId).session(session);
      if (!po) throw httpError(404, 'Purchase order was not found');
      if (po.status !== 'draft') throw httpError(409, 'Only draft purchase orders can be edited');
      if (Number(po.revision || 0) !== expectedRevision) throw httpError(409, 'Purchase order changed; refresh and retry');
      await assertWarehouseAccess(req, warehouseId, session);
      const supplier = await Supplier.findOne({ _id: supplierId, active: { $ne: false } }).session(session).lean().exec();
      if (!supplier) throw httpError(404, 'Active supplier was not found in this company');
      po.warehouseId = warehouseId;
      po.supplierId = supplierId;
      po.lines = await loadPoLines(lines, session);
      po.notes = notes.trim();
      po.revision += 1;
      await po.save({ session });
      updated = po;
    });
    return updated;
  } finally { await session.endSession(); }
}

async function submitPurchaseOrder({ purchaseOrderId, expectedRevision, userId }) {
  validId(purchaseOrderId, 'purchaseOrderId');
  integer(expectedRevision, 'expectedRevision');
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const po = await PurchaseOrder.findById(purchaseOrderId).session(session);
      if (!po) throw httpError(404, 'Purchase order was not found');
      if (po.status !== 'draft') throw httpError(409, 'Only draft purchase orders can be submitted');
      if (Number(po.revision || 0) !== expectedRevision) throw httpError(409, 'Purchase order changed; refresh and retry');
      po.status = 'submitted';
      po.submittedBy = userId;
      po.submittedAt = new Date();
      po.revision += 1;
      await po.save({ session });
      updated = po;
    });
    return updated;
  } finally { await session.endSession(); }
}

function checkIdempotent(existing, expectedHash, label) {
  if (existing.requestHash !== expectedHash) throw httpError(409, `This Idempotency-Key was already used for a different ${label}`, 'IDEMPOTENCY_KEY_CONFLICT');
  return existing;
}

async function recordGoodsReceipt({ purchaseOrderId, expectedRevision, lines, requestKey: rawKey, userId, req }) {
  validId(purchaseOrderId, 'purchaseOrderId');
  integer(expectedRevision, 'expectedRevision');
  const requestKey = idempotencyKey(rawKey);
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) throw httpError(400, 'A receipt must contain between 1 and 100 purchase order lines');
  const seen = new Set();
  const normalized = lines.map((line, index) => {
    const lineId = validId(line?.purchaseOrderLineId, `lines[${index}].purchaseOrderLineId`);
    if (seen.has(lineId)) throw httpError(400, 'A purchase order line may only appear once per receipt');
    seen.add(lineId);
    return { purchaseOrderLineId: lineId, quantity: integer(line.quantity, `lines[${index}].quantity`, { min: 1 }) };
  }).sort((a, b) => a.purchaseOrderLineId.localeCompare(b.purchaseOrderLineId));
  const requestHash = hashRequest({ purchaseOrderId: String(purchaseOrderId), expectedRevision, lines: normalized });
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await GoodsReceipt.findOne({ requestKey }).session(session).lean().exec();
      if (existing) { result = { receipt: checkIdempotent(existing, requestHash, 'goods receipt'), idempotentReplay: true }; return; }
      const po = await PurchaseOrder.findById(purchaseOrderId).session(session);
      if (!po) throw httpError(404, 'Purchase order was not found');
      if (!['submitted', 'partially_received'].includes(po.status)) throw httpError(409, 'Only submitted or partially received purchase orders can receive goods');
      if (Number(po.revision || 0) !== expectedRevision) throw httpError(409, 'Purchase order changed; refresh before receiving');
      await assertWarehouseAccess(req, po.warehouseId, session);
      const receiptLines = [];
      for (const entry of normalized) {
        const poLine = po.lines.find(line => String(line._id) === entry.purchaseOrderLineId);
        if (!poLine) throw httpError(404, 'A purchase order line was not found');
        if (entry.quantity > remainingQuantity(poLine)) throw httpError(409, `Receipt exceeds outstanding quantity for ${poLine.skuNumber}`);
        const item = await Item.findById(poLine.productId).session(session).lean().exec();
        if (!item) throw httpError(404, `Product ${poLine.skuNumber} is no longer available in this company`);
        poLine.receivedQuantity = Number(poLine.receivedQuantity || 0) + entry.quantity;
        receiptLines.push({ poLine, item, quantity: entry.quantity });
      }

      const receiptId = new mongoose.Types.ObjectId();
      const receiptReference = reference('GRN');
      const savedLines = [];
      for (const row of receiptLines) {
        const movement = {
          type: 'receipt', quantity: row.quantity, delta: 0, stockBefore: 0, stockAfter: 0,
          onHandBefore: 0, onHandAfter: row.quantity, quarantinedBefore: 0, quarantinedAfter: 0,
          reason: `Received against ${po.reference}`, responsibleUser: userId,
          referenceType: 'goods_receipt', referenceId: receiptId
        };
        const [holdPallet] = await Pallet.create([{
          item: row.item._id, warehouseId: po.warehouseId, skuNumber: row.item.skuNumber,
          size: Number(row.item.size || 0) * row.quantity, department: row.item.department,
          status: 'receiving', cont: row.quantity, contAvailable: 0, contQuarantined: 0,
          movementLog: [movement]
        }], { session });
        savedLines.push({
          purchaseOrderLineId: row.poLine._id, productId: row.item._id, skuNumber: row.item.skuNumber,
          productName: row.item.name, receivedQuantity: row.quantity, acceptedQuantity: 0,
          rejectedQuantity: 0, damagedQuantity: 0, incorrectQuantity: 0, putawayQuantity: 0,
          receiptPalletId: holdPallet._id
        });
      }
      po.status = poStatus(po.lines);
      po.revision += 1;
      await po.save({ session });
      const [receipt] = await GoodsReceipt.create([{
        _id: receiptId, warehouseId: po.warehouseId, purchaseOrderId: po._id,
        supplierId: po.supplierId, reference: receiptReference, requestKey, requestHash,
        status: 'received', receivedBy: userId, receivedAt: new Date(), lines: savedLines, revision: 0
      }], { session });
      result = { receipt, idempotentReplay: false };
    });
    return result;
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await GoodsReceipt.findOne({ requestKey }).lean().exec();
      if (existing) return { receipt: checkIdempotent(existing, requestHash, 'goods receipt'), idempotentReplay: true };
    }
    throw error;
  } finally { await session.endSession(); }
}

function goodsReceiptStatus(receipt) {
  const allInspected = receipt.lines.every(line => Number(line.acceptedQuantity || 0) + Number(line.rejectedQuantity || 0) === Number(line.receivedQuantity));
  const allPutaway = receipt.lines.every(line => Number(line.putawayQuantity || 0) >= Number(line.acceptedQuantity || 0));
  if (allInspected && allPutaway) return 'completed';
  if (receipt.lines.some(line => Number(line.putawayQuantity || 0) > 0)) return 'partially_putaway';
  if (allInspected) return 'inspected';
  if (receipt.lines.some(line => Number(line.acceptedQuantity || 0) + Number(line.rejectedQuantity || 0) > 0)) return 'partially_inspected';
  return 'received';
}

async function inspectGoodsReceiptLine({ receiptId, lineId, expectedRevision, acceptedQuantity, rejectedQuantity, damagedQuantity = 0, incorrectQuantity = 0, reason, userId }) {
  validId(receiptId, 'receiptId');
  validId(lineId, 'lineId');
  integer(expectedRevision, 'expectedRevision');
  integer(acceptedQuantity, 'acceptedQuantity');
  integer(rejectedQuantity, 'rejectedQuantity');
  integer(damagedQuantity, 'damagedQuantity');
  integer(incorrectQuantity, 'incorrectQuantity');
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) throw httpError(400, 'An inspection reason is required and must be at most 500 characters');
  if (damagedQuantity + incorrectQuantity > rejectedQuantity) throw httpError(400, 'Damaged and incorrect quantities cannot exceed rejected quantity');
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const receipt = await GoodsReceipt.findById(receiptId).session(session);
      if (!receipt) throw httpError(404, 'Goods receipt was not found');
      if (Number(receipt.revision || 0) !== expectedRevision) throw httpError(409, 'Goods receipt changed; refresh and retry');
      const line = receipt.lines.find(entry => String(entry._id) === String(lineId));
      if (!line) throw httpError(404, 'Goods receipt line was not found');
      if (acceptedQuantity < Number(line.acceptedQuantity || 0) || rejectedQuantity < Number(line.rejectedQuantity || 0)
        || damagedQuantity < Number(line.damagedQuantity || 0) || incorrectQuantity < Number(line.incorrectQuantity || 0)) {
        throw httpError(409, 'Inspection totals cannot be reduced; request an authorized correction');
      }
      if (acceptedQuantity + rejectedQuantity > Number(line.receivedQuantity)) {
        throw httpError(409, 'Accepted plus rejected quantities cannot exceed goods received');
      }
      if (acceptedQuantity === Number(line.acceptedQuantity || 0) && rejectedQuantity === Number(line.rejectedQuantity || 0)
        && damagedQuantity === Number(line.damagedQuantity || 0) && incorrectQuantity === Number(line.incorrectQuantity || 0)) {
        throw httpError(400, 'Inspection did not change any quantities');
      }
      const pallet = await Pallet.findById(line.receiptPalletId).session(session);
      if (!pallet || pallet.status !== 'receiving') throw httpError(409, 'Receiving hold pallet is unavailable');
      const previousRejected = Number(line.rejectedQuantity || 0);
      const nextRejected = rejectedQuantity;
      const quarantineDelta = nextRejected - previousRejected;
      if (quarantineDelta > 0) {
        const before = Number(pallet.contQuarantined || 0);
        pallet.contQuarantined = before + quarantineDelta;
        pallet.movementLog.push({
          type: 'quarantine', quantity: quarantineDelta, delta: 0,
          stockBefore: Number(pallet.contAvailable || 0), stockAfter: Number(pallet.contAvailable || 0),
          onHandBefore: Number(pallet.cont || 0), onHandAfter: Number(pallet.cont || 0),
          quarantinedBefore: before, quarantinedAfter: pallet.contQuarantined,
          reason: reason.trim(), responsibleUser: userId,
          referenceType: 'goods_receipt', referenceId: receipt._id
        });
        await pallet.save({ session });
      }
      line.acceptedQuantity = acceptedQuantity;
      line.rejectedQuantity = rejectedQuantity;
      line.damagedQuantity = damagedQuantity;
      line.incorrectQuantity = incorrectQuantity;
      line.inspectionReason = reason.trim();
      line.inspectedBy = userId;
      line.inspectedAt = new Date();
      receipt.revision += 1;
      receipt.status = goodsReceiptStatus(receipt);
      await receipt.save({ session });
      updated = receipt;
    });
    return updated;
  } finally { await session.endSession(); }
}

async function putawayAcceptedQuantity({ receiptId, lineId, expectedRevision, quantity, locationName, requestKey: rawKey, reason = '', userId, req }) {
  validId(receiptId, 'receiptId');
  validId(lineId, 'lineId');
  integer(expectedRevision, 'expectedRevision');
  integer(quantity, 'quantity', { min: 1 });
  const requestKey = idempotencyKey(rawKey);
  if (typeof locationName !== 'string' || !locationName.trim() || locationName.trim().length > 100) throw httpError(400, 'A valid destination location is required');
  if (typeof reason !== 'string' || reason.length > 500) throw httpError(400, 'Putaway reason must be at most 500 characters');
  const normalizedLocation = locationName.trim();
  const requestHash = hashRequest({ receiptId: String(receiptId), lineId: String(lineId), expectedRevision, quantity, locationName: normalizedLocation, reason: reason.trim() });
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await Putaway.findOne({ requestKey }).session(session).lean().exec();
      if (existing) {
        const putaway = checkIdempotent(existing, requestHash, 'putaway request');
        const receipt = await GoodsReceipt.findById(putaway.goodsReceiptId).session(session);
        const destinationPallet = await Pallet.findById(putaway.destinationPalletId).session(session);
        result = { putaway, receipt, destinationPallet, idempotentReplay: true };
        return;
      }
      const receipt = await GoodsReceipt.findById(receiptId).session(session);
      if (!receipt) throw httpError(404, 'Goods receipt was not found');
      if (Number(receipt.revision || 0) !== expectedRevision) throw httpError(409, 'Goods receipt changed; refresh and retry');
      await assertWarehouseAccess(req, receipt.warehouseId, session);
      const line = receipt.lines.find(entry => String(entry._id) === String(lineId));
      if (!line) throw httpError(404, 'Goods receipt line was not found');
      const acceptedOutstanding = Number(line.acceptedQuantity || 0) - Number(line.putawayQuantity || 0);
      if (quantity > acceptedOutstanding) throw httpError(409, 'Putaway quantity exceeds accepted quantity awaiting putaway');
      const source = await Pallet.findById(line.receiptPalletId).session(session);
      if (!source || source.status !== 'receiving') throw httpError(409, 'Receiving hold pallet is unavailable');
      const quarantined = Number(source.contQuarantined || 0);
      if (Number(source.cont || 0) - quarantined < quantity) throw httpError(409, 'Accepted on-hand quantity is insufficient for putaway');
      const product = await Item.findById(line.productId).session(session).lean().exec();
      if (!product) throw httpError(404, 'Product was not found in this company');
      const warehouseId = receipt.warehouseId;
      const location = await Location.findOne({ fullName: normalizedLocation, warehouse: warehouseId }).session(session);
      if (!location) throw httpError(404, 'Destination location was not found in the purchase order warehouse');
      if (!['empty', 'occupied'].includes(location.status)) throw httpError(409, 'Destination location is not available');
      if (location.skuNumber && location.skuNumber !== line.skuNumber) throw httpError(409, 'Destination location is reserved for a different SKU');
      const palletSize = Number(product.size || 0) * quantity;
      if (Number(location.size || 0) + palletSize > Number(location.maxSize || 0)) throw httpError(409, 'Putaway quantity exceeds destination location capacity');

      const sourceOnHandBefore = Number(source.cont || 0);
      const sourceSizeBefore = Number(source.size || 0);
      const sizePerUnit = Number(product.size || 0);
      source.cont = sourceOnHandBefore - quantity;
      source.size = Math.max(0, sourceSizeBefore - palletSize);
      source.movementLog.push({
        type: 'putaway', quantity, delta: 0,
        stockBefore: Number(source.contAvailable || 0), stockAfter: Number(source.contAvailable || 0),
        onHandBefore: sourceOnHandBefore, onHandAfter: source.cont,
        quarantinedBefore: quarantined, quarantinedAfter: quarantined,
        reason: reason.trim() || `Putaway to ${normalizedLocation}`,
        responsibleUser: userId, referenceType: 'goods_receipt', referenceId: receipt._id
      });
      const remainingPhysical = Number(source.cont || 0);
      source.status = remainingPhysical <= quarantined ? (quarantined > 0 ? 'damaged' : 'received') : 'receiving';
      await source.save({ session });

      const newMovement = {
        type: 'stock-in', quantity, delta: quantity, stockBefore: 0, stockAfter: quantity,
        onHandBefore: 0, onHandAfter: quantity, quarantinedBefore: 0, quarantinedAfter: 0,
        reason: reason.trim() || `Putaway from ${receipt.reference}`,
        responsibleUser: userId, referenceType: 'goods_receipt', referenceId: receipt._id
      };
      const [destinationPallet] = await Pallet.create([{
        item: product._id, warehouseId, skuNumber: line.skuNumber,
        size: sizePerUnit * quantity, department: product.department,
        status: 'store', location: normalizedLocation,
        cont: quantity, contAvailable: quantity, contQuarantined: 0, movementLog: [newMovement]
      }], { session });

      location.size = Number(location.size || 0) + palletSize;
      location.skuNumber = line.skuNumber;
      location.department = product.department;
      location.status = 'occupied';
      if (!(location.palletId || []).some(id => String(id) === String(destinationPallet._id))) location.palletId.push(destinationPallet._id);
      await location.save({ session });

      const [putaway] = await Putaway.create([{
        warehouseId, goodsReceiptId: receipt._id, goodsReceiptLineId: line._id, requestKey, requestHash,
        sourcePalletId: source._id, destinationPalletId: destinationPallet._id,
        locationId: location._id, locationName: normalizedLocation, skuNumber: line.skuNumber,
        quantity, completedBy: userId, completedAt: new Date()
      }], { session });
      line.putawayQuantity = Number(line.putawayQuantity || 0) + quantity;
      receipt.revision += 1;
      receipt.status = goodsReceiptStatus(receipt);
      await receipt.save({ session });
      result = { putaway, receipt, destinationPallet, idempotentReplay: false };
    });
    return result;
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await Putaway.findOne({ requestKey }).lean().exec();
      if (existing) {
        const putaway = checkIdempotent(existing, requestHash, 'putaway request');
        const [receipt, destinationPallet] = await Promise.all([
          GoodsReceipt.findById(putaway.goodsReceiptId).lean(),
          Pallet.findById(putaway.destinationPalletId).lean()
        ]);
        return { putaway, receipt, destinationPallet, idempotentReplay: true };
      }
    }
    throw error;
  } finally { await session.endSession(); }
}

module.exports = {
  createPurchaseOrder, updateDraftPurchaseOrder, submitPurchaseOrder,
  recordGoodsReceipt, inspectGoodsReceiptLine, putawayAcceptedQuantity
};

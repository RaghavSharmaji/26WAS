'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');
const Customer = require('../model/Customer');
const Order = require('../model/Order');
const Shipment = require('../model/Shipment');
const Item = require('../model/Item');
const Pallet = require('../model/Pallets');
const Warehouse = require('../model/Warehouse');
const Membership = require('../model/CompanyMembership');
const User = require('../model/User');
const Company = require('../model/Company');
const AuditLog = require('../model/AuditLog');
const InventoryOperation = require('../model/InventoryOperation');
const { availableQuantity } = require('./inventoryBalance');
const { runWithAuth } = require('../middleware/requestContext');

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function validId(value, name) {
  if (!mongoose.Types.ObjectId.isValid(value)) throw fail(400, `${name} is invalid`);
  return String(value);
}

function integer(value, name, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw fail(400, `${name} must be a whole number of at least ${min}`);
  return value;
}

function key(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw fail(400, 'A valid Idempotency-Key header is required');
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function scopedKey(operation, raw) {
  return `${operation}:${crypto.createHash('sha256').update(raw).digest('hex')}`;
}

function context(req) {
  if (!req?.auth?.id || !req?.tenant) throw fail(403, 'Verified company context is required');
  if (req.auth.role === 'super_admin' || req.auth.role === 'superadmin') throw fail(403, 'Platform administrators cannot perform company operations');
  return req.tenantAuth || { ...req.auth, ...req.tenant };
}

async function transaction(req, callback) {
  const session = await mongoose.startSession();
  try {
    let result;
    await runWithAuth(context(req), () => session.withTransaction(async () => {
      if (req.tenant.companyId) {
        const company = await Company.findOne({ _id: req.tenant.companyId, status: 'active' }).session(session).select('_id').lean().exec();
        const membership = await Membership.findOne({
          _id: req.tenant.membershipId, userId: req.auth.id,
          companyId: req.tenant.companyId, status: 'active'
        }).session(session).lean().exec();
        const revision = Number.isSafeInteger(membership?.revision) ? membership.revision : 0;
        if (!company || !membership || membership.role !== req.tenant.membershipRole
          || revision !== Number(req.tenant.membershipRevision || 0)) {
          throw fail(403, 'Active company authorization changed; refresh and retry', 'TENANT_AUTHORIZATION_STALE');
        }
      }
      result = await callback(session);
    }));
    return result;
  } finally {
    await session.endSession();
  }
}

function assertWarehouseInMembership(req, warehouseId) {
  const tenant = req.tenant;
  if (tenant.companyId && tenant.membershipRole !== 'company_admin'
    && !(tenant.allowedWarehouseIds || []).some(id => String(id) === String(warehouseId))) {
    throw fail(403, 'You are not assigned to this warehouse', 'WAREHOUSE_ACCESS_DENIED');
  }
  if (tenant.activeWarehouseId && String(tenant.activeWarehouseId) !== String(warehouseId)) {
    throw fail(403, 'The order warehouse differs from the selected warehouse', 'WAREHOUSE_ACCESS_DENIED');
  }
}

async function assertWarehouse(req, warehouseId, session) {
  validId(warehouseId, 'warehouseId');
  assertWarehouseInMembership(req, warehouseId);
  const warehouse = await Warehouse.findOne({ _id: warehouseId, active: { $ne: false } }).session(session).select('_id').lean().exec();
  if (!warehouse) throw fail(404, 'Active warehouse was not found in this tenant');
  return warehouse;
}

function audit(req, session, action, warehouseId, details) {
  return AuditLog.create([{
    companyId: req.tenant.companyId || null,
    warehouseId: warehouseId || null,
    actor: req.auth.id,
    action,
    details
  }], { session });
}

async function createCustomer(req, body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 160) throw fail(400, 'Customer name must be 2 to 160 characters');
  const data = {
    name,
    contactPerson: String(body.contactPerson || '').trim(),
    phone: String(body.phone || '').trim(),
    email: String(body.email || '').trim().toLowerCase(),
    address: String(body.address || '').trim(),
    active: body.active === undefined ? true : body.active
  };
  if (typeof data.active !== 'boolean') throw fail(400, 'active must be a boolean');
  for (const field of ['contactPerson', 'phone', 'email', 'address']) {
    const limit = { contactPerson: 160, phone: 40, email: 254, address: 1000 }[field];
    if (data[field].length > limit) throw fail(400, `${field} is too long`);
  }
  return transaction(req, async session => {
    const customer = new Customer(data);
    await customer.save({ session });
    await audit(req, session, 'outbound.customer-created', null, { customerId: String(customer._id) });
    return customer;
  });
}

async function updateCustomer(req, customerId, body) {
  validId(customerId, 'customerId');
  const allowed = ['name', 'contactPerson', 'phone', 'email', 'address', 'active'];
  if (Object.keys(body).some(field => !allowed.includes(field))) throw fail(400, 'Customer update contains unsupported fields');
  return transaction(req, async session => {
    const customer = await Customer.findById(customerId).session(session);
    if (!customer) throw fail(404, 'Customer was not found');
    for (const [field, value] of Object.entries(body)) {
      if (field === 'active') {
        if (typeof value !== 'boolean') throw fail(400, 'active must be a boolean');
        customer.active = value;
      } else {
        if (typeof value !== 'string') throw fail(400, `${field} must be text`);
        customer[field] = value.trim();
      }
    }
    await customer.save({ session });
    await audit(req, session, 'outbound.customer-updated', null, { customerId: String(customer._id), fields: Object.keys(body) });
    return customer;
  });
}

async function createOrder(req, body) {
  const customerId = validId(body.customerId, 'customerId');
  const warehouseId = validId(body.warehouseId || req.tenant.activeWarehouseId, 'warehouseId');
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) throw fail(400, 'An order must contain 1 to 100 product lines');
  const lines = body.lines.map((line, i) => ({
    productId: validId(line.productId, `lines[${i}].productId`),
    orderedQuantity: integer(line.quantity, `lines[${i}].quantity`, 1)
  }));
  const expectedDeliveryAt = body.expectedDeliveryAt ? new Date(body.expectedDeliveryAt) : null;
  if (expectedDeliveryAt && Number.isNaN(expectedDeliveryAt.getTime())) throw fail(400, 'expectedDeliveryAt is invalid');
  const notes = String(body.notes || '').trim();
  if (notes.length > 1000) throw fail(400, 'notes must be at most 1000 characters');

  return transaction(req, async session => {
    await assertWarehouse(req, warehouseId, session);
    const customer = await Customer.findOne({ _id: customerId, active: true }).session(session).lean().exec();
    if (!customer) throw fail(404, 'Active customer was not found in this company');
    const orderLines = [];
    for (const line of lines) {
      const product = await Item.findById(line.productId).session(session).lean().exec();
      if (!product) throw fail(404, 'A product was not found in this company');
      if (orderLines.some(existing => String(existing.productId) === String(product._id))) throw fail(400, 'Each product may appear only once in an order');
      orderLines.push({
        productId: product._id, skuNumber: product.skuNumber, productName: product.name,
        orderedQuantity: line.orderedQuantity, reservedQuantity: 0, pickedQuantity: 0, packedQuantity: 0, allocations: []
      });
    }
    const _id = new mongoose.Types.ObjectId();
    const order = new Order({
      _id, reference: `SO-${_id.toString().toUpperCase()}`, customerId, warehouseId,
      lines: orderLines, status: 'draft', expectedDeliveryAt, notes, date: new Date(), revision: 0
    });
    await order.save({ session });
    await audit(req, session, 'outbound.order-created', warehouseId, { orderId: String(order._id), reference: order.reference });
    return order;
  });
}

async function updateDraftOrder(req, orderId, body) {
  validId(orderId, 'orderId');
  integer(body.expectedRevision, 'expectedRevision');
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) throw fail(400, 'An order must contain 1 to 100 product lines');
  return transaction(req, async session => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw fail(404, 'Order was not found');
    if (order.status !== 'draft') throw fail(409, 'Only draft orders can be edited');
    if (order.revision !== body.expectedRevision) throw fail(409, 'Order changed; refresh and retry');
    const customerId = validId(body.customerId, 'customerId');
    const warehouseId = validId(body.warehouseId, 'warehouseId');
    await assertWarehouse(req, warehouseId, session);
    if (!await Customer.findOne({ _id: customerId, active: true }).session(session).lean().exec()) throw fail(404, 'Active customer was not found in this company');
    const lines = [];
    for (const [i, submitted] of body.lines.entries()) {
      const productId = validId(submitted.productId, `lines[${i}].productId`);
      const quantity = integer(submitted.quantity, `lines[${i}].quantity`, 1);
      const product = await Item.findById(productId).session(session).lean().exec();
      if (!product) throw fail(404, 'A product was not found in this company');
      if (lines.some(row => String(row.productId) === String(product._id))) throw fail(400, 'Each product may appear only once in an order');
      lines.push({ productId, skuNumber: product.skuNumber, productName: product.name, orderedQuantity: quantity, reservedQuantity: 0, pickedQuantity: 0, packedQuantity: 0, allocations: [] });
    }
    order.customerId = customerId;
    order.warehouseId = warehouseId;
    order.lines = lines;
    order.expectedDeliveryAt = body.expectedDeliveryAt ? new Date(body.expectedDeliveryAt) : null;
    if (order.expectedDeliveryAt && Number.isNaN(order.expectedDeliveryAt.getTime())) throw fail(400, 'expectedDeliveryAt is invalid');
    order.notes = String(body.notes || '').trim();
    if (order.notes.length > 1000) throw fail(400, 'notes must be at most 1000 characters');
    order.revision += 1;
    await order.save({ session });
    await audit(req, session, 'outbound.order-updated', warehouseId, {
      orderId: String(order._id), revision: order.revision
    });
    return order;
  });
}

async function submitOrder(req, orderId, expectedRevision) {
  validId(orderId, 'orderId'); integer(expectedRevision, 'expectedRevision');
  return transaction(req, async session => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw fail(404, 'Order was not found');
    if (order.status !== 'draft') throw fail(409, 'Only draft orders can be submitted');
    if (order.revision !== expectedRevision) throw fail(409, 'Order changed; refresh and retry');
    await assertWarehouse(req, order.warehouseId, session);
    order.status = 'submitted'; order.revision += 1; await order.save({ session });
    await audit(req, session, 'outbound.order-submitted', order.warehouseId, { orderId: String(order._id) });
    return order;
  });
}

function makeMovement(pallet, { type, quantity, deltaAvailable = 0, onHandDelta = 0, reason, userId, orderId }) {
  const beforeAvailable = availableQuantity(pallet);
  const beforeOnHand = Number(pallet.cont || 0);
  return {
    _id: new mongoose.Types.ObjectId(), type, quantity: Math.abs(quantity ?? (deltaAvailable || onHandDelta)),
    delta: deltaAvailable, stockBefore: beforeAvailable, stockAfter: beforeAvailable + deltaAvailable,
    onHandBefore: beforeOnHand, onHandAfter: beforeOnHand + onHandDelta,
    quarantinedBefore: Number(pallet.contQuarantined || 0), quarantinedAfter: Number(pallet.contQuarantined || 0),
    reason, responsibleUser: userId, referenceType: 'order', referenceId: orderId, createdAt: new Date()
  };
}

function snapshotCondition(field, value) {
  return value === undefined || value === null
    ? { $or: [{ [field]: { $exists: false } }, { [field]: null }] }
    : { [field]: value };
}

async function updatePallet(pallet, { setAvailable, inc, movement, session, requireOnHandAtLeast }) {
  const conditions = [
    { _id: pallet._id },
    snapshotCondition('contAvailable', pallet.contAvailable),
    snapshotCondition('contReserved', pallet.contReserved),
    snapshotCondition('contPicked', pallet.contPicked)
  ];
  if (pallet.__v !== undefined) conditions.push({ __v: pallet.__v });
  if (requireOnHandAtLeast != null) conditions.push({ cont: { $gte: requireOnHandAtLeast } });
  const update = { $inc: { __v: 1, ...inc }, $push: { movementLog: movement } };
  if (setAvailable != null) update.$set = { contAvailable: setAvailable };
  const updated = await Pallet.findOneAndUpdate({ $and: conditions }, update, {
    new: true, runValidators: true, context: 'query', session
  }).session(session).lean().exec();
  if (!updated) throw fail(409, 'Inventory changed concurrently; retry the order action');
  return updated;
}

async function recordOperation(req, session, { type, rawKey, requestHash, order, quantity, movements }) {
  const requestKey = scopedKey(type, rawKey);
  const [record] = await InventoryOperation.create([{
    requestKey, requestHash, type, orderId: order._id, skuNumber: `ORDER-${order.reference}`,
    quantity, movements
  }], { session });
  return record;
}

async function findOperation(req, requestKey, session) {
  return InventoryOperation.findOne({ requestKey }).session(session).lean().exec();
}

async function reserveOrder(req, orderId, { expectedRevision, requestKey: rawKey }) {
  validId(orderId, 'orderId'); integer(expectedRevision, 'expectedRevision'); key(rawKey);
  const requestKey = scopedKey('order-reservation', rawKey);
  const requestHash = hash({ orderId: String(orderId), expectedRevision, operation: 'reserve' });
  try { return await transaction(req, async session => {
    const previous = await findOperation(req, requestKey, session);
    if (previous) {
      if (previous.requestHash !== requestHash) throw fail(409, 'Idempotency-Key was used for a different reservation', 'IDEMPOTENCY_KEY_CONFLICT');
      const replayOrder = await Order.findById(orderId).session(session).lean().exec();
      return { order: replayOrder, idempotentReplay: true };
    }
    const order = await Order.findById(orderId).session(session);
    if (!order) throw fail(404, 'Order was not found');
    if (!['submitted', 'partially_reserved'].includes(order.status)) throw fail(409, 'Only submitted or partially reserved orders can reserve stock');
    if (order.revision !== expectedRevision) throw fail(409, 'Order changed; refresh and retry');
    await assertWarehouse(req, order.warehouseId, session);
    const operationMovements = [];
    let totalReserved = 0;
    for (const line of order.lines) {
      let need = Number(line.orderedQuantity) - Number(line.reservedQuantity || 0);
      if (need <= 0) continue;
      const pallets = await Pallet.find({ skuNumber: line.skuNumber, warehouseId: order.warehouseId, status: { $nin: ['receiving', 'damaged'] } })
        .sort({ date: 1, _id: 1 }).session(session).lean().exec();
      for (const pallet of pallets) {
        if (!need) break;
        const take = Math.min(need, availableQuantity(pallet));
        if (take <= 0) continue;
        const movement = makeMovement(pallet, { type: 'reserve', deltaAvailable: -take, reason: `Reserved for ${order.reference}`, userId: req.auth.id, orderId: order._id });
        const updated = await updatePallet(pallet, {
          setAvailable: availableQuantity(pallet) - take,
          inc: { contReserved: take }, movement, session
        });
        const allocation = line.allocations.find(row => String(row.palletId) === String(pallet._id));
        if (allocation) allocation.reservedQuantity += take;
        else line.allocations.push({ palletId: pallet._id, reservedQuantity: take, pickedQuantity: 0, dispatchedQuantity: 0 });
        operationMovements.push({ palletId: updated._id, quantity: take, movementId: movement._id, stockBefore: movement.stockBefore, stockAfter: movement.stockAfter });
        line.reservedQuantity = Number(line.reservedQuantity || 0) + take;
        totalReserved += take;
        need -= take;
      }
    }
    const completelyReserved = order.lines.every(line => Number(line.reservedQuantity || 0) >= Number(line.orderedQuantity));
    if (totalReserved === 0) throw fail(409, 'No available inventory could be reserved');
    order.status = completelyReserved ? 'reserved' : totalReserved || order.lines.some(line => line.reservedQuantity) ? 'partially_reserved' : 'submitted';
    order.revision += 1;
    await order.save({ session });
    await recordOperation(req, session, { type: 'order-reservation', rawKey, requestHash, order, quantity: totalReserved, movements: operationMovements });
    await audit(req, session, 'outbound.stock-reserved', order.warehouseId, { orderId: String(order._id), quantity: totalReserved, status: order.status });
    return { order, idempotentReplay: false };
  }); } catch (error) {
    if (error?.code === 11000) {
      const previous = await runWithAuth(context(req), () => InventoryOperation.findOne({ requestKey }).lean().exec());
      if (previous) {
        if (previous.requestHash !== requestHash) throw fail(409, 'Idempotency-Key was used for a different reservation', 'IDEMPOTENCY_KEY_CONFLICT');
        const order = await runWithAuth(context(req), () => Order.findById(orderId).lean().exec());
        return { order, idempotentReplay: true };
      }
    }
    throw error;
  }
}

async function assignPicker(req, orderId, { userId, expectedRevision }) {
  validId(orderId, 'orderId'); validId(userId, 'userId'); integer(expectedRevision, 'expectedRevision');
  return transaction(req, async session => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw fail(404, 'Order was not found');
    if (!['reserved', 'partially_reserved', 'picking'].includes(order.status)) throw fail(409, 'Order is not ready for picking');
    if (order.revision !== expectedRevision) throw fail(409, 'Order changed; refresh and retry');
    await assertWarehouse(req, order.warehouseId, session);
    const picker = await User.findById(userId).session(session).select('_id accountStatus deletedAt').lean().exec();
    if (!picker || picker.accountStatus === 'inactive' || picker.accountStatus === 'deleted' || picker.deletedAt) throw fail(400, 'Picker account is inactive or unavailable');
    const membership = req.tenant.companyId ? await Membership.findOne({ userId, companyId: req.tenant.companyId, status: 'active' }).session(session).lean().exec() : null;
    if (req.tenant.companyId && (!membership || !['company_admin', 'warehouse_manager', 'warehouse_staff', 'staff'].includes(membership.role)
      || (membership.role !== 'company_admin' && !(membership.assignedWarehouseIds || []).some(id => String(id) === String(order.warehouseId))))) {
      throw fail(400, 'Picker must be an active member assigned to the order warehouse');
    }
    if (!req.tenant.companyId && String(userId) !== String(req.auth.id)) throw fail(400, 'Legacy accounts may only assign their own picking work');
    order.assignedPickerId = userId; order.revision += 1; await order.save({ session });
    await audit(req, session, 'outbound.picker-assigned', order.warehouseId, { orderId: String(order._id), pickerId: String(userId) });
    return order;
  });
}

async function listPickers(req, warehouseId) {
  if (!req.tenant?.companyId) return [];
  if (warehouseId) assertWarehouseInMembership(req, warehouseId);
  const filter = { companyId: req.tenant.companyId, status: 'active' };
  if (warehouseId) filter.$or = [{ role: 'company_admin' }, { assignedWarehouseIds: { $in: [warehouseId] } }];
  const memberships = await Membership.find(filter).select('userId role assignedWarehouseIds').lean().exec();
  const eligible = memberships.filter(row => ['company_admin', 'warehouse_manager', 'warehouse_staff', 'staff'].includes(row.role));
  const users = await User.find({ _id: { $in: eligible.map(row => row.userId) }, accountStatus: 'active', deletedAt: null })
    .select('_id name email').sort({ name: 1 }).lean().exec();
  return users;
}

async function confirmPicking(req, orderId, { expectedRevision, lines, complete = true }) {
  validId(orderId, 'orderId'); integer(expectedRevision, 'expectedRevision');
  if (typeof complete !== 'boolean' || !Array.isArray(lines)) throw fail(400, 'lines and a boolean complete value are required');
  return transaction(req, async session => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw fail(404, 'Order was not found');
    if (!['reserved', 'partially_reserved', 'picking'].includes(order.status)) throw fail(409, 'Order is not open for picking');
    if (order.revision !== expectedRevision) throw fail(409, 'Order changed; refresh and retry');
    if (order.assignedPickerId && String(order.assignedPickerId) !== String(req.auth.id)
      && !['company_admin', 'warehouse_manager'].includes(req.tenant.membershipRole)) throw fail(403, 'This pick task is assigned to another employee');
    await assertWarehouse(req, order.warehouseId, session);
    const submitted = new Map();
    for (const row of lines) {
      const lineId = validId(row.orderLineId, 'orderLineId');
      if (submitted.has(lineId)) throw fail(400, 'An order line may only be submitted once');
      submitted.set(lineId, integer(row.pickedQuantity, 'pickedQuantity'));
    }
    if (submitted.size !== order.lines.length || order.lines.some(line => !submitted.has(String(line._id)))) {
      throw fail(400, 'Picking confirmation must include every order line exactly once');
    }
    for (const line of order.lines) {
      const target = submitted.has(String(line._id)) ? submitted.get(String(line._id)) : Number(line.pickedQuantity || 0);
      if (target < Number(line.pickedQuantity || 0) || target > Number(line.reservedQuantity || 0)) throw fail(409, `Picked quantity for ${line.skuNumber} must be between the existing pick and reserved quantity`);
      let remaining = target - Number(line.pickedQuantity || 0);
      for (const allocation of line.allocations) {
        if (!remaining) break;
        const capacity = Number(allocation.reservedQuantity || 0) - Number(allocation.pickedQuantity || 0);
        const take = Math.min(remaining, capacity);
        if (!take) continue;
        const pallet = await Pallet.findById(allocation.palletId).session(session).lean().exec();
        if (!pallet) throw fail(409, 'A reserved pallet is no longer available');
        const movement = makeMovement(pallet, { type: 'pick', quantity: take, reason: `Picked for ${order.reference}`, userId: req.auth.id, orderId: order._id });
        await updatePallet(pallet, { inc: { contReserved: -take, contPicked: take }, movement, session });
        allocation.pickedQuantity = Number(allocation.pickedQuantity || 0) + take;
        remaining -= take;
      }
      if (remaining) throw fail(409, 'Reserved pallet allocation changed; retry picking');
      line.pickedQuantity = target;
    }
    const allLinesReported = order.lines.every(line => Number(line.pickedQuantity || 0) === Number(line.reservedQuantity || 0));
    if (complete || allLinesReported) {
      // Any reserved quantity not picked is released to available stock as a short pick.
      for (const line of order.lines) {
        let unpicked = Number(line.reservedQuantity || 0) - Number(line.pickedQuantity || 0);
        for (const allocation of line.allocations) {
          if (!unpicked) break;
          const quantity = Math.min(unpicked, Number(allocation.reservedQuantity || 0) - Number(allocation.pickedQuantity || 0));
          if (!quantity) continue;
          const pallet = await Pallet.findById(allocation.palletId).session(session).lean().exec();
          if (!pallet) throw fail(409, 'A reserved pallet is no longer available');
          const movement = makeMovement(pallet, { type: 'release', deltaAvailable: quantity, reason: `Short pick released for ${order.reference}`, userId: req.auth.id, orderId: order._id });
          await updatePallet(pallet, { setAvailable: availableQuantity(pallet) + quantity, inc: { contReserved: -quantity }, movement, session });
          allocation.reservedQuantity -= quantity;
          unpicked -= quantity;
        }
        line.reservedQuantity = Number(line.pickedQuantity || 0);
      }
      order.status = 'picked';
    } else order.status = 'picking';
    order.revision += 1; await order.save({ session });
    await audit(req, session, 'outbound.picking-confirmed', order.warehouseId, { orderId: String(order._id), complete: order.status === 'picked' });
    return order;
  });
}

async function packOrder(req, orderId, { expectedRevision, packages, requestKey: rawKey }) {
  validId(orderId, 'orderId'); integer(expectedRevision, 'expectedRevision'); key(rawKey);
  if (!Array.isArray(packages) || packages.length < 1 || packages.length > 100) throw fail(400, 'Provide 1 to 100 packages');
  const normalized = packages.map((pkg, index) => {
    if (!Array.isArray(pkg.lines) || pkg.lines.length < 1) throw fail(400, `Package ${index + 1} must contain at least one line`);
    const weight = pkg.weight == null || pkg.weight === '' ? null : Number(pkg.weight);
    if (weight !== null && (!Number.isFinite(weight) || weight < 0)) throw fail(400, 'Package weight must be a non-negative number');
    return { weight, notes: String(pkg.notes || '').trim(), lines: pkg.lines.map(row => ({ orderLineId: validId(row.orderLineId, 'orderLineId'), quantity: integer(row.quantity, 'package quantity', 1) })) };
  });
  const requestHash = hash(normalized);
  return transaction(req, async session => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw fail(404, 'Order was not found');
    if (order.packingKey === rawKey) {
      if (order.packingHash !== requestHash) throw fail(409, 'Idempotency-Key was reused for different packing', 'IDEMPOTENCY_KEY_CONFLICT');
      return { order, idempotentReplay: true };
    }
    if (!['picked', 'packing'].includes(order.status)) throw fail(409, 'Only picked orders can be packed');
    if (order.revision !== expectedRevision) throw fail(409, 'Order changed; refresh and retry');
    await assertWarehouse(req, order.warehouseId, session);
    const totals = new Map();
    for (const pkg of normalized) for (const line of pkg.lines) totals.set(line.orderLineId, (totals.get(line.orderLineId) || 0) + line.quantity);
    if (totals.size !== order.lines.length) throw fail(400, 'Every picked product line must be included in packages');
    for (const line of order.lines) {
      if ((totals.get(String(line._id)) || 0) !== Number(line.pickedQuantity || 0)) throw fail(409, `Packed quantity must equal picked quantity for ${line.skuNumber}`);
      line.packedQuantity = Number(line.pickedQuantity || 0);
    }
    order.packages = normalized.map((pkg, index) => ({
      packageNumber: index + 1, weight: pkg.weight, notes: pkg.notes,
      lines: pkg.lines.map(row => {
        const line = order.lines.find(entry => String(entry._id) === row.orderLineId);
        if (!line) throw fail(404, 'A package references a product line outside this order');
        return { orderLineId: line._id, productId: line.productId, skuNumber: line.skuNumber, quantity: row.quantity };
      })
    }));
    order.packingKey = rawKey; order.packingHash = requestHash; order.status = 'packed'; order.revision += 1;
    await order.save({ session });
    await audit(req, session, 'outbound.order-packed', order.warehouseId, { orderId: String(order._id), packageCount: order.packages.length });
    return { order, idempotentReplay: false };
  });
}

async function dispatchOrder(req, orderId, { expectedRevision, requestKey: rawKey, carrier = '', trackingNumber = '' }) {
  validId(orderId, 'orderId'); integer(expectedRevision, 'expectedRevision'); key(rawKey);
  const requestHash = hash({ orderId: String(orderId), expectedRevision, carrier: String(carrier).trim(), trackingNumber: String(trackingNumber).trim() });
  const operationKey = scopedKey('order-dispatch', rawKey);
  try {
    return await transaction(req, async session => {
      const previous = await findOperation(req, operationKey, session);
      if (previous) {
        if (previous.requestHash !== requestHash) throw fail(409, 'Idempotency-Key was used for a different dispatch', 'IDEMPOTENCY_KEY_CONFLICT');
        const shipment = await Shipment.findOne({ orderId }).session(session).lean().exec();
        const order = await Order.findById(orderId).session(session).lean().exec();
        return { order, shipment, idempotentReplay: true };
      }
      const order = await Order.findById(orderId).session(session);
      if (!order) throw fail(404, 'Order was not found');
      if (order.status !== 'packed') throw fail(409, 'Only packed orders can be dispatched');
      if (order.revision !== expectedRevision) throw fail(409, 'Order changed; refresh and retry');
      await assertWarehouse(req, order.warehouseId, session);
      if (String(carrier).length > 120 || String(trackingNumber).length > 160) throw fail(400, 'Carrier or tracking number is too long');
      const operationMovements = [];
      for (const line of order.lines) {
        let quantity = Number(line.packedQuantity || 0);
        if (quantity !== Number(line.pickedQuantity || 0)) throw fail(409, 'Dispatch quantity must match picked and packed quantities');
        for (const allocation of line.allocations) {
          if (!quantity) break;
          const remaining = Number(allocation.pickedQuantity || 0) - Number(allocation.dispatchedQuantity || 0);
          const take = Math.min(quantity, remaining);
          if (!take) continue;
          const pallet = await Pallet.findById(allocation.palletId).session(session).lean().exec();
          if (!pallet || Number(pallet.contPicked || 0) < take || Number(pallet.cont || 0) < take) throw fail(409, 'Picked inventory is no longer available for dispatch');
          const movement = makeMovement(pallet, { type: 'dispatch', onHandDelta: -take, reason: `Dispatched ${order.reference}`, userId: req.auth.id, orderId: order._id });
          const updated = await updatePallet(pallet, { inc: { cont: -take, contPicked: -take }, movement, session, requireOnHandAtLeast: take });
          allocation.dispatchedQuantity = Number(allocation.dispatchedQuantity || 0) + take;
          operationMovements.push({ palletId: updated._id, quantity: take, movementId: movement._id, stockBefore: movement.stockBefore, stockAfter: movement.stockAfter });
          quantity -= take;
        }
        if (quantity) throw fail(409, 'Picked pallet allocation does not cover the packed quantity');
      }
      const shipmentId = new mongoose.Types.ObjectId();
      const shipment = new Shipment({
        _id: shipmentId, warehouseId: order.warehouseId, orderId: order._id,
        reference: `SHP-${shipmentId.toString().toUpperCase()}`, status: 'dispatched',
        carrier: String(carrier).trim(), trackingNumber: String(trackingNumber).trim(),
        packageIds: order.packages.map(pkg => pkg._id), dispatchedBy: req.auth.id, dispatchedAt: new Date()
      });
      await shipment.save({ session });
      order.status = 'dispatched'; order.dispatchKey = rawKey; order.dispatchHash = requestHash;
      order.dispatchedAt = shipment.dispatchedAt; order.revision += 1; await order.save({ session });
      await recordOperation(req, session, { type: 'order-dispatch', rawKey, requestHash, order, quantity: order.lines.reduce((sum, line) => sum + Number(line.packedQuantity || 0), 0), movements: operationMovements });
      await audit(req, session, 'outbound.order-dispatched', order.warehouseId, { orderId: String(order._id), shipmentId: String(shipment._id), reference: shipment.reference });
      return { order, shipment, idempotentReplay: false };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const prior = await runWithAuth(context(req), () => InventoryOperation.findOne({ requestKey: operationKey }).lean().exec());
      if (prior) {
        if (prior.requestHash !== requestHash) throw fail(409, 'Idempotency-Key was used for a different dispatch', 'IDEMPOTENCY_KEY_CONFLICT');
        const [order, shipment] = await Promise.all([
          runWithAuth(context(req), () => Order.findById(orderId).lean().exec()),
          runWithAuth(context(req), () => Shipment.findOne({ orderId }).lean().exec())
        ]);
        return { order, shipment, idempotentReplay: true };
      }
    }
    throw error;
  }
}

async function confirmDelivery(req, orderId, { deliveredTo = '', deliveryNotes = '' } = {}) {
  validId(orderId, 'orderId');
  if (String(deliveredTo).length > 160 || String(deliveryNotes).length > 1000) throw fail(400, 'Delivery information is too long');
  return transaction(req, async session => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw fail(404, 'Order was not found');
    if (order.status === 'delivered') return { order, shipment: await Shipment.findOne({ orderId }).session(session).lean().exec(), idempotentReplay: true };
    if (order.status !== 'dispatched') throw fail(409, 'Only dispatched orders can be marked delivered');
    await assertWarehouse(req, order.warehouseId, session);
    const shipment = await Shipment.findOne({ orderId }).session(session);
    if (!shipment || shipment.status !== 'dispatched') throw fail(409, 'Dispatched shipment record is missing');
    const deliveredAt = new Date();
    shipment.status = 'delivered'; shipment.deliveredAt = deliveredAt;
    shipment.deliveredTo = String(deliveredTo).trim(); shipment.deliveryNotes = String(deliveryNotes).trim();
    await shipment.save({ session });
    order.status = 'delivered'; order.deliveredAt = deliveredAt;
    order.deliveryRecipient = shipment.deliveredTo; order.deliveryNotes = shipment.deliveryNotes; order.revision += 1;
    await order.save({ session });
    await audit(req, session, 'outbound.order-delivered', order.warehouseId, { orderId: String(order._id), shipmentId: String(shipment._id) });
    return { order, shipment, idempotentReplay: false };
  });
}

async function cancelOrder(req, orderId, { expectedRevision, reason }) {
  validId(orderId, 'orderId'); integer(expectedRevision, 'expectedRevision');
  const cleanReason = typeof reason === 'string' ? reason.trim() : '';
  if (cleanReason.length < 3 || cleanReason.length > 500) throw fail(400, 'A cancellation reason of 3 to 500 characters is required');
  return transaction(req, async session => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw fail(404, 'Order was not found');
    if (['dispatched', 'delivered', 'cancelled'].includes(order.status)) throw fail(409, 'This order cannot be cancelled');
    if (order.revision !== expectedRevision) throw fail(409, 'Order changed; refresh and retry');
    await assertWarehouse(req, order.warehouseId, session);
    for (const line of order.lines) for (const allocation of line.allocations) {
      const unpicked = Number(allocation.reservedQuantity || 0) - Number(allocation.pickedQuantity || 0);
      const picked = Number(allocation.pickedQuantity || 0) - Number(allocation.dispatchedQuantity || 0);
      const release = unpicked + picked;
      if (!release) continue;
      const pallet = await Pallet.findById(allocation.palletId).session(session).lean().exec();
      if (!pallet) throw fail(409, 'Allocated pallet is unavailable; cancellation was stopped');
      const movement = makeMovement(pallet, { type: 'release', deltaAvailable: release, reason: `Order ${order.reference} cancelled: ${cleanReason}`, userId: req.auth.id, orderId: order._id });
      await updatePallet(pallet, { setAvailable: availableQuantity(pallet) + release, inc: { contReserved: -unpicked, contPicked: -picked }, movement, session });
      allocation.reservedQuantity = allocation.pickedQuantity;
      allocation.pickedQuantity = allocation.dispatchedQuantity;
    }
    order.status = 'cancelled'; order.revision += 1; await order.save({ session });
    await audit(req, session, 'outbound.order-cancelled', order.warehouseId, { orderId: String(order._id), reason: cleanReason });
    return order;
  });
}

module.exports = {
  createCustomer, updateCustomer, createOrder, updateDraftOrder, submitOrder,
  reserveOrder, assignPicker, listPickers, confirmPicking, packOrder, dispatchOrder,
  confirmDelivery, cancelOrder, assertWarehouse
};

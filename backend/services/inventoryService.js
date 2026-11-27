const mongoose = require('mongoose');
const crypto = require('crypto');
const Item = require('../model/Item');
const Pallet = require('../model/Pallets');
const InventoryOperation = require('../model/InventoryOperation');
const Location = require('../model/Location');
const { availableQuantity } = require('./inventoryBalance');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function changePalletStock({ palletId, type, quantity, newQuantity, reason, userId, session, idempotencyValidated = false }) {
  if (!['stock-in', 'stock-out', 'adjustment'].includes(type)) throw httpError(400, 'Invalid movement type');
  if (type === 'stock-in' && !idempotencyValidated) throw httpError(400, 'Stock-in must use the idempotent stock-in operation');
  if (type === 'adjustment') {
    if (!Number.isInteger(newQuantity) || newQuantity < 0) throw httpError(400, 'newQuantity must be a non-negative whole number');
  } else if (!Number.isInteger(quantity) || quantity <= 0) {
    throw httpError(400, 'quantity must be a positive whole number');
  }
  if (typeof reason !== 'string' || !reason.trim()) throw httpError(400, 'reason is required');
  if (!mongoose.Types.ObjectId.isValid(palletId)) throw httpError(400, 'Invalid palletId');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const palletQuery = Pallet.findById(palletId);
    if (session) palletQuery.session(session);
    const pallet = await palletQuery.lean().exec();
    if (!pallet) throw httpError(404, 'Pallet not found');
    if (pallet.status === 'receiving' || Number(pallet.contQuarantined || 0) > 0) {
      throw httpError(409, 'Receiving or quarantined goods must be processed through GRN inspection and putaway');
    }

    const before = availableQuantity(pallet);
    const delta = type === 'stock-in'
      ? quantity
      : type === 'stock-out'
        ? -quantity
        : newQuantity - before;
    const after = before + delta;
    if (after < 0) throw httpError(409, 'Insufficient stock for this operation');
    if (delta === 0) throw httpError(400, 'Adjustment does not change the available stock');

    const movement = {
      _id: new mongoose.Types.ObjectId(),
      type,
      quantity: Math.abs(delta),
      delta,
      stockBefore: before,
      stockAfter: after,
      onHandBefore: Number(pallet.cont || 0),
      onHandAfter: type === 'stock-in'
        ? Number(pallet.cont || 0) + quantity
        : type === 'stock-out'
          ? Number(pallet.cont || 0) - quantity
          : after + Number(pallet.contQuarantined || 0) + Number(pallet.contReserved || 0) + Number(pallet.contPicked || 0),
      quarantinedBefore: Number(pallet.contQuarantined || 0),
      quarantinedAfter: Number(pallet.contQuarantined || 0),
      reason,
      responsibleUser: userId,
      createdAt: new Date()
    };
    const filter = { _id: pallet._id };
    if (typeof pallet.__v === 'number') filter.__v = pallet.__v;
    if (pallet.contAvailable == null) {
      filter.$or = [{ contAvailable: { $exists: false } }, { contAvailable: null }];
    } else {
      filter.contAvailable = pallet.contAvailable;
    }
    const update = {
      $set: { contAvailable: after },
      $inc: { __v: 1 },
      $push: { movementLog: movement }
    };
    if (type === 'stock-in') update.$inc.cont = quantity;
    if (type === 'stock-out') update.$inc.cont = -quantity;
    if (type === 'adjustment') update.$set.cont = after
      + Number(pallet.contQuarantined || 0) + Number(pallet.contReserved || 0) + Number(pallet.contPicked || 0);

    const updated = await Pallet.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
      context: 'query',
      ...(session ? { session } : {})
    }).lean().exec();
    if (updated) return { pallet: updated, movement };
  }

  throw httpError(409, 'Inventory changed concurrently; retry the request');
}

function validIdempotencyKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    throw httpError(400, 'A valid Idempotency-Key header is required');
  }
  return value;
}

function scopedRequestKey(operation, requestKey) {
  // Keep the client key separate by operation while preserving the existing
  // company/owner unique index on InventoryOperation.requestKey.
  return `${operation}:${crypto.createHash('sha256').update(requestKey).digest('hex')}`;
}

function stockInHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function findIdempotentOperation(requestKey, session) {
  const query = InventoryOperation.findOne({ requestKey });
  if (session) query.session(session);
  return query.lean().exec();
}

async function replayPalletOperation(operation, requestHash, session) {
  if (operation.requestHash !== requestHash) {
    throw requestConflict('This Idempotency-Key was already used for a different inventory request');
  }
  const movementRef = operation.movements?.[0];
  if (!movementRef) throw httpError(503, 'The saved inventory operation is incomplete');
  const query = Pallet.findById(movementRef.palletId);
  if (session) query.session(session);
  const pallet = await query.lean().exec();
  if (!pallet) throw httpError(503, 'The pallet for the saved inventory operation is unavailable');
  const movement = (pallet.movementLog || []).find(entry => String(entry._id) === String(movementRef.movementId));
  if (!movement) throw httpError(503, 'The movement for the saved inventory operation is unavailable');
  return { pallet, movement, idempotentReplay: true };
}

async function writePalletOperation({ operationType, requestKey, requestHash, skuNumber, quantity, pallet, movement, session }) {
  const movementId = movement?._id || pallet.movementLog?.[pallet.movementLog.length - 1]?._id;
  const [operation] = await InventoryOperation.create([{
    requestKey, requestHash, type: operationType, skuNumber, quantity,
    movements: [{
      palletId: pallet._id, quantity: Math.abs(movement.quantity), movementId,
      stockBefore: movement.stockBefore, stockAfter: movement.stockAfter
    }]
  }], { session });
  return operation;
}

async function receivePalletStock({ palletId, quantity, reason, userId, requestKey: rawKey }) {
  validIdempotencyKey(rawKey);
  if (!mongoose.Types.ObjectId.isValid(palletId)) throw httpError(400, 'Invalid palletId');
  if (!Number.isInteger(quantity) || quantity <= 0) throw httpError(400, 'quantity must be a positive whole number');
  if (typeof reason !== 'string' || !reason.trim()) throw httpError(400, 'reason is required');
  const requestKey = scopedRequestKey('stock-in', rawKey);
  const normalizedReason = reason.trim();
  const requestHash = stockInHash({ type: 'stock-in', palletId: String(palletId), quantity, reason: normalizedReason });
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await findIdempotentOperation(requestKey, session);
      if (existing) {
        result = await replayPalletOperation(existing, requestHash, session);
        return;
      }
      const changed = await changePalletStock({
        palletId, type: 'stock-in', quantity, reason: normalizedReason,
        userId, session, idempotencyValidated: true
      });
      await writePalletOperation({
        operationType: 'stock-in-adjustment', requestKey, requestHash,
        skuNumber: changed.pallet.skuNumber, quantity, pallet: changed.pallet,
        movement: changed.movement, session
      });
      result = { ...changed, idempotentReplay: false };
    });
    return result;
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await findIdempotentOperation(requestKey);
      if (existing) return replayPalletOperation(existing, requestHash);
    }
    throw error;
  } finally { await session.endSession(); }
}

async function adjustPalletStock({ palletId, newQuantity, reason, userId, requestKey: rawKey }) {
  validIdempotencyKey(rawKey);
  if (!mongoose.Types.ObjectId.isValid(palletId)) throw httpError(400, 'Invalid palletId');
  if (!Number.isInteger(newQuantity) || newQuantity < 0) throw httpError(400, 'newQuantity must be a non-negative whole number');
  if (typeof reason !== 'string' || !reason.trim()) throw httpError(400, 'reason is required');
  const requestKey = scopedRequestKey('inventory-adjustment', rawKey);
  const normalizedReason = reason.trim();
  const requestHash = stockInHash({ type: 'adjustment', palletId: String(palletId), newQuantity, reason: normalizedReason });
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await findIdempotentOperation(requestKey, session);
      if (existing) {
        result = await replayPalletOperation(existing, requestHash, session);
        return;
      }
      const changed = await changePalletStock({ palletId, type: 'adjustment', newQuantity, reason: normalizedReason, userId, session });
      await writePalletOperation({
        operationType: 'inventory-adjustment', requestKey, requestHash,
        skuNumber: changed.pallet.skuNumber, quantity: Math.abs(changed.movement.delta),
        pallet: changed.pallet, movement: changed.movement, session
      });
      result = { ...changed, idempotentReplay: false };
    });
    return result;
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await findIdempotentOperation(requestKey);
      if (existing) return replayPalletOperation(existing, requestHash);
    }
    throw error;
  } finally { await session.endSession(); }
}

async function receiveNewPallet({ skuNumber, quantity, reason, location, size, warehouseId, userId, requestKey: rawKey }) {
  validIdempotencyKey(rawKey);
  if (!Number.isInteger(quantity) || quantity <= 0) throw httpError(400, 'quantity must be a positive whole number');
  if (typeof reason !== 'string' || !reason.trim()) throw httpError(400, 'reason is required');
  if (typeof skuNumber !== 'string' || !skuNumber.trim()) throw httpError(400, 'skuNumber is required');
  const requestKey = scopedRequestKey('stock-in', rawKey);
  const normalizedSku = skuNumber.trim();
  const normalizedReason = reason.trim();
  const requestHash = stockInHash({
    type: 'stock-in-new-pallet', skuNumber: normalizedSku, quantity, reason: normalizedReason,
    location: location || null, size: size == null ? null : size, warehouseId: warehouseId ? String(warehouseId) : null
  });
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await findIdempotentOperation(requestKey, session);
      if (existing) {
        result = await replayPalletOperation(existing, requestHash, session);
        return;
      }
      const item = await Item.findOne({ skuNumber: normalizedSku }).session(session).lean().exec();
      if (!item) throw httpError(404, `Item with SKU ${normalizedSku} not found`);
      let destination;
      const palletSize = size == null ? Number(item.size || 0) * quantity : size;
      if (location) {
        destination = await Location.findOne({ fullName: location, ...(warehouseId ? { warehouse: warehouseId } : {}) }).session(session);
        if (!destination) throw httpError(404, 'Location not found in the selected warehouse');
        if (!['empty', 'occupied'].includes(destination.status)) throw httpError(409, 'Location is not available for stock placement');
        if (destination.skuNumber && destination.skuNumber !== normalizedSku) throw httpError(409, 'Location is reserved for a different SKU');
        if (Number(destination.size || 0) + Number(palletSize) > Number(destination.maxSize || 0)) throw httpError(409, 'Pallet exceeds destination location capacity');
      }
      const movement = {
        _id: new mongoose.Types.ObjectId(),
        type: 'stock-in', quantity, delta: quantity, stockBefore: 0, stockAfter: quantity,
        onHandBefore: 0, onHandAfter: quantity, quarantinedBefore: 0, quarantinedAfter: 0,
        reason: normalizedReason, responsibleUser: userId, createdAt: new Date()
      };
      const [pallet] = await Pallet.create([{
        item: item._id, warehouseId, skuNumber: normalizedSku, size: palletSize, ounce: Number(item.ounce || 0) * quantity,
        department: item.department, status: location ? 'store' : 'received',
        ...(location ? { location } : {}), cont: quantity, contAvailable: quantity, contQuarantined: 0,
        movementLog: [movement]
      }], { session });
      if (destination) {
        destination.size = Number(destination.size || 0) + Number(palletSize);
        destination.skuNumber = normalizedSku;
        destination.department = item.department;
        destination.status = 'occupied';
        if (!(destination.palletId || []).some(id => String(id) === String(pallet._id))) destination.palletId.push(pallet._id);
        await destination.save({ session });
      }
      await writePalletOperation({
        operationType: 'stock-in-adjustment', requestKey, requestHash,
        skuNumber: normalizedSku, quantity, pallet, movement, session
      });
      result = { pallet, movement, idempotentReplay: false };
    });
    return result;
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await findIdempotentOperation(requestKey);
      if (existing) return replayPalletOperation(existing, requestHash);
    }
    throw error;
  } finally { await session.endSession(); }
}

function deductionHash({ skuNumber, items, reason }) {
  const canonicalItems = [...items].sort((a, b) => a.palletId.localeCompare(b.palletId));
  return crypto.createHash('sha256').update(JSON.stringify({
    type: 'stock-out-batch', skuNumber, reason: reason.trim(), items: canonicalItems
  })).digest('hex');
}

function batchResult(operation, idempotentReplay = false) {
  return {
    idempotentReplay,
    skuNumber: operation.skuNumber,
    quantity: operation.quantity,
    movements: operation.movements
  };
}

function requestConflict(message) {
  return Object.assign(httpError(409, message), { code: 'INVENTORY_REQUEST_CONFLICT' });
}

async function deductPalletStockBatch({ skuNumber, items, reason, userId, requestKey }) {
  if (typeof skuNumber !== 'string' || !skuNumber.trim()) throw httpError(400, 'skuNumber is required');
  if (!Array.isArray(items) || !items.length || items.length > 100) throw httpError(400, 'Between 1 and 100 pallet quantities are required');
  if (typeof reason !== 'string' || !reason.trim()) throw httpError(400, 'reason is required');
  if (typeof requestKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(requestKey)) {
    throw httpError(400, 'A valid Idempotency-Key header is required');
  }
  const legacyRequestKey = requestKey;
  requestKey = scopedRequestKey('stock-out-batch', legacyRequestKey);
  const normalizedSku = skuNumber.trim();
  const normalizedReason = reason.trim();
  const normalizedItems = items.map(({ palletId, quantity }) => ({ palletId: String(palletId).toLowerCase(), quantity }));
  if (new Set(normalizedItems.map(item => item.palletId)).size !== normalizedItems.length) {
    throw httpError(400, 'A pallet may only appear once in a batch deduction');
  }
  if (normalizedItems.some(item => !mongoose.Types.ObjectId.isValid(item.palletId)
    || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
    throw httpError(400, 'Every pallet ID and quantity must be valid');
  }
  const totalQuantity = normalizedItems.reduce((total, item) => total + item.quantity, 0);
  const requestHash = deductionHash({ skuNumber: normalizedSku, items: normalizedItems, reason: normalizedReason });
  const findExisting = async (session) => {
    let query = InventoryOperation.findOne({ requestKey });
    if (session) query.session(session);
    const operation = await query.lean().exec();
    if (operation) return operation;
    // Preserve retries for records written before operation namespaces existed.
    query = InventoryOperation.findOne({ requestKey: legacyRequestKey, type: 'stock-out-batch' });
    if (session) query.session(session);
    return query.lean().exec();
  };
  const replayOrConflict = operation => {
    if (operation.requestHash !== requestHash) throw requestConflict('This Idempotency-Key was already used for a different inventory request');
    return batchResult(operation, true);
  };

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await findExisting(session);
      if (existing) {
        result = replayOrConflict(existing);
        return;
      }

      const palletIds = normalizedItems.map(item => new mongoose.Types.ObjectId(item.palletId));
      const palletQuery = Pallet.find({ _id: { $in: palletIds }, skuNumber: normalizedSku }).session(session);
      const pallets = await palletQuery.lean().exec();
      if (pallets.length !== normalizedItems.length) {
        throw httpError(404, 'One or more pallets are unavailable in the active company or assigned warehouse');
      }
      const palletById = new Map(pallets.map(pallet => [String(pallet._id), pallet]));
      for (const item of normalizedItems) {
        const pallet = palletById.get(item.palletId);
        if (!pallet || pallet.skuNumber !== normalizedSku) {
          throw httpError(404, 'One or more pallets are unavailable in the active company or assigned warehouse');
        }
        const available = availableQuantity(pallet);
        if (!Number.isInteger(available) || available < item.quantity) {
          throw httpError(409, `Insufficient stock on pallet ${item.palletId}`);
        }
      }
      const totalAvailable = normalizedItems.reduce((total, item) => {
        const pallet = palletById.get(item.palletId);
        return total + availableQuantity(pallet);
      }, 0);
      if (totalAvailable < totalQuantity) throw httpError(409, 'Insufficient stock for this operation');

      const [operation] = await InventoryOperation.create([{
        requestKey, requestHash, type: 'stock-out-batch', skuNumber: normalizedSku,
        quantity: totalQuantity, movements: []
      }], { session });

      const movements = [];
      for (const item of normalizedItems) {
        const changed = await changePalletStock({
          palletId: item.palletId, type: 'stock-out', quantity: item.quantity,
          reason: normalizedReason, userId, session
        });
        movements.push({
          palletId: changed.pallet._id,
          quantity: item.quantity,
          movementId: changed.pallet.movementLog?.[changed.pallet.movementLog.length - 1]?._id || changed.movement._id,
          stockBefore: changed.movement.stockBefore,
          stockAfter: changed.movement.stockAfter
        });
      }
      const write = await InventoryOperation.updateOne(
        { _id: operation._id, requestKey },
        { $set: { movements } },
        { session, runValidators: true }
      );
      if (!write || write.matchedCount !== 1 || write.modifiedCount !== 1) {
        throw httpError(409, 'Inventory operation record could not be finalized');
      }
      result = { idempotentReplay: false, skuNumber: normalizedSku, quantity: totalQuantity, movements };
    });
    return result;
  } catch (error) {
    if (error && error.code === 11000) {
      const existing = await findExisting();
      if (existing) return replayOrConflict(existing);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { changePalletStock, receivePalletStock, adjustPalletStock, receiveNewPallet, deductPalletStockBatch };

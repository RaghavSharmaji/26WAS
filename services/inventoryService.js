const mongoose = require('mongoose');
const Item = require('../model/Item');
const Pallet = require('../model/Pallets');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function changePalletStock({ palletId, type, quantity, newQuantity, reason, userId }) {
  if (!['stock-in', 'stock-out', 'adjustment'].includes(type)) throw httpError(400, 'Invalid movement type');
  if (type === 'adjustment') {
    if (!Number.isInteger(newQuantity) || newQuantity < 0) throw httpError(400, 'newQuantity must be a non-negative whole number');
  } else if (!Number.isInteger(quantity) || quantity <= 0) {
    throw httpError(400, 'quantity must be a positive whole number');
  }
  if (typeof reason !== 'string' || !reason.trim()) throw httpError(400, 'reason is required');
  if (!mongoose.Types.ObjectId.isValid(palletId)) throw httpError(400, 'Invalid palletId');

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pallet = await Pallet.findById(palletId).lean().exec();
    if (!pallet) throw httpError(404, 'Pallet not found');

    const before = Number(pallet.contAvailable == null ? pallet.cont || 0 : pallet.contAvailable);
    const delta = type === 'stock-in'
      ? quantity
      : type === 'stock-out'
        ? -quantity
        : newQuantity - before;
    const after = before + delta;
    if (after < 0) throw httpError(409, 'Insufficient stock for this operation');
    if (delta === 0) throw httpError(400, 'Adjustment does not change the available stock');

    const movement = {
      type,
      quantity: Math.abs(delta),
      delta,
      stockBefore: before,
      stockAfter: after,
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
    if (type === 'adjustment') update.$set.cont = after;

    const updated = await Pallet.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
      context: 'query'
    }).lean().exec();
    if (updated) return { pallet: updated, movement };
  }

  throw httpError(409, 'Inventory changed concurrently; retry the request');
}

async function receiveNewPallet({ skuNumber, quantity, reason, location, size, userId }) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw httpError(400, 'quantity must be a positive whole number');
  if (typeof reason !== 'string' || !reason.trim()) throw httpError(400, 'reason is required');
  if (typeof skuNumber !== 'string' || !skuNumber.trim()) throw httpError(400, 'skuNumber is required');
  const item = await Item.findOne({ skuNumber }).lean().exec();
  if (!item) throw httpError(404, `Item with SKU ${skuNumber} not found`);
  const movement = {
    type: 'stock-in',
    quantity,
    delta: quantity,
    stockBefore: 0,
    stockAfter: quantity,
    reason,
    responsibleUser: userId,
    createdAt: new Date()
  };
  const pallet = await Pallet.create({
    item: item._id,
    skuNumber,
    size: size == null ? item.size : size,
    department: item.department,
    status: location ? 'store' : 'received',
    location: location || undefined,
    cont: quantity,
    contAvailable: quantity,
    movementLog: [movement]
  });
  return { pallet, movement };
}

module.exports = { changePalletStock, receiveNewPallet };

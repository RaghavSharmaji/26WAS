const express = require('express');
const Pallet = require('../model/Pallets');
const Item = require('../model/Item');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const validators = require('../validators/records');
const inventoryService = require('../services/inventoryService');
const { resolveWarehouse, resolveLocation } = require('../services/tenantService');
const { availableQuantityExpression } = require('../services/inventoryBalance');

const router = express.Router();
router.use(auth);

router.get('/', asyncHandler(async (req, res) => {
  const rows = await Pallet.aggregate([
    {
      $group: {
        _id: '$skuNumber',
        availableQuantity: { $sum: availableQuantityExpression() },
        onHandQuantity: { $sum: '$cont' },
        quarantinedQuantity: { $sum: { $ifNull: ['$contQuarantined', 0] } },
        palletCount: { $sum: 1 },
        locations: { $addToSet: '$location' }
      }
    },
    { $sort: { _id: 1 } }
  ]);
  const skuNumbers = rows.map(row => row._id);
  const items = await Item.find({ skuNumber: { $in: skuNumbers } }).select('name skuNumber reorderLevel').lean();
  const itemBySku = new Map(items.map(item => [item.skuNumber, item]));
  res.json({
    success: true,
    data: rows.map(row => ({ ...row, item: itemBySku.get(row._id) || null }))
  });
}));

router.post('/stock-in', asyncHandler(async (req, res) => {
  const body = validators.inventory(req.body || {}, 'stock-in');
  const requestKey = req.get('Idempotency-Key');
  let result;
  if (body.palletId) {
    result = await inventoryService.receivePalletStock({ ...body, requestKey, userId: req.auth.id });
    return res.json({ success: true, data: result });
  }
  if (req.tenant?.companyId) {
    const warehouse = await resolveWarehouse(req, body.warehouseId || req.tenant.activeWarehouseId);
    body.warehouseId = String(warehouse._id);
    await resolveLocation(req, body.location, body.warehouseId);
  }
  result = await inventoryService.receiveNewPallet({ ...body, requestKey, userId: req.auth.id });
  return res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: result });
}));

router.post('/stock-out', asyncHandler(async (req, res) => {
  const body = validators.inventory(req.body || {}, 'stock-out');
  const data = await inventoryService.changePalletStock({ ...body, type: 'stock-out', userId: req.auth.id });
  return res.json({ success: true, data });
}));

router.post('/stock-out/batch', asyncHandler(async (req, res) => {
  const body = validators.inventoryBatchDeduction(req.body || {});
  const requestKey = req.get('Idempotency-Key');
  const data = await inventoryService.deductPalletStockBatch({
    ...body, requestKey, userId: req.auth.id
  });
  return res.json({ success: true, data });
}));

router.post('/adjust', asyncHandler(async (req, res) => {
  const body = validators.inventory(req.body || {}, 'adjustment');
  const data = await inventoryService.adjustPalletStock({ ...body, requestKey: req.get('Idempotency-Key'), userId: req.auth.id });
  return res.json({ success: true, data });
}));

router.get('/movements', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const pipeline = [];
  if (req.query.skuNumber) pipeline.push({ $match: { skuNumber: req.query.skuNumber } });
  pipeline.push(
    { $unwind: '$movementLog' },
    { $sort: { 'movementLog.createdAt': -1 } },
    { $limit: limit },
    {
      $project: {
        _id: '$movementLog._id',
        palletId: '$_id',
        skuNumber: '$skuNumber',
        location: '$location',
        type: '$movementLog.type',
        quantity: '$movementLog.quantity',
        delta: '$movementLog.delta',
        stockBefore: '$movementLog.stockBefore',
        stockAfter: '$movementLog.stockAfter',
        reason: '$movementLog.reason',
        responsibleUser: '$movementLog.responsibleUser',
        createdAt: '$movementLog.createdAt'
      }
    }
  );
  const data = await Pallet.aggregate(pipeline);
  res.json({ success: true, data });
}));

module.exports = router;

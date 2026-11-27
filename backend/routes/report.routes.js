const express = require('express');
const Item = require('../model/Item');
const Location = require('../model/Location');
const Warehouse = require('../model/Warehouse');
const Pallet = require('../model/Pallets');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { availableQuantityExpression } = require('../services/inventoryBalance');
const GoodsReceipt = require('../model/GoodsReceipt');
const { movementDateMatch, movementTotals, qualityTotals } = require('../services/movementReport');

const router = express.Router();
router.use(auth);

async function stockBySku() {
  const rows = await Pallet.aggregate([
    {
      $group: {
        _id: '$skuNumber',
        quantity: { $sum: availableQuantityExpression() },
        palletCount: { $sum: 1 }
      }
    }
  ]);
  return new Map(rows.map(row => [row._id, row]));
}

router.get('/low-stock', asyncHandler(async (req, res) => {
  const [items, stock] = await Promise.all([
    Item.find({ reorderLevel: { $gt: 0 } }).lean(),
    stockBySku()
  ]);
  const data = items.map(item => ({
    item,
    availableQuantity: (stock.get(item.skuNumber) || {}).quantity || 0,
    palletCount: (stock.get(item.skuNumber) || {}).palletCount || 0
  })).filter(row => row.availableQuantity <= row.item.reorderLevel);
  res.json({ success: true, count: data.length, data });
}));

router.get('/summary', asyncHandler(async (req, res) => {
  const [productCount, warehouseCount, locationCount, stock, movementGroups, qualityRows, recentMovements] = await Promise.all([
    Item.countDocuments(),
    Warehouse.countDocuments(),
    Location.countDocuments(),
    Pallet.aggregate([{ $group: {
      _id: null,
      quantity: { $sum: availableQuantityExpression() },
      onHandQuantity: { $sum: { $ifNull: ['$cont', 0] } },
      quarantinedQuantity: { $sum: { $ifNull: ['$contQuarantined', 0] } }
    } }]),
    Pallet.aggregate([
      { $unwind: '$movementLog' },
      { $group: { _id: { type: '$movementLog.type', referenceType: '$movementLog.referenceType' }, movementCount: { $sum: 1 }, quantity: { $sum: '$movementLog.quantity' } } }
    ]),
    GoodsReceipt.aggregate([
      { $unwind: '$lines' },
      { $group: { _id: null, rejected: { $sum: '$lines.rejectedQuantity' }, damaged: { $sum: '$lines.damagedQuantity' }, incorrect: { $sum: '$lines.incorrectQuantity' } } }
    ]),
    Pallet.aggregate([
      { $unwind: '$movementLog' },
      { $sort: { 'movementLog.createdAt': -1 } },
      { $limit: 10 },
      { $project: { palletId: '$_id', skuNumber: 1, type: '$movementLog.type', referenceType: '$movementLog.referenceType', quantity: '$movementLog.quantity', reason: '$movementLog.reason', createdAt: '$movementLog.createdAt' } }
    ])
  ]);
  const totals = movementTotals(movementGroups.map(row => ({
    type: row._id.type, referenceType: row._id.referenceType, count: row.movementCount, quantity: row.quantity
  })));
  res.json({
    success: true,
    data: {
      productCount,
      warehouseCount,
      locationCount,
      totalAvailableQuantity: stock.length ? stock[0].quantity : 0,
      totalOnHandQuantity: stock.length ? stock[0].onHandQuantity : 0,
      totalQuarantinedQuantity: stock.length ? stock[0].quarantinedQuantity : 0,
      ...totals,
      quality: qualityTotals(qualityRows),
      recentMovements
    }
  });
}));

router.get('/movements/summary', asyncHandler(async (req, res) => {
  let match;
  let qualityDateMatch;
  try {
    match = movementDateMatch(req.query.from, req.query.to);
    qualityDateMatch = movementDateMatch(req.query.from, req.query.to, 'lines.inspectedAt');
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
  const data = await Pallet.aggregate([
    { $unwind: '$movementLog' },
    ...(match ? [{ $match: match }] : []),
    { $group: { _id: { type: '$movementLog.type', referenceType: '$movementLog.referenceType' }, count: { $sum: 1 }, quantity: { $sum: '$movementLog.quantity' } } },
    { $sort: { '_id.type': 1, '_id.referenceType': 1 } }
  ]);
  const qualityRows = await GoodsReceipt.aggregate([
    { $unwind: '$lines' },
    ...(qualityDateMatch ? [{ $match: qualityDateMatch }] : []),
    { $group: { _id: null, rejected: { $sum: '$lines.rejectedQuantity' }, damaged: { $sum: '$lines.damagedQuantity' }, incorrect: { $sum: '$lines.incorrectQuantity' } } }
  ]);
  const groups = data.map(row => ({ type: row._id.type, referenceType: row._id.referenceType, count: row.count, quantity: row.quantity }));
  const compatibleData = data.map(row => ({ ...row, _id: row._id.type, referenceType: row._id.referenceType }));
  res.json({ success: true, data: compatibleData, totals: movementTotals(groups), quality: qualityTotals(qualityRows) });
}));

module.exports = router;

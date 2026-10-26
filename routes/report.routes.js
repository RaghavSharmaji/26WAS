const express = require('express');
const Item = require('../model/Item');
const Location = require('../model/Location');
const Warehouse = require('../model/Warehouse');
const Pallet = require('../model/Pallets');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(auth);

async function stockBySku() {
  const rows = await Pallet.aggregate([
    {
      $group: {
        _id: '$skuNumber',
        quantity: { $sum: { $ifNull: ['$contAvailable', '$cont'] } },
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
  const [productCount, warehouseCount, locationCount, stock, movements, recentMovements] = await Promise.all([
    Item.countDocuments(),
    Warehouse.countDocuments(),
    Location.countDocuments(),
    Pallet.aggregate([{ $group: { _id: null, quantity: { $sum: { $ifNull: ['$contAvailable', '$cont'] } } } }]),
    Pallet.aggregate([
      { $unwind: '$movementLog' },
      { $group: { _id: '$movementLog.type', movementCount: { $sum: 1 }, quantity: { $sum: '$movementLog.quantity' } } }
    ]),
    Pallet.aggregate([
      { $unwind: '$movementLog' },
      { $sort: { 'movementLog.createdAt': -1 } },
      { $limit: 10 },
      { $project: { palletId: '$_id', skuNumber: 1, type: '$movementLog.type', quantity: '$movementLog.quantity', reason: '$movementLog.reason', createdAt: '$movementLog.createdAt' } }
    ])
  ]);
  const byType = Object.fromEntries(movements.map(row => [row._id, { count: row.movementCount, quantity: row.quantity }]));
  res.json({
    success: true,
    data: {
      productCount,
      warehouseCount,
      locationCount,
      totalAvailableQuantity: stock.length ? stock[0].quantity : 0,
      stockIn: byType['stock-in'] || { count: 0, quantity: 0 },
      stockOut: byType['stock-out'] || { count: 0, quantity: 0 },
      adjustments: byType.adjustment || { count: 0, quantity: 0 },
      recentMovements
    }
  });
}));

router.get('/movements/summary', asyncHandler(async (req, res) => {
  const match = {};
  if (req.query.from || req.query.to) {
    match['movementLog.createdAt'] = {};
    if (req.query.from) match['movementLog.createdAt'].$gte = new Date(req.query.from);
    if (req.query.to) match['movementLog.createdAt'].$lte = new Date(req.query.to);
    if (Object.values(match['movementLog.createdAt']).some(date => Number.isNaN(date.getTime()))) {
      return res.status(400).json({ success: false, message: 'from/to must be valid dates' });
    }
  }
  const data = await Pallet.aggregate([
    { $unwind: '$movementLog' },
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    { $group: { _id: '$movementLog.type', count: { $sum: 1 }, quantity: { $sum: '$movementLog.quantity' } } },
    { $sort: { _id: 1 } }
  ]);
  res.json({ success: true, data });
}));

module.exports = router;

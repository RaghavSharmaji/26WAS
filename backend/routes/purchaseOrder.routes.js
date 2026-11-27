const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const PurchaseOrder = require('../model/PurchaseOrder');
const Supplier = require('../model/Supplier');
const Item = require('../model/Item');
const procurementService = require('../services/procurementService');

const router = express.Router();

function publicPurchaseOrder(order) {
  if (!order) return order;
  const value = typeof order.toObject === 'function' ? order.toObject() : { ...order };
  value.lines = (value.lines || []).map(line => ({
    ...line,
    remainingQuantity: Math.max(0, Number(line.orderedQuantity || 0) - Number(line.receivedQuantity || 0))
  }));
  return value;
}

router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  const data = await PurchaseOrder.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  const supplierIds = [...new Set(data.map(row => String(row.supplierId)))];
  const suppliers = await Supplier.find({ _id: { $in: supplierIds } }).select('_id name').lean();
  const supplierById = new Map(suppliers.map(row => [String(row._id), row]));
  res.json({ success: true, data: data.map(row => ({ ...publicPurchaseOrder(row), supplier: supplierById.get(String(row.supplierId)) || null })) });
}));

router.get('/references', asyncHandler(async (req, res) => {
  const [suppliers, products] = await Promise.all([
    Supplier.find({ active: { $ne: false } }).sort({ name: 1 }).select('_id name').lean(),
    Item.find({}).sort({ name: 1 }).select('_id name skuNumber size department').lean()
  ]);
  res.json({ success: true, data: { suppliers, products } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const data = await PurchaseOrder.findById(req.params.id).lean();
  if (!data) return res.status(404).json({ success: false, message: 'Purchase order was not found' });
  const supplier = await Supplier.findById(data.supplierId).select('_id name').lean();
  return res.json({ success: true, data: { ...publicPurchaseOrder(data), supplier: supplier || null } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = await procurementService.createPurchaseOrder({ ...req.body, userId: req.auth.id, req });
  return res.status(201).json({ success: true, data: publicPurchaseOrder(data) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const data = await procurementService.updateDraftPurchaseOrder({ ...req.body, purchaseOrderId: req.params.id, req });
  return res.json({ success: true, data: publicPurchaseOrder(data) });
}));

router.post('/:id/submit', asyncHandler(async (req, res) => {
  const data = await procurementService.submitPurchaseOrder({
    purchaseOrderId: req.params.id, expectedRevision: req.body.expectedRevision, userId: req.auth.id
  });
  return res.json({ success: true, data: publicPurchaseOrder(data) });
}));

module.exports = router;

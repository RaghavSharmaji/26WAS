const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const GoodsReceipt = require('../model/GoodsReceipt');
const PurchaseOrder = require('../model/PurchaseOrder');
const procurementService = require('../services/procurementService');

const router = express.Router();

function publicReceipt(receipt) {
  if (!receipt) return receipt;
  const value = typeof receipt.toObject === 'function' ? receipt.toObject() : { ...receipt };
  delete value.requestKey;
  delete value.requestHash;
  return value;
}

function publicPutaway(putaway) {
  if (!putaway) return putaway;
  const value = typeof putaway.toObject === 'function' ? putaway.toObject() : { ...putaway };
  delete value.requestKey;
  delete value.requestHash;
  return value;
}

router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.purchaseOrderId) filter.purchaseOrderId = req.query.purchaseOrderId;
  const data = await GoodsReceipt.find(filter).sort({ receivedAt: -1 }).limit(limit).lean();
  const orderIds = [...new Set(data.map(row => String(row.purchaseOrderId)))];
  const orders = await PurchaseOrder.find({ _id: { $in: orderIds } }).select('_id reference').lean();
  const orderById = new Map(orders.map(row => [String(row._id), row]));
  return res.json({ success: true, data: data.map(row => ({ ...publicReceipt(row), purchaseOrder: orderById.get(String(row.purchaseOrderId)) || null })) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const data = await GoodsReceipt.findById(req.params.id).lean();
  if (!data) return res.status(404).json({ success: false, message: 'Goods receipt was not found' });
  return res.json({ success: true, data: publicReceipt(data) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const result = await procurementService.recordGoodsReceipt({
    ...req.body, requestKey: req.get('Idempotency-Key'), userId: req.auth.id, req
  });
  return res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: publicReceipt(result.receipt), idempotentReplay: result.idempotentReplay });
}));

router.patch('/:id/lines/:lineId/inspection', asyncHandler(async (req, res) => {
  const data = await procurementService.inspectGoodsReceiptLine({
    ...req.body, receiptId: req.params.id, lineId: req.params.lineId, userId: req.auth.id
  });
  return res.json({ success: true, data: publicReceipt(data) });
}));

router.post('/:id/lines/:lineId/putaway', asyncHandler(async (req, res) => {
  const result = await procurementService.putawayAcceptedQuantity({
    ...req.body, receiptId: req.params.id, lineId: req.params.lineId,
    requestKey: req.get('Idempotency-Key'), userId: req.auth.id, req
  });
  return res.status(result.idempotentReplay ? 200 : 201).json({ success: true, data: { ...result, receipt: publicReceipt(result.receipt), putaway: publicPutaway(result.putaway) }, idempotentReplay: result.idempotentReplay });
}));

module.exports = router;

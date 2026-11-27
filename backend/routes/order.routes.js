'use strict';

const express = require('express');
const Orders = require('../model/Order');
const Customer = require('../model/Customer');
const Pallet = require('../model/Pallets');
const outbound = require('../services/outboundService');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

function orderDto(order, customerById = new Map()) {
  const value = typeof order.toObject === 'function' ? order.toObject() : { ...order };
  const customer = customerById.get(String(value.customerId));
  return { ...value, customer: customer || null };
}

router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 200);
  const filter = req.query.status ? { status: String(req.query.status) } : {};
  const rows = await Orders.find(filter).sort({ date: -1 }).limit(limit).lean().exec();
  const customerIds = [...new Set(rows.map(row => row.customerId).filter(Boolean).map(String))];
  const customers = customerIds.length ? await Customer.find({ _id: { $in: customerIds } }).select('_id name').lean().exec() : [];
  const customerById = new Map(customers.map(row => [String(row._id), row]));
  res.json({ success: true, message: 'Orders', allOrder: rows.map(row => orderDto(row, customerById)), data: rows.map(row => orderDto(row, customerById)) });
}));

router.get('/pickers', asyncHandler(async (req, res) => {
  const data = await outbound.listPickers(req, req.query.warehouseId || req.tenant.activeWarehouseId);
  res.json({ success: true, data });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const order = await Orders.findById(req.params.id).lean().exec();
  if (!order) return res.status(404).json({ success: false, message: 'Order was not found' });
  const [customer, pallets] = await Promise.all([
    order.customerId ? Customer.findById(order.customerId).select('_id name contactPerson phone email address').lean().exec() : null,
    order.lines?.some(line => line.allocations?.length)
      ? Pallet.find({ _id: { $in: order.lines.flatMap(line => line.allocations.map(row => row.palletId)) } }).select('_id location skuNumber warehouseId').lean().exec()
      : []
  ]);
  const palletById = new Map((pallets || []).map(pallet => [String(pallet._id), pallet]));
  const lines = (order.lines || []).map(line => ({
    ...line,
    allocations: (line.allocations || []).map(allocation => ({
      ...allocation,
      location: palletById.get(String(allocation.palletId))?.location || 'Location unavailable'
    }))
  }));
  return res.json({ success: true, data: { ...order, lines, customer } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const order = await outbound.createOrder(req, req.body || {});
  res.status(201).json({ success: true, data: order });
}));

// Keep the old endpoint for clients still creating legacy SKU/quantity orders.
// New WareFlow clients use POST /api/order with customer, warehouse and product IDs.
router.post('/create', asyncHandler(async (req, res) => {
  if (Array.isArray(req.body?.lines)) {
    const order = await outbound.createOrder(req, req.body);
    return res.status(201).json({ success: true, data: order });
  }
  const items = req.body?.items;
  if (!Array.isArray(items) || items.some(row => typeof row.skuNumber !== 'string' || !Number.isSafeInteger(row.cont) || row.cont <= 0)) {
    return res.status(400).json({ success: false, message: 'Provide customer, warehouse and product lines to create a sales order.' });
  }
  const order = new Orders({ items, status: 'create' });
  await order.save();
  return res.json({ success: true, message: 'Legacy order created', newOrder: order, data: order });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const order = await outbound.updateDraftOrder(req, req.params.id, req.body || {});
  res.json({ success: true, data: order });
}));

router.post('/:id/submit', asyncHandler(async (req, res) => {
  const order = await outbound.submitOrder(req, req.params.id, req.body?.expectedRevision);
  res.json({ success: true, data: order });
}));

router.post('/:id/reserve', asyncHandler(async (req, res) => {
  const result = await outbound.reserveOrder(req, req.params.id, {
    expectedRevision: req.body?.expectedRevision,
    requestKey: req.get('Idempotency-Key')
  });
  res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
}));

router.post('/:id/picking/assign', asyncHandler(async (req, res) => {
  const order = await outbound.assignPicker(req, req.params.id, req.body || {});
  res.json({ success: true, data: order });
}));

router.post('/:id/picking/confirm', asyncHandler(async (req, res) => {
  const order = await outbound.confirmPicking(req, req.params.id, req.body || {});
  res.json({ success: true, data: order });
}));

router.post('/:id/packing', asyncHandler(async (req, res) => {
  const result = await outbound.packOrder(req, req.params.id, {
    ...(req.body || {}), requestKey: req.get('Idempotency-Key')
  });
  res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
}));

router.post('/:id/dispatch', asyncHandler(async (req, res) => {
  const result = await outbound.dispatchOrder(req, req.params.id, {
    ...(req.body || {}), requestKey: req.get('Idempotency-Key')
  });
  res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
}));

router.post('/:id/delivery', asyncHandler(async (req, res) => {
  const result = await outbound.confirmDelivery(req, req.params.id, req.body || {});
  res.json({ success: true, ...result });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const order = await outbound.cancelOrder(req, req.params.id, req.body || {});
  res.json({ success: true, data: order });
}));

// Arbitrary status changes bypass inventory reservations and dispatch accounting.
router.put('/:id/status', (req, res) => res.status(409).json({
  success: false,
  code: 'ORDER_STATUS_TRANSITION_REQUIRED',
  message: 'Use the order submit, reserve, pick, pack, dispatch, delivery, or cancel action.'
}));

module.exports = router;

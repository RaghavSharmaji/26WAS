'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const Customer = require('../model/Customer');
const outbound = require('../services/outboundService');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 200);
  const filter = {};
  if (req.query.active === 'true') filter.active = true;
  if (req.query.active === 'false') filter.active = false;
  const customers = await Customer.find(filter).sort({ name: 1 }).limit(limit).lean().exec();
  res.json({ success: true, data: customers });
}));

router.post('/', asyncHandler(async (req, res) => {
  const customer = await outbound.createCustomer(req, req.body || {});
  res.status(201).json({ success: true, data: customer });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const customer = await outbound.updateCustomer(req, req.params.id, req.body || {});
  res.json({ success: true, data: customer });
}));

module.exports = router;

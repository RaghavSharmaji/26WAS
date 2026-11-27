'use strict';

const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const Shipment = require('../model/Shipment');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 200);
  const data = await Shipment.find(req.query.status ? { status: String(req.query.status) } : {})
    .sort({ dispatchedAt: -1 }).limit(limit).lean().exec();
  res.json({ success: true, data });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const data = await Shipment.findById(req.params.id).lean().exec();
  if (!data) return res.status(404).json({ success: false, message: 'Shipment was not found' });
  return res.json({ success: true, data });
}));

module.exports = router;

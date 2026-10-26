const express = require('express');
const mongoose = require('mongoose');
const Pallet = require('../model/Pallets');
const Location = require('../model/Location');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const validators = require('../validators/records');
const inventoryService = require('../services/inventoryService');

const router = express.Router();
router.use(auth);

router.get('/', asyncHandler(async (req, res) => {
  const filter = req.query.skuNumber ? { skuNumber: req.query.skuNumber } : {};
  const data = await Pallet.find(filter).sort({ date: -1 }).limit(200).populate('item').lean();
  res.json({ success: true, data });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid pallet ID' });
  }
  const data = await Pallet.findById(req.params.id).populate('item').lean();
  if (!data) return res.status(404).json({ success: false, message: 'Pallet not found' });
  return res.json({ success: true, data });
}));

router.post('/', asyncHandler(async (req, res) => {
  const body = validators.inventory(req.body || {}, 'stock-in');
  if (!body.skuNumber) {
    return res.status(400).json({ success: false, message: 'skuNumber is required to create a pallet' });
  }
  const data = await inventoryService.receiveNewPallet({ ...body, userId: req.auth.id });
  return res.status(201).json({ success: true, data });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid pallet ID' });
  }
  const changes = {};
  if (req.body.location !== undefined) {
    if (typeof req.body.location !== 'string') {
      return res.status(400).json({ success: false, message: 'location must be text' });
    }
    const locationName = req.body.location.trim();
    if (locationName) {
      const location = await Location.findOne({ fullName: locationName }).lean();
      if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
      if (location.status === 'maintenance') return res.status(409).json({ success: false, message: 'Location is under maintenance' });
    }
    changes.location = locationName || undefined;
  }
  if (req.body.status !== undefined) {
    if (!['received', 'store', 'r/p', 'picked', 'damaged'].includes(req.body.status)) {
      return res.status(400).json({ success: false, message: 'Invalid pallet status' });
    }
    changes.status = req.body.status;
  }
  if (!Object.keys(changes).length) return res.status(400).json({ success: false, message: 'No editable fields supplied' });
  const data = await Pallet.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true });
  if (!data) return res.status(404).json({ success: false, message: 'Pallet not found' });
  return res.json({ success: true, data });
}));

router.delete('/:id', auth.requireRole('admin'), asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid pallet ID' });
  }
  const pallet = await Pallet.findById(req.params.id);
  if (!pallet) return res.status(404).json({ success: false, message: 'Pallet not found' });
  if ((pallet.contAvailable || 0) > 0 || (pallet.movementLog || []).length > 0) {
    return res.status(409).json({ success: false, message: 'Pallet has stock or movement history and cannot be deleted' });
  }
  await pallet.deleteOne();
  return res.json({ success: true, message: 'Pallet deleted' });
}));

module.exports = router;

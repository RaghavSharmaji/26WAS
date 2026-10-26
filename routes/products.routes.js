const express = require('express');
const mongoose = require('mongoose');
const Item = require('../model/Item');
const Pallet = require('../model/Pallets');
const Category = require('../model/Category');
const Supplier = require('../model/Supplier');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const validators = require('../validators/records');

const router = express.Router();
router.use(auth);

async function validateReferences(data) {
  if (data.category && !await Category.exists({ _id: data.category })) {
    const error = new Error('Category not found');
    error.status = 404;
    throw error;
  }
  if (data.suppliers) {
    if (!Array.isArray(data.suppliers) || data.suppliers.some(id => !mongoose.Types.ObjectId.isValid(id))) {
      const error = new Error('suppliers must be an array of valid IDs');
      error.status = 400;
      throw error;
    }
    const count = await Supplier.countDocuments({ _id: { $in: data.suppliers } });
    if (count !== data.suppliers.length) {
      const error = new Error('One or more suppliers were not found');
      error.status = 404;
      throw error;
    }
  }
}

router.get('/', asyncHandler(async (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  const filter = {};
  if (req.query.search) {
    const escaped = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: new RegExp(escaped, 'i') },
      { skuNumber: new RegExp(escaped, 'i') },
      { department: new RegExp(escaped, 'i') }
    ];
  }
  const [data, total] = await Promise.all([
    Item.find(filter).sort({ name: 1 }).skip((page - 1) * limit).limit(limit).populate('category').populate('suppliers').lean(),
    Item.countDocuments(filter)
  ]);
  res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/sku/:skuNumber', asyncHandler(async (req, res) => {
  const item = await Item.findOne({ skuNumber: req.params.skuNumber }).populate('category').populate('suppliers').lean();
  if (!item) return res.status(404).json({ success: false, message: 'Product not found' });
  return res.json({ success: true, data: item });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const query = mongoose.Types.ObjectId.isValid(req.params.id)
    ? { _id: req.params.id }
    : { skuNumber: req.params.id };
  const item = await Item.findOne(query).populate('category').populate('suppliers').lean();
  if (!item) return res.status(404).json({ success: false, message: 'Product not found' });
  return res.json({ success: true, data: item });
}));

router.post('/', asyncHandler(async (req, res) => {
  const data = validators.item(req.body || {});
  await validateReferences(data);
  const item = await Item.create(data);
  return res.status(201).json({ success: true, data: item });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid product ID' });
  }
  const data = validators.item(req.body || {}, { partial: true });
  await validateReferences(data);
  const item = await Item.findByIdAndUpdate(req.params.id, data, {
    new: true,
    runValidators: true,
    context: 'query'
  });
  if (!item) return res.status(404).json({ success: false, message: 'Product not found' });
  return res.json({ success: true, data: item });
}));

router.delete('/:id', auth.requireRole('admin'), asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid product ID' });
  }
  const item = await Item.findById(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Product not found' });
  if (await Pallet.exists({ item: item._id })) {
    return res.status(409).json({ success: false, message: 'Product has inventory and cannot be deleted' });
  }
  await item.deleteOne();
  return res.json({ success: true, message: 'Product deleted' });
}));

module.exports = router;

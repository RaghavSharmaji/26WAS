const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

function createCrudRouter({ Model, validate, beforeSave, beforeDelete }) {
  const router = express.Router();
  router.use(auth);

  router.get('/', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const records = await Model.find().sort({ createdAt: -1, date: -1, _id: -1 }).limit(limit).lean();
    res.json({ success: true, data: records });
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid record ID' });
    }
    const record = await Model.findById(req.params.id).lean();
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    return res.json({ success: true, data: record });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const body = validate(req.body || {});
    if (beforeSave) await beforeSave(body);
    const record = await Model.create(body);
    return res.status(201).json({ success: true, data: record });
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid record ID' });
    }
    const body = validate(req.body || {});
    if (beforeSave) await beforeSave(body);
    const record = await Model.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
      context: 'query'
    });
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    return res.json({ success: true, data: record });
  }));

  router.delete('/:id', auth.requireRole('admin'), asyncHandler(async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid record ID' });
    }
    const record = await Model.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
    if (beforeDelete && (await beforeDelete(record))) {
      return res.status(409).json({ success: false, message: 'Record is still referenced and cannot be deleted' });
    }
    await record.deleteOne();
    return res.json({ success: true, message: 'Record deleted' });
  }));

  return router;
}

module.exports = createCrudRouter;

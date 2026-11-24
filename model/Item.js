/* eslint-disable no-undef */
/* eslint-disable no-multi-assign */
const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const { Schema } = mongoose;

const ItemSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  name: {
    type: String,
    required: true,
    trim: true
  },
  size: {
    type: Number,
    required: true,
    min: 0
  },
  skuNumber: {
    type: String,
    required: true,
    trim: true
  },
  department: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    min: 0,
    default: 0
  },
  description: {
    type: String
  },
  ounce: {
    type: Number,
    min: 0
  },
  reorderLevel: {
    type: Number,
    default: 0,
    min: 0
  },
  category: {
    type: Schema.Types.ObjectId,
    ref: 'categories',
    default: null
  },
  suppliers: [
    {
      type: Schema.Types.ObjectId,
      ref: 'suppliers'
    }
  ],
  date: {
    type: Date,
    default: Date.now
  }
});

ItemSchema.index({ ownerId: 1, skuNumber: 1 }, { unique: true });
ItemSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('items', ItemSchema);

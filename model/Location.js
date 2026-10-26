/* eslint-disable no-undef */
/* eslint-disable no-multi-assign */
const mongoose = require('mongoose');

const { Schema } = mongoose;

const LocationSchema = new Schema({
  zone: {
    type: String,
    required: true,
    trim: true
  },
  row: {
    type: Number,
    required: true,
    min: 0
  },
  location: {
    type: Number,
    required: true,
    min: 0
  },
  level: {
    type: Number,
    required: true,
    min: 0
  },
  department: {
    type: String
  },
  fullName: {
    type: String,
    required: true,
    unique: true
  },
  warehouse: {
    type: Schema.Types.ObjectId,
    ref: 'warehouses',
    default: null,
    index: true
  },
  skuNumber: {
    type: String,
    default: null
  },
  maxSize: {
    type: Number,
    default: 0
  },
  size: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    default: 'empty'
  },
  palletId: [{ type: Schema.Types.ObjectId, ref: 'pallets' }],
  activate: [{ type: Number }],
  date: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('locations', LocationSchema);

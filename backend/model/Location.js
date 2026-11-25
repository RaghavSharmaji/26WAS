/* eslint-disable no-undef */
/* eslint-disable no-multi-assign */
const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const { Schema } = mongoose;

const LocationSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
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
    trim: true
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

LocationSchema.index({ ownerId: 1, fullName: 1 }, { unique: true });
LocationSchema.index({ companyId: 1, warehouse: 1, fullName: 1 }, { unique: true, partialFilterExpression: { companyId: { $type: 'objectId' } } });
LocationSchema.options.tenantWarehouseField = 'warehouse';
LocationSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('locations', LocationSchema);

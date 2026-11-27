'use strict';

const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const ShipmentSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'companies', default: null },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'warehouses', required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'orders', required: true },
  reference: { type: String, required: true, trim: true },
  status: { type: String, enum: ['dispatched', 'delivered'], default: 'dispatched', required: true },
  carrier: { type: String, trim: true, maxlength: 120, default: '' },
  trackingNumber: { type: String, trim: true, maxlength: 160, default: '' },
  packageIds: [{ type: mongoose.Schema.Types.ObjectId }],
  dispatchedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
  dispatchedAt: { type: Date, required: true },
  deliveredAt: { type: Date, default: null },
  deliveredTo: { type: String, trim: true, maxlength: 160, default: '' },
  deliveryNotes: { type: String, trim: true, maxlength: 1000, default: '' }
}, { timestamps: true });

ShipmentSchema.options.tenantWarehouseField = 'warehouseId';
ShipmentSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('shipments', ShipmentSchema);

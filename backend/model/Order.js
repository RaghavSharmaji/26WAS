/* eslint-disable no-undef */
/* eslint-disable no-multi-assign */
const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const { Schema } = mongoose;

const OrderLineSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'items', required: true },
  skuNumber: { type: String, required: true, trim: true },
  productName: { type: String, required: true, trim: true },
  orderedQuantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
  reservedQuantity: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  pickedQuantity: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  packedQuantity: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  allocations: [{
    palletId: { type: Schema.Types.ObjectId, ref: 'pallets', required: true },
    reservedQuantity: { type: Number, required: true, min: 0, validate: Number.isInteger },
    pickedQuantity: { type: Number, default: 0, min: 0, validate: Number.isInteger },
    dispatchedQuantity: { type: Number, default: 0, min: 0, validate: Number.isInteger }
  }]
});

const PackageLineSchema = new Schema({
  orderLineId: { type: Schema.Types.ObjectId, required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'items', required: true },
  skuNumber: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isInteger }
}, { _id: false });

const PackageSchema = new Schema({
  packageNumber: { type: Number, required: true, min: 1, validate: Number.isInteger },
  weight: { type: Number, min: 0, default: null },
  notes: { type: String, trim: true, maxlength: 500, default: '' },
  lines: { type: [PackageLineSchema], required: true }
}, { _id: true });

const OrderSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'warehouses', default: null, index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  ticketsId: [{ type: Schema.Types.ObjectId, ref: 'tickets' }],
  customerId: { type: Schema.Types.ObjectId, ref: 'customers' },
  reference: { type: String, trim: true },
  expectedDeliveryAt: { type: Date, default: null },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  lines: { type: [OrderLineSchema], default: [] },
  packages: { type: [PackageSchema], default: [] },
  assignedPickerId: { type: Schema.Types.ObjectId, ref: 'users', default: null },
  reservationKey: { type: String, default: null },
  reservationHash: { type: String, default: null },
  packingKey: { type: String, default: null },
  packingHash: { type: String, default: null },
  dispatchKey: { type: String, default: null },
  dispatchHash: { type: String, default: null },
  dispatchedAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  deliveryRecipient: { type: String, trim: true, maxlength: 160, default: '' },
  deliveryNotes: { type: String, trim: true, maxlength: 1000, default: '' },
  revision: { type: Number, min: 0, default: 0, required: true },
  status: {
    type: String
  },
  activate: [
    {
      note: { type: String },
      date: {
        type: Date,
        default: Date.now
      }
    }
  ],
  items: [
    {
      skuNumber: {
        type: String
      },
      cont: {
        type: Number
      }
    }
  ],
  itemsI: [
    {
      skuNumber: {
        type: String
      },
      cont: {
        type: Number
      }
    }
  ],
  date: {
    type: Date,
    default: Date.now
  }
});

OrderSchema.options.tenantWarehouseField = 'warehouseId';
OrderSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('orders', OrderSchema);

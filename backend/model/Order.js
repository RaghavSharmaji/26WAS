/* eslint-disable no-undef */
/* eslint-disable no-multi-assign */
const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const { Schema } = mongoose;

const OrderSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'warehouses', default: null, index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  ticketsId: [{ type: Schema.Types.ObjectId, ref: 'tickets' }],
  customerId: { type: Schema.Types.ObjectId, ref: 'customers' },
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

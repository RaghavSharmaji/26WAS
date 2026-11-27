const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');
const { Schema } = mongoose;

const TicketSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'warehouses', default: null, index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
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
  products: [
    {
      type: Schema.Types.ObjectId,
      ref: 'products'
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
  },
  cart: { type: String }
});

TicketSchema.options.tenantWarehouseField = 'warehouseId';
TicketSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('tickets', TicketSchema);

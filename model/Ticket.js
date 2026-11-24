const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');
const { Schema } = mongoose;

const TicketSchema = new Schema({
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

TicketSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('tickets', TicketSchema);

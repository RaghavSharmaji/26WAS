const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');
const { Schema } = mongoose;

const ProductSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  status: {
    type: String,
    default: 'plash'
  },
  location: {
    type: String
  },
  sku_number: {
    type: String
  },
  cont: {
    type: Number
  },
  cont_to_be_pick: {
    type: Number
  },
  ticketId: { type: Schema.Types.ObjectId, ref: 'tickets' },
  date: {
    type: Date,
    default: Date.now
  }
});

ProductSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('products', ProductSchema);

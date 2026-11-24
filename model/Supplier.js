const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const SupplierSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    name: { type: String, required: true, trim: true },
    contactName: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: undefined },
    phone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);
SupplierSchema.index({ ownerId: 1, email: 1 }, { unique: true, sparse: true });
SupplierSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('suppliers', SupplierSchema);

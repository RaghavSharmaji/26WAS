const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    contactName: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: undefined },
    phone: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);
SupplierSchema.index({ email: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('suppliers', SupplierSchema);

'use strict';

const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const CustomerSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'companies', default: null },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  contactPerson: { type: String, trim: true, maxlength: 160, default: '' },
  phone: { type: String, trim: true, maxlength: 40, default: '' },
  email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
  address: { type: String, trim: true, maxlength: 1000, default: '' },
  active: { type: Boolean, default: true }
}, { timestamps: true });

CustomerSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('customers', CustomerSchema);

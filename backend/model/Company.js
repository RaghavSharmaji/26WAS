const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxlength: 80 },
  legalBusinessName: { type: String, trim: true, maxlength: 160, default: '' },
  email: { type: String, trim: true, lowercase: true, default: '' },
  phone: { type: String, trim: true, default: '' },
  address: { type: String, trim: true, default: '' },
  logo: { type: String, trim: true, default: '' },
  industry: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['pending', 'active', 'suspended', 'deactivated'], default: 'pending', index: true },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'subscriptions', default: null }
}, { timestamps: true });

CompanySchema.index({ slug: 1 }, { unique: true });

module.exports = mongoose.model('companies', CompanySchema);

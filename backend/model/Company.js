const mongoose = require('mongoose');

const RegistrationSchema = new mongoose.Schema({
  reference: { type: String, trim: true },
  applicantUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
  status: { type: String, enum: ['pending', 'under_review', 'verified', 'rejected'], default: 'pending' },
  emailVerificationStatus: { type: String, enum: ['pending', 'verified'], default: 'pending' },
  companyEmail: { type: String, trim: true, lowercase: true, default: '' },
  businessType: { type: String, trim: true, default: '' },
  country: { type: String, trim: true, default: '' },
  state: { type: String, trim: true, default: '' },
  city: { type: String, trim: true, default: '' },
  postalCode: { type: String, trim: true, default: '' },
  website: { type: String, trim: true, default: undefined },
  gstin: { type: String, trim: true, default: undefined },
  pan: { type: String, trim: true, default: undefined },
  cin: { type: String, trim: true, default: undefined },
  businessRegistrationNumber: { type: String, trim: true, default: undefined },
  administrator: {
    name: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    designation: { type: String, trim: true, default: '' }
  },
  warehouseRequirements: {
    expectedWarehouses: { type: Number, min: 1, default: 1 },
    approximateSkus: { type: Number, min: 0, default: 0 },
    monthlyOrders: { type: Number, min: 0, default: 0 },
    employees: { type: Number, min: 1, default: 1 },
    primaryWarehouseName: { type: String, trim: true, default: '' },
    primaryWarehouseType: { type: String, trim: true, default: '' },
    primaryWarehouseAddress: { type: String, trim: true, default: '' }
  },
  settings: {
    currency: { type: String, trim: true, uppercase: true, default: 'INR' },
    timeZone: { type: String, trim: true, default: 'Asia/Kolkata' },
    measurementUnits: { type: String, enum: ['metric', 'imperial'], default: 'metric' }
  },
  acceptance: {
    acceptedAt: { type: Date },
    termsVersion: { type: String, default: '' },
    privacyVersion: { type: String, default: '' },
    accuracyConfirmed: { type: Boolean, default: false }
  },
  submittedAt: { type: Date },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users', default: null },
  reviewedAt: { type: Date, default: null },
  reviewReason: { type: String, trim: true, default: '' }
}, { _id: false });

const OnboardingSchema = new mongoose.Schema({
  completedSteps: { type: [String], default: [] },
  skippedSteps: { type: [String], default: [] },
  completedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: null }
}, { _id: false });

const CompanySettingsSchema = new mongoose.Schema({
  currency: { type: String, trim: true, uppercase: true, default: 'INR', match: /^[A-Z]{3}$/ },
  timeZone: { type: String, trim: true, default: 'Asia/Kolkata' },
  measurementUnits: { type: String, enum: ['metric', 'imperial'], default: 'metric' }
}, { _id: false });

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
  membershipRevision: { type: Number, default: 0, min: 0 },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'subscriptions', default: null },
  registration: { type: RegistrationSchema, default: undefined },
  onboarding: { type: OnboardingSchema, default: () => ({}) },
  settings: { type: CompanySettingsSchema, default: () => ({}) }
}, { timestamps: true });

CompanySchema.index({ slug: 1 }, { unique: true });
// These declarations support safe duplicate detection for new applications. Review and deploy
// indexes separately after the read-only index audit; application startup does not run migrations.
CompanySchema.index({ 'registration.reference': 1 }, { unique: true, sparse: true });
CompanySchema.index({ 'registration.companyEmail': 1 }, { unique: true, sparse: true });
CompanySchema.index({ 'registration.administrator.email': 1 }, { unique: true, sparse: true });
CompanySchema.index({ 'registration.gstin': 1 }, { unique: true, sparse: true });
CompanySchema.index({ 'registration.pan': 1 }, { unique: true, sparse: true });
CompanySchema.index({ 'registration.cin': 1 }, { unique: true, sparse: true });
CompanySchema.index({ 'registration.businessRegistrationNumber': 1 }, { unique: true, sparse: true });
// Avoid automatic index creation on application startup; review duplicate data and deploy indexes explicitly.
CompanySchema.set('autoIndex', false);

module.exports = mongoose.model('companies', CompanySchema);

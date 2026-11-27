const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const validator = require('validator');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const User = require('../model/User');
const Warehouse = require('../model/Warehouse');
const Location = require('../model/Location');
const Item = require('../model/Item');
const Supplier = require('../model/Supplier');
const AuditLog = require('../model/AuditLog');
const { isSuperAdminRole } = require('../middleware/roleCompatibility');
const tenantContext = require('../middleware/tenantContext');
const { KNOWN_PERMISSION_IDS, effectivePermissions } = require('../middleware/permissions');

const router = express.Router();

// Public registration is intentionally mounted before the authenticated company API.
// Registration creates a pending tenant and a Company Admin membership, never operational access.
const REGISTRATION_TERMS_VERSION = 'wareflow-terms-draft-1';
const REGISTRATION_PRIVACY_VERSION = 'wareflow-privacy-draft-1';
const REQUIRED_REGISTRATION_INDEX_FIELDS = [
  'registration.reference', 'registration.companyEmail', 'registration.administrator.email',
  'registration.gstin', 'registration.pan', 'registration.cin', 'registration.businessRegistrationNumber'
];
const registrationEnums = {
  businessType: new Set(['proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'other']),
  industry: new Set(['manufacturing', 'wholesale', 'retail', 'e-commerce', 'logistics', 'distribution', 'pharmaceuticals', 'food_beverage', 'electronics', 'other']),
  warehouseType: new Set(['distribution', 'fulfillment', 'cold_storage', 'manufacturing', 'retail', 'other'])
};
function registrationError(status, message, code) { return Object.assign(new Error(message), { status, code }); }
function requiredText(value, label, max = 160) {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > max) throw registrationError(400, `${label} must be 2 to ${max} characters.`);
  return value.trim();
}
function optionalText(value, label, max = 160) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.trim().length > max) throw registrationError(400, `${label} must be at most ${max} characters.`);
  return value.trim();
}
function registrationPhone(value, label, country) {
  const phone = requiredText(value, label, 25);
  const digits = phone.replace(/[\s().-]/g, '');
  if (!/^\+?[1-9]\d{7,14}$/.test(digits) || (String(country).toLowerCase() === 'india' && !/^\+?91\d{10}$/.test(digits) && !/^\d{10}$/.test(digits))) {
    throw registrationError(400, `${label} must be a valid phone number${String(country).toLowerCase() === 'india' ? ' for India' : ''}.`);
  }
  return phone;
}
function boundedCount(value, label, { min = 0, max = 100000000 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw registrationError(400, `${label} must be a whole number from ${min} to ${max}.`);
  return number;
}
function validateRegistration(body) {
  const assertKeys = (object, allowed, label) => {
    const unexpected = Object.keys(object || {}).find(key => !allowed.includes(key));
    if (unexpected) throw registrationError(400, `Unsupported ${label} field: ${unexpected}.`);
  };
  assertKeys(body, ['company', 'administrator', 'warehouseRequirements', 'acceptance'], 'registration');
  assertKeys(body.company, ['legalName', 'displayName', 'businessType', 'industry', 'email', 'phone', 'country', 'state', 'city', 'address', 'postalCode', 'website', 'gstin', 'pan', 'cin', 'businessRegistrationNumber'], 'company');
  assertKeys(body.administrator, ['name', 'designation', 'email', 'phone', 'password', 'confirmPassword'], 'administrator');
  assertKeys(body.warehouseRequirements, ['expectedWarehouses', 'approximateSkus', 'monthlyOrders', 'employees', 'primaryWarehouseName', 'primaryWarehouseType', 'primaryWarehouseAddress', 'currency', 'timeZone', 'measurementUnits'], 'warehouse requirements');
  assertKeys(body.acceptance, ['terms', 'privacy', 'accuracy'], 'acceptance');
  const company = body.company;
  const administrator = body.administrator;
  const warehouse = body.warehouseRequirements;
  if (!company || !administrator || !warehouse || !body.acceptance) throw registrationError(400, 'Company, administrator, warehouse requirements, and acceptance details are required.');
  const country = requiredText(company.country, 'Country', 80);
  const companyEmail = String(company.email || '').trim().toLowerCase();
  const adminEmail = String(administrator.email || '').trim().toLowerCase();
  if (!validator.isEmail(companyEmail) || companyEmail.length > 254) throw registrationError(400, 'A valid official company email is required.');
  if (!validator.isEmail(adminEmail) || adminEmail.length > 254) throw registrationError(400, 'A valid administrator work email is required.');
  if (!registrationEnums.businessType.has(company.businessType)) throw registrationError(400, 'Choose a supported business type.');
  if (!registrationEnums.industry.has(company.industry)) throw registrationError(400, 'Choose a supported industry.');
  if (!registrationEnums.warehouseType.has(warehouse.primaryWarehouseType)) throw registrationError(400, 'Choose a supported primary warehouse type.');
  const website = optionalText(company.website, 'Website', 240);
  if (website && !validator.isURL(website, { require_protocol: false })) throw registrationError(400, 'Website must be a valid URL.');
  const pan = optionalText(company.pan, 'PAN', 10).toUpperCase();
  const gstin = optionalText(company.gstin, 'GSTIN', 15).toUpperCase();
  const cin = optionalText(company.cin, 'CIN/LLPIN', 21).toUpperCase();
  const countryIsIndia = country.toLowerCase() === 'india';
  if (pan && countryIsIndia && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw registrationError(400, 'PAN format is invalid.');
  if (gstin && countryIsIndia && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gstin)) throw registrationError(400, 'GSTIN format is invalid.');
  if (gstin && pan && gstin.slice(2, 12) !== pan) throw registrationError(400, 'GSTIN and PAN values do not match.');
  if (cin && countryIsIndia && !/^[A-Z0-9]{8,21}$/.test(cin)) throw registrationError(400, 'CIN/LLPIN format is invalid.');
  const password = administrator.password;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) throw registrationError(400, 'Password must be 12 to 128 characters and include lowercase, uppercase, number, and symbol characters.');
  if (password !== administrator.confirmPassword) throw registrationError(400, 'Password confirmation does not match.');
  const acceptance = body.acceptance;
  if (acceptance.terms !== true || acceptance.privacy !== true || acceptance.accuracy !== true) throw registrationError(400, 'Accept the Terms, Privacy Notice, and information accuracy confirmation to submit.');
  const timeZone = optionalText(warehouse.timeZone, 'Time zone', 80) || (countryIsIndia ? 'Asia/Kolkata' : 'UTC');
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date()); }
  catch (_) { throw registrationError(400, 'Time zone must be a valid IANA time zone.'); }
  return {
    company: {
      legalBusinessName: requiredText(company.legalName, 'Legal company name'),
      name: requiredText(company.displayName, 'Company display name', 120),
      businessType: company.businessType,
      industry: company.industry,
      email: companyEmail,
      phone: registrationPhone(company.phone, 'Company phone', country),
      country,
      state: requiredText(company.state, 'State/Province', 100),
      city: requiredText(company.city, 'City', 100),
      address: requiredText(company.address, 'Registered address', 500),
      postalCode: requiredText(company.postalCode, 'Postal/PIN code', 20),
      website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : '',
      pan, gstin, cin, businessRegistrationNumber: optionalText(company.businessRegistrationNumber, 'Business registration number', 80).toUpperCase()
    },
    administrator: {
      name: requiredText(administrator.name, 'Administrator full name', 80),
      designation: requiredText(administrator.designation, 'Administrator designation', 100),
      email: adminEmail,
      phone: registrationPhone(administrator.phone, 'Administrator mobile', country),
      password
    },
    warehouseRequirements: {
      expectedWarehouses: boundedCount(warehouse.expectedWarehouses, 'Expected warehouses', { min: 1, max: 10000 }),
      approximateSkus: boundedCount(warehouse.approximateSkus, 'Approximate SKUs'),
      monthlyOrders: boundedCount(warehouse.monthlyOrders, 'Monthly order volume'),
      employees: boundedCount(warehouse.employees, 'Expected employees', { min: 1 }),
      primaryWarehouseName: requiredText(warehouse.primaryWarehouseName, 'Primary warehouse name', 120),
      primaryWarehouseType: warehouse.primaryWarehouseType,
      primaryWarehouseAddress: requiredText(warehouse.primaryWarehouseAddress, 'Primary warehouse address', 500)
    },
    settings: {
      currency: optionalText(warehouse.currency, 'Currency', 3).toUpperCase() || (countryIsIndia ? 'INR' : 'USD'),
      timeZone,
      measurementUnits: warehouse.measurementUnits === undefined ? 'metric' : warehouse.measurementUnits
    }
  };
}

async function assertRegistrationIndexesReady() {
  let indexes;
  try { indexes = await Company.collection.indexes(); }
  catch (_) { throw registrationError(503, 'Company registration is temporarily unavailable because required uniqueness indexes could not be checked.', 'REGISTRATION_INDEXES_UNAVAILABLE'); }
  const missing = REQUIRED_REGISTRATION_INDEX_FIELDS.filter(field => !indexes.some(index =>
    index.unique === true && index.sparse === true && Object.keys(index.key || {}).length === 1 && index.key[field] === 1
  ));
  if (missing.length) throw registrationError(503, `Company registration is not ready: deploy the reviewed unique indexes for ${missing.join(', ')} before accepting applications.`, 'REGISTRATION_INDEXES_NOT_READY');
}

router.post('/register', asyncHandler(async (req, res) => {
  const input = validateRegistration(req.body || {});
  await assertRegistrationIndexesReady();
  if (!['metric', 'imperial'].includes(input.settings.measurementUnits)) throw registrationError(400, 'Measurement units must be metric or imperial.');
  if (!/^[A-Z]{3}$/.test(input.settings.currency)) throw registrationError(400, 'Currency must be a three-letter currency code.');
  const companyEmail = input.company.email;
  const adminEmail = input.administrator.email;
  const existingUser = await User.findOne({ email: adminEmail }).select('_id').lean();
  if (existingUser) throw registrationError(409, 'An account already exists for this administrator email. Log in and ask a Super Admin to review company access; registration will not alter existing accounts.', 'ACCOUNT_ALREADY_EXISTS');
  const identifierFilters = [];
  if (input.company.gstin) identifierFilters.push({ 'registration.gstin': input.company.gstin });
  if (input.company.pan) identifierFilters.push({ 'registration.pan': input.company.pan });
  if (input.company.cin) identifierFilters.push({ 'registration.cin': input.company.cin });
  const duplicateCompany = await Company.findOne({ $or: [
    { email: companyEmail }, { 'registration.companyEmail': companyEmail },
    ...(identifierFilters.length ? identifierFilters : [])
  ] }).select('_id').lean();
  if (duplicateCompany) throw registrationError(409, 'A company registration with this company email or legal identifier already exists.', 'DUPLICATE_COMPANY_REGISTRATION');

  const reference = `WF-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const slug = `${normalizeSlug(input.company.name).slice(0, 62)}-${crypto.randomBytes(3).toString('hex')}`;
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const racedUser = await User.findOne({ email: adminEmail }).select('_id').session(session).lean();
      if (racedUser) throw registrationError(409, 'An account already exists for this administrator email.', 'ACCOUNT_ALREADY_EXISTS');
      const duplicate = await Company.findOne({ $or: [
        { email: companyEmail }, { 'registration.companyEmail': companyEmail },
        ...(identifierFilters.length ? identifierFilters : [])
      ] }).select('_id').session(session).lean();
      if (duplicate) throw registrationError(409, 'A company registration with this company email or legal identifier already exists.', 'DUPLICATE_COMPANY_REGISTRATION');
      const [user] = await User.create([{
        name: input.administrator.name,
        email: adminEmail,
        password: await bcrypt.hash(input.administrator.password, 12),
        role: 'staff', clearance: ['staff'], accountStatus: 'active', status: 'on',
        phone: input.administrator.phone, emailVerificationStatus: 'pending'
      }], { session });
      const [company] = await Company.create([{
        name: input.company.name,
        slug,
        legalBusinessName: input.company.legalBusinessName,
        email: companyEmail,
        phone: input.company.phone,
        address: input.company.address,
        industry: input.company.industry,
        settings: input.settings,
        status: 'pending',
        registration: {
          reference, applicantUserId: user._id, status: 'pending', emailVerificationStatus: 'pending', companyEmail,
          businessType: input.company.businessType, country: input.company.country, state: input.company.state,
          city: input.company.city, postalCode: input.company.postalCode,
          ...(input.company.website ? { website: input.company.website } : {}),
          ...(input.company.gstin ? { gstin: input.company.gstin } : {}),
          ...(input.company.pan ? { pan: input.company.pan } : {}),
          ...(input.company.cin ? { cin: input.company.cin } : {}),
          ...(input.company.businessRegistrationNumber ? { businessRegistrationNumber: input.company.businessRegistrationNumber } : {}),
          administrator: { name: input.administrator.name, email: adminEmail, phone: input.administrator.phone, designation: input.administrator.designation },
          warehouseRequirements: input.warehouseRequirements, settings: input.settings,
          acceptance: { acceptedAt: new Date(), termsVersion: REGISTRATION_TERMS_VERSION, privacyVersion: REGISTRATION_PRIVACY_VERSION, accuracyConfirmed: true },
          submittedAt: new Date()
        }
      }], { session });
      await CompanyMembership.create([{
        userId: user._id, companyId: company._id, role: 'company_admin', status: 'active', revision: 0
      }], { session });
      await AuditLog.create([{
        companyId: company._id, actor: user._id, targetUser: user._id,
        action: 'company.registration.submitted',
        details: { reference, submittedStatus: 'pending', termsVersion: REGISTRATION_TERMS_VERSION, privacyVersion: REGISTRATION_PRIVACY_VERSION, emailVerificationStatus: 'pending' },
        createdAt: new Date()
      }], { session });
      result = { reference, companyName: company.name, status: company.registration.status, submittedAt: company.registration.submittedAt };
    });
  } catch (error) {
    if (error?.code === 11000) throw registrationError(409, 'A registration already exists with one of the supplied unique details.', 'DUPLICATE_COMPANY_REGISTRATION');
    throw error;
  } finally {
    await session.endSession();
  }
  return res.status(201).json({ success: true, data: result, message: 'Company application submitted. Email verification is not configured and remains pending.' });
}));

router.use(auth);
router.use((req, res, next) => {
  if (req.auth && isSuperAdminRole(req.auth.role)) {
    return res.status(403).json({ success: false, code: 'PLATFORM_ROUTE_REQUIRED', message: 'Use a platform administration endpoint for this action' });
  }
  return next();
});

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

const membershipRoles = ['company_admin', 'warehouse_manager', 'staff', 'auditor'];
const warehouseScopedMembershipRoles = ['warehouse_manager', 'warehouse_staff', 'staff', 'inventory_manager', 'procurement_manager', 'auditor'];
const MAX_AUDIT_REASON_LENGTH = 500;

function requestError(status, message, code) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function assertAllowedFields(body, allowed) {
  const unexpected = Object.keys(body || {}).filter(key => !allowed.includes(key));
  if (unexpected.length) throw requestError(400, `Unsupported membership field: ${unexpected[0]}.`);
}

function validateReason(value) {
  if (typeof value !== 'string') throw requestError(400, 'A non-empty audit reason is required as text.');
  const reason = value.trim();
  if (!reason) throw requestError(400, 'A non-empty audit reason is required.');
  if (reason.length > MAX_AUDIT_REASON_LENGTH) throw requestError(400, `Audit reason must be at most ${MAX_AUDIT_REASON_LENGTH} characters.`);
  return reason;
}

function validateWarehouseIds(value, { required = false } = {}) {
  if (value === undefined) value = [];
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id))) {
    throw requestError(400, 'assignedWarehouseIds must be an array of valid warehouse IDs.');
  }
  const ids = value.map(String);
  if (new Set(ids).size !== ids.length) throw requestError(400, 'assignedWarehouseIds must not contain duplicates.');
  if (required && ids.length === 0) throw requestError(400, 'At least one warehouse assignment is required for this membership role.');
  return ids;
}

async function assertWarehousesInCompany(companyId, ids, session) {
  if (!ids.length) return;
  const query = Warehouse.countDocuments({ _id: { $in: ids }, companyId, active: { $ne: false } });
  if (session) query.session(session);
  const count = await query.exec();
  if (count !== ids.length) throw requestError(400, 'Every assigned warehouse must be active and belong to this company.');
}

function membershipRevision(row) {
  return Number.isSafeInteger(row?.revision) && row.revision >= 0 ? row.revision : 0;
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw requestError(400, 'A non-negative expectedRevision is required. Refresh the membership details and retry.');
  return value;
}

function revisionCondition(revision) {
  // Legacy membership documents may not have been written with the revision field.
  return revision === 0 ? { $in: [0, null] } : revision;
}

function publicMembership(row) {
  return {
    id: String(row._id),
    user: row.userId ? {
      id: String(row.userId._id || row.userId),
      ...(row.userId.name ? { name: row.userId.name } : {}),
      ...(row.userId.email ? { email: row.userId.email } : {}),
      ...(row.userId.accountStatus ? { accountStatus: row.userId.accountStatus } : {})
    } : null,
    companyId: String(row.companyId), role: row.role, status: row.status,
    assignedWarehouseIds: (row.assignedWarehouseIds || []).map(String),
    permissionOverrides: (row.permissionOverrides || []).map(value => ({ permission: value.permission, effect: value.effect })),
    revision: membershipRevision(row)
  };
}

function companyPublic(company) {
  return {
    id: String(company._id), name: company.name, slug: company.slug, legalBusinessName: company.legalBusinessName,
    email: company.email, phone: company.phone, address: company.address, logo: company.logo,
    industry: company.industry, status: company.status, subscriptionId: company.subscriptionId || null,
    settings: company.settings ? { currency: company.settings.currency, timeZone: company.settings.timeZone, measurementUnits: company.settings.measurementUnits } : undefined
  };
}

async function membershipFor(userId, companyId) {
  return CompanyMembership.findOne({ userId, companyId, status: 'active' }).lean();
}

async function lockMembershipWrites(session, companyId) {
  const result = await Company.updateOne(
    { _id: companyId, status: 'active' }, { $inc: { membershipRevision: 1 } }, { session }
  );
  if (!result || result.matchedCount !== 1) {
    throw Object.assign(new Error('Company is no longer active; membership change was not applied'), { status: 409, code: 'COMPANY_UNAVAILABLE' });
  }
}

async function assertActiveActor(session, userId) {
  const actorQuery = User.findById(userId).select('_id role accountStatus deletedAt');
  if (session) actorQuery.session(session);
  const actor = await actorQuery.lean();
  if (!actor || actor.accountStatus !== 'active' || (actor.deletedAt !== null && actor.deletedAt !== undefined)) {
    throw requestError(403, 'The acting user account is inactive, deleted, or unavailable.', 'ACTOR_ACCOUNT_UNAVAILABLE');
  }
  if (isSuperAdminRole(actor.role)) {
    throw requestError(403, 'Platform administrators must use platform administration endpoints.', 'PLATFORM_ROUTE_REQUIRED');
  }
  return actor;
}

async function assertActiveCompanyAdmin(session, userId, companyId, authenticatedContext) {
  await assertActiveActor(session, userId);
  const currentQuery = CompanyMembership.findOne({ userId, companyId, status: 'active' })
    .session(session);
  const current = await currentQuery.lean();
  if (!current || current.role !== 'company_admin') {
    throw Object.assign(new Error('Active Company Admin membership is required'), {
      status: 403,
      code: 'COMPANY_ADMIN_REQUIRED'
    });
  }
  const currentRevision = membershipRevision(current);
  if (Number.isSafeInteger(authenticatedContext?.membershipRevision)
    && authenticatedContext.membershipRevision !== currentRevision) {
    throw requestError(403, 'Company Admin authorization changed; refresh your session and retry.', 'COMPANY_ADMIN_AUTHORIZATION_STALE');
  }
}

function requireCompanyAdminContext(req, res, next) {
  if (!req.tenant?.companyId || String(req.tenant.companyId) !== String(req.params.companyId)) {
    return res.status(403).json({ success: false, code: 'COMPANY_CONTEXT_REQUIRED', message: 'Select this company before managing its memberships.' });
  }
  if (req.tenant.membershipRole !== 'company_admin') {
    return res.status(403).json({ success: false, code: 'COMPANY_ADMIN_REQUIRED', message: 'Company Admin permission is required.' });
  }
  return next();
}

router.use('/:companyId/members', tenantContext(), requireCompanyAdminContext);
router.use('/:companyId/onboarding', tenantContext({ blockPending: true }), requireCompanyAdminContext);
router.use('/:companyId/settings', tenantContext({ blockPending: true }), requireCompanyAdminContext);

router.get('/registration/status', asyncHandler(async (req, res) => {
  const applications = await Company.find({ 'registration.applicantUserId': req.auth.id })
    .select('_id name registration.reference registration.status registration.submittedAt registration.reviewedAt registration.reviewReason registration.emailVerificationStatus status')
    .sort({ 'registration.submittedAt': -1 }).lean();
  return res.json({ success: true, data: applications.map(company => ({
    companyId: String(company._id), companyName: company.name,
    reference: company.registration?.reference,
    status: company.registration?.status || 'pending',
    companyStatus: company.status,
    submittedAt: company.registration?.submittedAt || company.createdAt,
    reviewedAt: company.registration?.reviewedAt || null,
    feedback: company.registration?.reviewReason || '',
    emailVerificationStatus: company.registration?.emailVerificationStatus || 'pending'
  })) });
}));

const onboardingStepNames = ['profile', 'warehouse', 'locations', 'products', 'suppliers', 'team', 'roles'];
router.get('/:companyId/onboarding', asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const company = await Company.findById(companyId).select('name registration onboarding status settings').lean();
  if (!company || company.status !== 'active') throw requestError(404, 'Active company not found.');
  const [warehouses, locations, products, suppliers, members] = await Promise.all([
    Warehouse.countDocuments({ companyId, active: { $ne: false } }),
    Location.countDocuments({ companyId }), Item.countDocuments({ companyId }),
    Supplier.countDocuments({ companyId }), CompanyMembership.countDocuments({ companyId, status: 'active', role: { $ne: 'company_admin' } })
  ]);
  const counts = { warehouse: warehouses, locations, products, suppliers, team: members };
  const completed = new Set(company.onboarding?.completedSteps || []);
  for (const step of ['warehouse', 'locations', 'products', 'suppliers', 'team']) if (counts[step] > 0) completed.add(step);
  const skipped = new Set(company.onboarding?.skippedSteps || []);
  const steps = onboardingStepNames.map(id => ({
    id, completed: completed.has(id), skipped: skipped.has(id),
    count: Object.prototype.hasOwnProperty.call(counts, id) ? counts[id] : null
  }));
  return res.json({ success: true, data: {
    companyId: String(company._id), companyName: company.name,
    settings: company.settings || { currency: 'INR', timeZone: 'Asia/Kolkata', measurementUnits: 'metric' },
    steps, completedCount: steps.filter(step => step.completed).length,
    totalSteps: steps.length, complete: steps.every(step => step.completed || step.skipped)
  } });
}));

router.patch('/:companyId/onboarding', asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const { step, action } = req.body || {};
  if (!onboardingStepNames.includes(step) || !['complete', 'skip', 'unskip'].includes(action)) throw requestError(400, 'Choose a supported onboarding step and action.');
  if (step === 'profile' && action !== 'complete') throw requestError(400, 'Company profile cannot be skipped.');
  if (step === 'warehouse' && action === 'skip') throw requestError(400, 'At least one real warehouse is required before completing setup.');
  if (step === 'roles' && action === 'skip') throw requestError(400, 'Role and permission review cannot be skipped.');
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      await assertActiveCompanyAdmin(session, req.auth.id, companyId, req.tenant);
      const counts = {
        warehouse: await Warehouse.countDocuments({ companyId, active: { $ne: false } }).session(session),
        locations: await Location.countDocuments({ companyId }).session(session),
        products: await Item.countDocuments({ companyId }).session(session),
        suppliers: await Supplier.countDocuments({ companyId }).session(session),
        team: await CompanyMembership.countDocuments({ companyId, status: 'active', role: { $ne: 'company_admin' } }).session(session)
      };
      if (action === 'complete' && ['warehouse', 'locations', 'products', 'suppliers', 'team'].includes(step) && counts[step] < 1) {
        throw requestError(409, `Create at least one ${step === 'team' ? 'employee membership' : step} record before marking this step complete.`, 'ONBOARDING_STEP_INCOMPLETE');
      }
      const company = await Company.findById(companyId).session(session);
      if (!company || company.status !== 'active') throw requestError(409, 'Company must be active to update onboarding.');
      const completed = new Set(company.onboarding?.completedSteps || []);
      const skipped = new Set(company.onboarding?.skippedSteps || []);
      if (action === 'complete') { completed.add(step); skipped.delete(step); }
      if (action === 'skip') { skipped.add(step); completed.delete(step); }
      if (action === 'unskip') skipped.delete(step);
      const complete = onboardingStepNames.every(id => completed.has(id) || skipped.has(id));
      company.onboarding = { completedSteps: [...completed], skippedSteps: [...skipped], completedAt: complete ? new Date() : null, updatedAt: new Date() };
      await company.save({ session });
      await AuditLog.create([{
        companyId, actor: req.auth.id, action: `company.onboarding.${action}`,
        details: { step, action }, createdAt: new Date()
      }], { session });
      updated = company.onboarding;
    });
  } finally { await session.endSession(); }
  return res.json({ success: true, data: { completedSteps: updated.completedSteps, skippedSteps: updated.skippedSteps, completedAt: updated.completedAt } });
}));

router.get('/:companyId/settings', asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.companyId).select('settings status').lean();
  if (!company || company.status !== 'active') throw requestError(404, 'Active company not found.');
  return res.json({ success: true, data: company.settings || { currency: 'INR', timeZone: 'Asia/Kolkata', measurementUnits: 'metric' } });
}));

router.patch('/:companyId/settings', asyncHandler(async (req, res) => {
  const body = req.body || {};
  assertAllowedFields(body, ['currency', 'timeZone', 'measurementUnits']);
  const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
  const timeZone = typeof body.timeZone === 'string' ? body.timeZone.trim() : '';
  const measurementUnits = body.measurementUnits;
  if (!/^[A-Z]{3}$/.test(currency)) throw requestError(400, 'Currency must be a three-letter ISO-style code.');
  if (timeZone.length < 1 || timeZone.length > 80) throw requestError(400, 'A valid IANA time zone is required.');
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date()); }
  catch (_) { throw requestError(400, 'Time zone must be a valid IANA time zone.'); }
  if (!['metric', 'imperial'].includes(measurementUnits)) throw requestError(400, 'Measurement units must be metric or imperial.');
  const session = await mongoose.startSession();
  let settings;
  try {
    await session.withTransaction(async () => {
      await assertActiveCompanyAdmin(session, req.auth.id, req.params.companyId, req.tenant);
      const company = await Company.findById(req.params.companyId).session(session);
      if (!company || company.status !== 'active') throw requestError(409, 'Company is not active.');
      company.settings = { currency, timeZone, measurementUnits };
      await company.save({ session });
      await AuditLog.create([{
        companyId: company._id, actor: req.auth.id, action: 'company.settings.updated',
        details: { currency, timeZone, measurementUnits }, createdAt: new Date()
      }], { session });
      settings = company.settings;
    });
  } finally { await session.endSession(); }
  return res.json({ success: true, data: { currency: settings.currency, timeZone: settings.timeZone, measurementUnits: settings.measurementUnits } });
}));

router.get('/mine', asyncHandler(async (req, res) => {
  const memberships = await CompanyMembership.find({ userId: req.auth.id, status: 'active' })
    .select('companyId role assignedWarehouseIds permissionOverrides').lean();
  const companies = await Promise.all(memberships.map(async membership => {
    const company = await Company.findById(membership.companyId).select('name slug status settings registration.reference registration.status registration.applicantUserId').lean();
    if (!company) return null;
    return {
      ...companyPublic(company), role: membership.role,
      ...(String(company.registration?.applicantUserId || '') === String(req.auth.id) ? { registration: {
        reference: company.registration.reference, status: company.registration.status
      } } : {}),
      assignedWarehouseIds: (membership.assignedWarehouseIds || []).map(String),
      permissionOverrides: (membership.permissionOverrides || []).map(value => ({ permission: value.permission, effect: value.effect })),
      permissions: effectivePermissions(membership.role, membership.permissionOverrides)
    };
  }));
  return res.json({ success: true, data: companies.filter(Boolean) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = normalizeSlug(body.slug || body.code || name);
  if (name.length < 2 || name.length > 120 || !slug) {
    return res.status(400).json({ success: false, message: 'Company name and a valid company code are required' });
  }
  if (body.email && (typeof body.email !== 'string' || !validator.isEmail(body.email))) {
    return res.status(400).json({ success: false, message: 'Company email must be valid' });
  }
  const allowed = ['legalBusinessName', 'phone', 'address', 'logo', 'industry'];
  const values = {};
  allowed.forEach(key => {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string' || body[key].length > (key === 'address' ? 500 : 200)) {
        throw Object.assign(new Error(`${key} must be text within the allowed length`), { status: 400 });
      }
      values[key] = body[key].trim();
    }
  });
  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      await assertActiveActor(session, req.auth.id);
      const [company] = await Company.create([{
        name, slug, ...values, email: String(body.email || '').trim().toLowerCase(), status: 'pending'
      }], { session });
      await CompanyMembership.create([{
        userId: req.auth.id, companyId: company._id, role: 'company_admin', status: 'active'
      }], { session });
      created = company;
    });
  } finally {
    await session.endSession();
  }
  return res.status(201).json({ success: true, data: { ...companyPublic(created), role: 'company_admin' } });
}));

router.post('/:companyId/select', asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(companyId)) return res.status(400).json({ success: false, message: 'Invalid company ID' });
  const membership = await membershipFor(req.auth.id, companyId);
  if (!membership) return res.status(403).json({ success: false, code: 'COMPANY_MEMBERSHIP_REQUIRED', message: 'You are not an active member of this company' });
  const company = await Company.findById(companyId).select('name slug status settings').lean();
  if (!company || company.status !== 'active') {
    const pending = company?.status === 'pending';
    return res.status(403).json({
      success: false,
      code: pending ? 'COMPANY_PENDING' : 'COMPANY_UNAVAILABLE',
      message: pending ? 'Your company is awaiting activation by a platform administrator.' : 'This company is suspended or unavailable.'
    });
  }
  return res.json({ success: true, data: { ...companyPublic(company), role: membership.role } });
}));

router.post('/:companyId/members', asyncHandler(async (req, res, next) => {
  const { companyId } = req.params;
  assertAllowedFields(req.body, ['email', 'role', 'assignedWarehouseIds', 'reason']);
  const reason = validateReason(req.body?.reason);
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const role = req.body?.role || 'staff';
  if (!validator.isEmail(email) || !membershipRoles.includes(role)) {
    throw requestError(400, 'A valid existing user email and permitted company role are required.');
  }
  const assignedWarehouseIds = validateWarehouseIds(req.body?.assignedWarehouseIds, {
    required: warehouseScopedMembershipRoles.includes(role)
  });
  const user = await User.findOne({ email }).select('_id name email role accountStatus deletedAt').lean();
  if (!user || isSuperAdminRole(user.role) || user.accountStatus !== 'active' || user.deletedAt) {
    return res.status(404).json({ success: false, message: 'An active WareFlow user with that email was not found.' });
  }
  try {
    const session = await mongoose.startSession();
    let created;
    try {
      await session.withTransaction(async () => {
        await lockMembershipWrites(session, companyId);
        await assertActiveCompanyAdmin(session, req.auth.id, companyId, req.tenant);
        const activeUser = await User.findOne({
          _id: user._id, accountStatus: 'active', deletedAt: null,
          role: { $nin: ['super_admin', 'superadmin'] }
        }).select('_id').session(session).lean();
        if (!activeUser) throw requestError(404, 'An active WareFlow user with that email was not found.');
        await assertWarehousesInCompany(companyId, assignedWarehouseIds, session);
        [created] = await CompanyMembership.create([{
          userId: user._id, companyId, role, status: 'active', assignedWarehouseIds, revision: 0
        }], { session });
        await AuditLog.create([{
          actor: req.auth.id, targetUser: user._id, companyId, action: 'company.membership.created',
          details: {
            actorUserId: String(req.auth.id), targetUserId: String(user._id), reason,
            previousRole: null, newRole: role, previousWarehouseAssignments: [],
            newWarehouseAssignments: assignedWarehouseIds, previousStatus: null, newStatus: 'active'
          }
        }], { session });
      });
    } finally { await session.endSession(); }
    return res.status(201).json({ success: true, data: {
      id: String(created._id), user: { id: String(user._id), name: user.name, email: user.email },
      companyId, role: created.role, status: created.status,
      assignedWarehouseIds: (created.assignedWarehouseIds || []).map(String), revision: membershipRevision(created)
    } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'This user is already a member of the company.' });
    return next(error);
  }
}));
router.get('/:companyId/members/:userId', asyncHandler(async (req, res) => {
  const { companyId, userId } = req.params;
  if (![companyId, userId].every(mongoose.Types.ObjectId.isValid)) throw requestError(400, 'Invalid company or user ID.');
  const row = await CompanyMembership.findOne({ companyId, userId })
    .populate('userId', 'name email accountStatus deletedAt').lean();
  if (!row || !row.userId || row.userId.deletedAt) return res.status(404).json({ success: false, message: 'Membership not found.' });
  return res.json({ success: true, data: publicMembership(row) });
}));

router.patch('/:companyId/members/:userId', asyncHandler(async (req, res) => {
  const { companyId, userId } = req.params;
  if (![companyId, userId].every(mongoose.Types.ObjectId.isValid)) throw requestError(400, 'Invalid company or user ID.');
  assertAllowedFields(req.body, ['role', 'assignedWarehouseIds', 'status', 'reason', 'expectedRevision']);
  const reason = validateReason(req.body?.reason);
  const expected = expectedRevision(req.body?.expectedRevision);
  const hasRole = Object.prototype.hasOwnProperty.call(req.body || {}, 'role');
  const hasAssignments = Object.prototype.hasOwnProperty.call(req.body || {}, 'assignedWarehouseIds');
  const hasStatus = Object.prototype.hasOwnProperty.call(req.body || {}, 'status');
  if (!hasRole && !hasAssignments && !hasStatus) throw requestError(400, 'Provide a role, warehouse assignment, or explicit reactivation change.');
  if (hasStatus && req.body.status !== 'active') throw requestError(400, 'Memberships can only be reactivated with status active; use DELETE to revoke.');

  const session = await mongoose.startSession();
  let updated;
  let action;
  try {
    await session.withTransaction(async () => {
      await lockMembershipWrites(session, companyId);
      await assertActiveCompanyAdmin(session, req.auth.id, companyId, req.tenant);
      const current = await CompanyMembership.findOne({ companyId, userId }).session(session);
      if (!current) throw requestError(404, 'Membership not found.');
      if (membershipRevision(current) !== expected) {
        throw requestError(409, 'Membership changed since it was loaded. Refresh its details and retry.', 'MEMBERSHIP_REVISION_CONFLICT');
      }
      if (current.status === 'inactive' && req.body.status !== 'active') {
        throw requestError(409, 'Explicit status: active is required to reactivate this membership.');
      }
      const target = await User.findOne({
        _id: userId, deletedAt: null, accountStatus: { $ne: 'deleted' },
        role: { $nin: ['super_admin', 'superadmin'] }
      }).select('_id accountStatus').session(session).lean();
      if (!target || target.accountStatus !== 'active') throw requestError(404, 'Active company user not found.');

      const allRoles = ['company_admin', 'warehouse_manager', 'inventory_manager', 'procurement_manager', 'warehouse_staff', 'staff', 'auditor'];
      const nextRole = hasRole ? req.body.role : current.role;
      if (!allRoles.includes(nextRole)) throw requestError(400, 'A permitted company role is required.');
      const nextWarehouseIds = hasAssignments
        ? validateWarehouseIds(req.body.assignedWarehouseIds, { required: warehouseScopedMembershipRoles.includes(nextRole) })
        : (current.assignedWarehouseIds || []).map(String);
      if (warehouseScopedMembershipRoles.includes(nextRole) && nextWarehouseIds.length === 0) {
        throw requestError(400, 'At least one warehouse assignment is required for this membership role.');
      }
      await assertWarehousesInCompany(companyId, nextWarehouseIds, session);

      if (current.status === 'active' && current.role === 'company_admin' && nextRole !== 'company_admin') {
        const admins = await CompanyMembership.countDocuments({ companyId, status: 'active', role: 'company_admin' }).session(session);
        if (admins <= 1) throw requestError(409, 'The last active Company Admin cannot be downgraded.');
      }

      const previous = {
        role: current.role,
        status: current.status,
        assignedWarehouseIds: (current.assignedWarehouseIds || []).map(String)
      };
      const nextStatus = current.status === 'inactive' ? 'active' : current.status;
      const unchanged = previous.role === nextRole && previous.status === nextStatus
        && previous.assignedWarehouseIds.length === nextWarehouseIds.length
        && previous.assignedWarehouseIds.every((id, index) => id === nextWarehouseIds[index]);
      if (unchanged) throw requestError(400, 'The requested membership change does not change any values.');

      const write = await CompanyMembership.updateOne(
        { _id: current._id, companyId, userId, revision: revisionCondition(expected) },
        { $set: { role: nextRole, status: nextStatus, assignedWarehouseIds: nextWarehouseIds }, $inc: { revision: 1 } },
        { session, runValidators: true }
      );
      if (!write || write.matchedCount !== 1 || write.modifiedCount !== 1) {
        throw requestError(409, 'Membership changed concurrently. Refresh its details and retry.', 'MEMBERSHIP_REVISION_CONFLICT');
      }
      updated = await CompanyMembership.findOne({ _id: current._id, companyId, userId }).session(session).lean();
      if (!updated) throw requestError(409, 'Membership update could not be confirmed.');
      action = previous.status === 'inactive' ? 'company.membership.reactivated' : 'company.membership.updated';
      await AuditLog.create([{
        actor: req.auth.id, targetUser: userId, companyId, action,
        details: {
          actorUserId: String(req.auth.id), targetUserId: String(userId), reason,
          previousRole: previous.role, newRole: updated.role,
          previousWarehouseAssignments: previous.assignedWarehouseIds,
          newWarehouseAssignments: (updated.assignedWarehouseIds || []).map(String),
          previousStatus: previous.status, newStatus: updated.status,
          previous, next: {
            role: updated.role, status: updated.status,
            assignedWarehouseIds: (updated.assignedWarehouseIds || []).map(String)
          }
        }
      }], { session });
    });
  } finally { await session.endSession(); }
  return res.json({ success: true, data: publicMembership(updated), action });
}));

router.delete('/:companyId/members/:userId', asyncHandler(async (req, res) => {
  const { companyId, userId } = req.params;
  if (![companyId, userId].every(mongoose.Types.ObjectId.isValid)) throw requestError(400, 'Invalid company or user ID.');
  assertAllowedFields(req.body, ['reason', 'expectedRevision']);
  const reason = validateReason(req.body?.reason);
  const expected = expectedRevision(req.body?.expectedRevision);
  const session = await mongoose.startSession();
  let revoked;
  try {
    await session.withTransaction(async () => {
      await lockMembershipWrites(session, companyId);
      await assertActiveCompanyAdmin(session, req.auth.id, companyId, req.tenant);
      const current = await CompanyMembership.findOne({ companyId, userId }).session(session);
      if (!current || current.status !== 'active') throw requestError(404, 'Active membership not found.');
      if (membershipRevision(current) !== expected) {
        throw requestError(409, 'Membership changed since it was loaded. Refresh its details and retry.', 'MEMBERSHIP_REVISION_CONFLICT');
      }
      const target = await User.findOne({
        _id: userId, deletedAt: null, accountStatus: { $ne: 'deleted' },
        role: { $nin: ['super_admin', 'superadmin'] }
      }).select('_id').session(session).lean();
      if (!target) throw requestError(404, 'Membership not found.');
      if (current.role === 'company_admin') {
        const admins = await CompanyMembership.countDocuments({ companyId, status: 'active', role: 'company_admin' }).session(session);
        if (admins <= 1) throw requestError(409, 'The last active Company Admin cannot be revoked.');
      }
      const previous = {
        role: current.role, status: current.status,
        assignedWarehouseIds: (current.assignedWarehouseIds || []).map(String)
      };
      const write = await CompanyMembership.updateOne(
        { _id: current._id, companyId, userId, status: 'active', revision: revisionCondition(expected) },
        { $set: { status: 'inactive', assignedWarehouseIds: [] }, $inc: { revision: 1 } },
        { session, runValidators: true }
      );
      if (!write || write.matchedCount !== 1 || write.modifiedCount !== 1) {
        throw requestError(409, 'Membership changed concurrently. Refresh its details and retry.', 'MEMBERSHIP_REVISION_CONFLICT');
      }
      revoked = { ...previous, status: 'inactive', assignedWarehouseIds: [], revision: expected + 1 };
      await AuditLog.create([{
        actor: req.auth.id, targetUser: userId, companyId, action: 'company.membership.revoked',
        details: {
          actorUserId: String(req.auth.id), targetUserId: String(userId), reason,
          previousRole: previous.role, newRole: previous.role,
          previousWarehouseAssignments: previous.assignedWarehouseIds, newWarehouseAssignments: [],
          previousStatus: previous.status, newStatus: 'inactive', previous,
          next: { role: previous.role, status: 'inactive', assignedWarehouseIds: [] }
        }
      }], { session });
    });
  } finally { await session.endSession(); }
  return res.json({ success: true, data: { userId, companyId, ...revoked } });
}));

router.patch('/:companyId/members/:userId/permissions', asyncHandler(async (req, res) => {
  const { companyId, userId } = req.params;
  if (![companyId, userId].every(mongoose.Types.ObjectId.isValid)) throw requestError(400, 'Invalid company or user ID.');
  assertAllowedFields(req.body, ['reason', 'expectedRevision', 'permissionOverrides']);
  const reason = validateReason(req.body?.reason);
  const expected = expectedRevision(req.body?.expectedRevision);
  const submitted = req.body?.permissionOverrides;
  if (!Array.isArray(submitted) || submitted.length > KNOWN_PERMISSION_IDS.length) {
    throw requestError(400, 'permissionOverrides must be an array containing only known permission IDs.');
  }
  const seen = new Set();
  const permissionOverrides = submitted.map(override => {
    if (!override || typeof override !== 'object' || Array.isArray(override)
      || Object.keys(override).some(key => !['permission', 'effect'].includes(key))) {
      throw requestError(400, 'Each permission override must contain only permission and effect.');
    }
    if (!KNOWN_PERMISSION_IDS.includes(override.permission) || !['allow', 'deny'].includes(override.effect)) {
      throw requestError(400, 'Each override requires a known permission ID and an allow or deny effect.');
    }
    if (seen.has(override.permission)) throw requestError(400, 'A permission may only have one override.');
    seen.add(override.permission);
    return { permission: override.permission, effect: override.effect };
  }).sort((left, right) => left.permission.localeCompare(right.permission));

  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      await lockMembershipWrites(session, companyId);
      await assertActiveCompanyAdmin(session, req.auth.id, companyId, req.tenant);
      const current = await CompanyMembership.findOne({ companyId, userId }).session(session);
      if (!current || current.status !== 'active') throw requestError(404, 'Active membership not found.');
      if (membershipRevision(current) !== expected) {
        throw requestError(409, 'Membership changed since it was loaded. Refresh its details and retry.', 'MEMBERSHIP_REVISION_CONFLICT');
      }
      const previousOverrides = (current.permissionOverrides || []).map(value => ({ permission: value.permission, effect: value.effect }))
        .sort((left, right) => left.permission.localeCompare(right.permission));
      if (JSON.stringify(previousOverrides) === JSON.stringify(permissionOverrides)) {
        throw requestError(400, 'The requested permission overrides do not change any values.');
      }
      const write = await CompanyMembership.updateOne(
        { _id: current._id, companyId, userId, status: 'active', revision: revisionCondition(expected) },
        { $set: { permissionOverrides }, $inc: { revision: 1 } },
        { session, runValidators: true }
      );
      if (!write || write.matchedCount !== 1 || write.modifiedCount !== 1) {
        throw requestError(409, 'Membership changed concurrently. Refresh its details and retry.', 'MEMBERSHIP_REVISION_CONFLICT');
      }
      updated = await CompanyMembership.findOne({ _id: current._id, companyId, userId }).session(session).lean();
      await AuditLog.create([{
        actor: req.auth.id, targetUser: userId, companyId, action: 'company.membership.permissions-updated',
        details: {
          actorUserId: String(req.auth.id), targetUserId: String(userId), reason,
          previousPermissionOverrides: previousOverrides, newPermissionOverrides: permissionOverrides,
          previousRole: current.role, newRole: current.role
        }
      }], { session });
    });
  } finally { await session.endSession(); }
  return res.json({ success: true, data: publicMembership(updated) });
}));

router.get('/:companyId/members', asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  const rows = await CompanyMembership.find({ companyId }).populate('userId', 'name email accountStatus deletedAt').lean();
  return res.json({ success: true, data: rows.filter(row => row.userId && !row.userId.deletedAt).map(publicMembership) });
}));
module.exports = router;

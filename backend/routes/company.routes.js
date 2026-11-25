const express = require('express');
const mongoose = require('mongoose');
const validator = require('validator');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const User = require('../model/User');
const Warehouse = require('../model/Warehouse');
const { runWithAuth } = require('../middleware/requestContext');

const router = express.Router();
router.use(auth);

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function companyPublic(company) {
  return {
    id: String(company._id), name: company.name, slug: company.slug, legalBusinessName: company.legalBusinessName,
    email: company.email, phone: company.phone, address: company.address, logo: company.logo,
    industry: company.industry, status: company.status, subscriptionId: company.subscriptionId || null
  };
}

async function membershipFor(userId, companyId) {
  return CompanyMembership.findOne({ userId, companyId, status: 'active' }).lean();
}

router.get('/mine', asyncHandler(async (req, res) => {
  const memberships = await CompanyMembership.find({ userId: req.auth.id, status: 'active' })
    .select('companyId role assignedWarehouseIds').lean();
  const companies = await Promise.all(memberships.map(async membership => {
    const company = await Company.findById(membership.companyId).select('name slug status').lean();
    if (!company) return null;
    return {
      ...companyPublic(company), role: membership.role,
      assignedWarehouseIds: (membership.assignedWarehouseIds || []).map(String)
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
  const company = await Company.findById(companyId).select('name slug status').lean();
  if (!company || ['suspended', 'deactivated'].includes(company.status)) {
    return res.status(403).json({ success: false, code: 'COMPANY_UNAVAILABLE', message: 'This company is suspended or unavailable' });
  }
  return res.json({ success: true, data: { ...companyPublic(company), role: membership.role } });
}));

router.post('/:companyId/members', asyncHandler(async (req, res, next) => {
  const { companyId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(companyId)) return res.status(400).json({ success: false, message: 'Invalid company ID' });
  const company = await Company.findById(companyId).select('status').lean();
  const membership = await membershipFor(req.auth.id, companyId);
  if (!membership || membership.role !== 'company_admin') {
    return res.status(403).json({ success: false, code: 'COMPANY_ADMIN_REQUIRED', message: 'Company Admin permission is required' });
  }
  if (!company || ['suspended', 'deactivated'].includes(company.status)) {
    return res.status(403).json({ success: false, code: 'COMPANY_UNAVAILABLE', message: 'This company is suspended or unavailable' });
  }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const role = req.body?.role || 'staff';
  const allowedRoles = ['company_admin', 'warehouse_manager', 'staff', 'auditor'];
  if (!validator.isEmail(email) || !allowedRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'A valid existing user email and permitted company role are required' });
  }
  const user = await User.findOne({ email }).select('_id name email accountStatus').lean();
  if (!user || user.accountStatus === 'inactive' || user.accountStatus === 'deleted') {
    return res.status(404).json({ success: false, message: 'An active WareFlow user with that email was not found' });
  }
  const assignedWarehouseIds = req.body?.assignedWarehouseIds || [];
  if (!Array.isArray(assignedWarehouseIds) || assignedWarehouseIds.some(id => !mongoose.Types.ObjectId.isValid(id))) {
    return res.status(400).json({ success: false, message: 'assignedWarehouseIds must be an array of valid IDs' });
  }
  if (assignedWarehouseIds.length) {
    const count = await runWithAuth({ ...req.auth, companyId, membershipRole: 'company_admin', warehouseScoped: false }, async () =>
      Warehouse.countDocuments({ _id: { $in: assignedWarehouseIds }, companyId }).exec());
    if (count !== new Set(assignedWarehouseIds.map(String)).size) {
      return res.status(400).json({ success: false, message: 'Every assigned warehouse must belong to this company' });
    }
  }
  try {
    const created = await CompanyMembership.create({ userId: user._id, companyId, role, status: 'active', assignedWarehouseIds });
    return res.status(201).json({ success: true, data: {
      id: String(created._id), user: { id: String(user._id), name: user.name, email: user.email },
      companyId, role: created.role, status: created.status, assignedWarehouseIds: created.assignedWarehouseIds.map(String)
    } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: 'This user is already a member of the company' });
    return next(error);
  }
}));

router.get('/:companyId/members', asyncHandler(async (req, res) => {
  const { companyId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(companyId)) return res.status(400).json({ success: false, message: 'Invalid company ID' });
  const membership = await membershipFor(req.auth.id, companyId);
  if (!membership) return res.status(403).json({ success: false, code: 'COMPANY_MEMBERSHIP_REQUIRED', message: 'You are not an active member of this company' });
  if (membership.role !== 'company_admin') return res.status(403).json({ success: false, code: 'COMPANY_ADMIN_REQUIRED', message: 'Company Admin permission is required' });
  const rows = await CompanyMembership.find({ companyId, status: 'active' }).populate('userId', 'name email accountStatus').lean();
  return res.json({ success: true, data: rows.map(row => ({
    id: String(row._id), user: row.userId ? { id: String(row.userId._id), name: row.userId.name, email: row.userId.email, accountStatus: row.userId.accountStatus } : null,
    role: row.role, status: row.status, assignedWarehouseIds: (row.assignedWarehouseIds || []).map(String)
  })) });
}));

module.exports = router;

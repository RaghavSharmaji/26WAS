const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const User = require('../model/User');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const Item = require('../model/Item');
const Product = require('../model/Product');
const Pallet = require('../model/Pallets');
const Order = require('../model/Order');
const Ticket = require('../model/Ticket');
const Category = require('../model/Category');
const Supplier = require('../model/Supplier');
const Warehouse = require('../model/Warehouse');
const Location = require('../model/Location');
const AuditLog = require('../model/AuditLog');
const { normalizeRole, isSuperAdminRole } = require('../middleware/roleCompatibility');
const asyncHandler = require('../middleware/asyncHandler');
const { availableQuantityExpression } = require('../services/inventoryBalance');
const { buildUserScopes, scopeFilter, multiUserScopeFilter, bucketKey, mergeGroupedRows, statsForScope } = require('../services/adminUserScope');

const router = express.Router();
const ownedModels = { products: Item, categories: Category, suppliers: Supplier, warehouses: Warehouse, locations: Location, orders: Order };
const allowedResources = new Set([...Object.keys(ownedModels), 'inventory', 'reports', 'activity']);

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw httpError(400, 'Invalid user ID');
  return new mongoose.Types.ObjectId(id);
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    role: user.role,
    accountStatus: user.accountStatus || 'active',
    registeredAt: user.date,
    lastLoginAt: user.lastLoginAt || null
  };
}

async function audit(actor, action, targetUser, details = {}) {
  await AuditLog.create({ actor, action, targetUser: targetUser || null, details });
}

async function loadUserScopes(userIds) {
  const ids = [...new Map(userIds.map(id => [String(id), id])).values()];
  if (!ids.length) return new Map();
  const memberships = await CompanyMembership.find({ userId: { $in: ids }, status: 'active' })
    .select('userId companyId status').lean();
  const candidateCompanyIds = [...new Map(memberships
    .filter(row => row.status === 'active' && row.companyId)
    .map(row => [String(row.companyId), row.companyId])).values()];
  const companies = candidateCompanyIds.length
    ? await Company.find({ _id: { $in: candidateCompanyIds }, status: 'active' }).select('_id name slug status').lean()
    : [];
  return buildUserScopes(ids, memberships, companies);
}

function scopedAggregate(match, groupFields) {
  return [
    { $match: match },
    { $group: { _id: { companyId: '$companyId', ownerId: '$ownerId' }, ...groupFields } }
  ];
}

async function inventoryTotal(scope) {
  const [row] = await Pallet.aggregate([
    { $match: scope ? scopeFilter(scope) : {} },
    { $group: {
      _id: null,
      units: { $sum: availableQuantityExpression() },
      onHandUnits: { $sum: { $ifNull: ['$cont', 0] } },
      quarantinedUnits: { $sum: { $ifNull: ['$contQuarantined', 0] } },
      palletCount: { $sum: 1 }
    } }
  ]);
  return { units: row?.units || 0, onHandUnits: row?.onHandUnits || 0, quarantinedUnits: row?.quarantinedUnits || 0, palletCount: row?.palletCount || 0 };
}

async function lowStockRows(scope) {
  const query = scope ? scopeFilter(scope, { reorderLevel: { $gt: 0 } }) : { reorderLevel: { $gt: 0 } };
  const items = await Item.find(query).select('ownerId companyId name skuNumber reorderLevel').lean();
  if (!items.length) return [];
  const skus = [...new Set(items.map(item => item.skuNumber))];
  const stockRows = await Pallet.aggregate([
    { $match: scope ? scopeFilter(scope, { skuNumber: { $in: skus } }) : { skuNumber: { $in: skus } } },
    { $group: { _id: { companyId: '$companyId', ownerId: '$ownerId', sku: '$skuNumber' }, available: { $sum: availableQuantityExpression() } } }
  ]);
  const stockByKey = new Map();
  for (const row of stockRows) {
    const key = `${bucketKey(row._id.companyId, row._id.ownerId)}:${row._id.sku}`;
    stockByKey.set(key, (stockByKey.get(key) || 0) + Number(row.available || 0));
  }
  return items.map((item) => ({
    item,
    availableQuantity: stockByKey.get(`${bucketKey(item.companyId, item.ownerId)}:${item.skuNumber}`) || 0
  })).filter((row) => row.availableQuantity <= row.item.reorderLevel);
}

async function userStatsForIds(ids) {
  if (!ids.length) return new Map();
  const scopes = await loadUserScopes(ids);
  const companyIds = [...new Map([...scopes.values()].flatMap(scope => scope.companyIds).map(id => [String(id), id])).values()];
  const match = multiUserScopeFilter(ids, companyIds);
  const [productRows, palletRows, orderRows, warehouseRows, supplierRows, categoryRows, locationRows] = await Promise.all([
    Item.aggregate(scopedAggregate(match, { products: { $sum: 1 } })),
    Pallet.aggregate(scopedAggregate(match, {
      inventoryUnits: { $sum: availableQuantityExpression() },
      inventoryOnHandUnits: { $sum: { $ifNull: ['$cont', 0] } },
      inventoryQuarantinedUnits: { $sum: { $ifNull: ['$contQuarantined', 0] } }
    })),
    Order.aggregate(scopedAggregate(match, { orders: { $sum: 1 } })),
    Warehouse.aggregate(scopedAggregate(match, { warehouses: { $sum: 1 } })),
    Supplier.aggregate(scopedAggregate(match, { suppliers: { $sum: 1 } })),
    Category.aggregate(scopedAggregate(match, { categories: { $sum: 1 } })),
    Location.aggregate(scopedAggregate(match, { locations: { $sum: 1 } }))
  ]);
  const datasets = [productRows, palletRows, orderRows, warehouseRows, supplierRows, categoryRows, locationRows];
  const companyStats = new Map();
  const legacyStats = new Map();
  for (const rows of datasets) {
    const fields = Object.keys(rows[0] || {}).filter(field => field !== '_id');
    const merged = mergeGroupedRows(rows, fields);
    for (const [key, values] of merged) {
      const destination = key.startsWith('company:') ? companyStats : legacyStats;
      const current = destination.get(key) || {};
      for (const field of fields) current[field] = (current[field] || 0) + values[field];
      destination.set(key, current);
    }
  }
  return new Map([...scopes].map(([userId, scope]) => [userId, statsForScope(scope, companyStats, legacyStats)]));
}

async function userReport(scope) {
  const filter = scopeFilter(scope);
  const [productCount, orderCount, warehouseCount, supplierCount, categoryCount, locationCount, inventory, lowStock] = await Promise.all([
    Item.countDocuments(filter), Order.countDocuments(filter), Warehouse.countDocuments(filter), Supplier.countDocuments(filter),
    Category.countDocuments(filter), Location.countDocuments(filter), inventoryTotal(scope), lowStockRows(scope)
  ]);
  return { productCount, orderCount, warehouseCount, supplierCount, categoryCount, locationCount, inventoryUnits: inventory.units, inventoryOnHandUnits: inventory.onHandUnits, inventoryQuarantinedUnits: inventory.quarantinedUnits, palletCount: inventory.palletCount, lowStockProducts: lowStock.length, companyCount: scope.companyIds.length };
}

async function inventoryRows(scope) {
  const rows = await Pallet.aggregate([
    { $match: scope ? scopeFilter(scope) : {} },
    { $group: {
      _id: {
        companyId: { $ifNull: ['$companyId', null] },
        ownerId: { $cond: [{ $eq: [{ $ifNull: ['$companyId', null] }, null] }, '$ownerId', null] },
        warehouseId: '$warehouseId', sku: '$skuNumber'
      },
      availableQuantity: { $sum: availableQuantityExpression() },
      onHandQuantity: { $sum: { $ifNull: ['$cont', 0] } },
      quarantinedQuantity: { $sum: { $ifNull: ['$contQuarantined', 0] } },
      palletCount: { $sum: 1 }
    } },
    { $sort: { '_id.companyId': 1, '_id.warehouseId': 1, '_id.sku': 1 } }
  ]);
  const skus = [...new Set(rows.map((row) => row._id.sku))];
  const companyIds = [...new Set(rows.map(row => row._id.companyId).filter(Boolean).map(String))].map(id => new mongoose.Types.ObjectId(id));
  const legacyOwnerIds = [...new Set(rows.filter(row => !row._id.companyId).map(row => String(row._id.ownerId)))].map(id => new mongoose.Types.ObjectId(id));
  const itemMatch = {
    skuNumber: { $in: skus },
    $or: [
      ...(companyIds.length ? [{ companyId: { $in: companyIds } }] : []),
      ...(legacyOwnerIds.length ? [{ companyId: null, ownerId: { $in: legacyOwnerIds } }] : [])
    ]
  };
  const items = rows.length ? await Item.find(itemMatch).select('ownerId companyId name skuNumber department reorderLevel').lean() : [];
  const itemByKey = new Map(items.map(item => [`${bucketKey(item.companyId, item.ownerId)}:${item.skuNumber}`, item]));
  return rows.map((row) => {
    const key = `${bucketKey(row._id.companyId, row._id.ownerId)}:${row._id.sku}`;
    return {
      companyId: row._id.companyId || null,
      ownerId: row._id.companyId ? null : row._id.ownerId,
      warehouseId: row._id.warehouseId || null,
      skuNumber: row._id.sku, availableQuantity: row.availableQuantity,
      onHandQuantity: row.onHandQuantity, quarantinedQuantity: row.quarantinedQuantity,
      palletCount: row.palletCount, item: itemByKey.get(key) || null
    };
  });
}

async function userActivity(scope, { from, to, type } = {}) {
  const userId = scope.legacyOwnerId;
  const dateFilter = {};
  if (from) dateFilter.$gte = new Date(from);
  if (to) dateFilter.$lte = new Date(to);
  const dateOk = Object.values(dateFilter).every((date) => !Number.isNaN(date.getTime()));
  if (!dateOk) throw httpError(400, 'from and to must be valid dates');
  const createdFilter = Object.keys(dateFilter).length ? { date: dateFilter } : {};
  const movementMatch = scopeFilter(scope);
  if (Object.keys(dateFilter).length) movementMatch['movementLog.createdAt'] = dateFilter;
  const [items, orders, movements, logs] = await Promise.all([
    type && type !== 'product.created' ? [] : Item.find(scopeFilter(scope, createdFilter)).sort({ date: -1 }).limit(50).select('ownerId name skuNumber date').lean(),
    type && type !== 'order.created' ? [] : Order.find(scopeFilter(scope, createdFilter)).sort({ date: -1 }).limit(50).select('ownerId date status').lean(),
    type && !type.startsWith('inventory.') ? [] : Pallet.aggregate([
      { $match: movementMatch }, { $unwind: '$movementLog' },
      ...(Object.keys(dateFilter).length ? [{ $match: { 'movementLog.createdAt': dateFilter } }] : []),
      ...(type?.startsWith('inventory.') ? [{ $match: { 'movementLog.type': type.slice('inventory.'.length) } }] : []),
      { $sort: { 'movementLog.createdAt': -1 } }, { $limit: 50 },
      { $project: { ownerId: 1, skuNumber: 1, movement: '$movementLog' } }
    ]),
    type && type !== 'admin.action' && type !== 'user.login' ? [] : AuditLog.find({
      $or: [
        ...(scope.companyIds.length ? [{ companyId: { $in: scope.companyIds } }] : []),
        { companyId: null, targetUser: userId }
      ],
      ...(type === 'admin.action' ? { action: /^admin\./ } : type ? { action: type } : {}),
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {})
    }).sort({ createdAt: -1 }).limit(50).lean()
  ]);
  return [
    ...items.map((item) => ({ type: 'product.created', userId: item.ownerId, message: `Product ${item.name} (${item.skuNumber}) added`, at: item.date })),
    ...orders.map((order) => ({ type: 'order.created', userId: order.ownerId, message: `Order ${order._id} created (${order.status || 'new'})`, at: order.date })),
    ...movements.map((row) => ({ type: `inventory.${row.movement.type}`, userId: row.ownerId, message: `${row.movement.type} ${row.movement.quantity} units for ${row.skuNumber}: ${row.movement.reason}`, at: row.movement.createdAt })),
    ...logs.map((log) => ({ type: log.action, userId, message: log.action === 'user.login' ? 'User signed in' : `Admin action: ${log.action}`, at: log.createdAt, details: log.details }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 100);
}

router.get('/overview', asyncHandler(async (req, res) => {
  const notDeleted = { role: { $nin: ['superadmin', 'super_admin'] }, accountStatus: { $ne: 'deleted' } };
  const activeUsers = await User.countDocuments({ role: { $nin: ['superadmin', 'super_admin'] }, $or: [{ accountStatus: 'active' }, { accountStatus: { $exists: false } }] });
  const [totalUsers, inactiveUsers, productCount, orderCount, warehouseCount, supplierCount, categoryCount, locationCount, inventory, lowStock, usersTrend, productsTrend, ordersTrend, activityTrend, inventoryDistribution] = await Promise.all([
    User.countDocuments(notDeleted),
    User.countDocuments({ role: { $nin: ['superadmin', 'super_admin'] }, accountStatus: 'inactive' }),
    Item.countDocuments(), Order.countDocuments(), Warehouse.countDocuments(), Supplier.countDocuments(), Category.countDocuments(), Location.countDocuments(),
    inventoryTotal(null), lowStockRows(null),
    User.aggregate([{ $match: { role: { $nin: ['superadmin', 'super_admin'] }, date: { $gte: new Date(Date.now() - 365 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Item.aggregate([{ $match: { date: { $gte: new Date(Date.now() - 365 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Order.aggregate([{ $match: { date: { $gte: new Date(Date.now() - 365 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    AuditLog.aggregate([{ $match: { action: 'user.login', createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Pallet.aggregate([{ $group: { _id: '$department', units: { $sum: availableQuantityExpression() }, users: { $addToSet: '$ownerId' } } }, { $sort: { units: -1 } }])
  ]);
  res.json({ success: true, data: {
    stats: { totalUsers, activeUsers, inactiveUsers, productCount, inventoryUnits: inventory.units, inventoryOnHandUnits: inventory.onHandUnits, inventoryQuarantinedUnits: inventory.quarantinedUnits, orderCount, warehouseCount, supplierCount, categoryCount, locationCount, lowStockProducts: lowStock.length },
    trends: { users: usersTrend, products: productsTrend, orders: ordersTrend, activity: activityTrend },
    inventoryDistribution: inventoryDistribution.map((row) => ({ department: row._id || 'Unassigned', units: row.units, users: row.users.filter(Boolean).length }))
  } });
}));

router.get('/companies', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
  const filter = {};
  const status = String(req.query.status || 'all');
  const allowedStatuses = new Set(['pending', 'active', 'suspended', 'deactivated']);
  if (status !== 'all') {
    if (!allowedStatuses.has(status)) throw httpError(400, 'Invalid company status filter');
    filter.status = status;
  }
  const reviewStatus = String(req.query.reviewStatus || 'all');
  if (reviewStatus !== 'all') {
    if (!['pending', 'under_review', 'verified', 'rejected'].includes(reviewStatus)) throw httpError(400, 'Invalid registration review status filter');
    filter['registration.status'] = reviewStatus;
  }
  const search = String(req.query.search || '').trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: new RegExp(escaped, 'i') },
      { slug: new RegExp(escaped, 'i') },
      { email: new RegExp(escaped, 'i') },
      { legalBusinessName: new RegExp(escaped, 'i') }
    ];
  }
  const [companies, total] = await Promise.all([
    Company.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Company.countDocuments(filter)
  ]);
  res.json({
    success: true,
    data: companies.map(company => ({
      id: String(company._id), name: company.name, slug: company.slug,
      legalBusinessName: company.legalBusinessName || '', email: company.email || '',
      phone: company.phone || '', address: company.address || '', industry: company.industry || '',
      status: company.status, registration: company.registration ? {
        reference: company.registration.reference || '', status: company.registration.status || 'pending',
        submittedAt: company.registration.submittedAt || null, emailVerificationStatus: company.registration.emailVerificationStatus || 'pending'
      } : null,
      createdAt: company.createdAt, updatedAt: company.updatedAt
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
}));

router.get('/companies/:id/registration', asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw httpError(400, 'Invalid company ID');
  const company = await Company.findById(req.params.id).lean();
  if (!company) throw httpError(404, 'Company not found');
  const registration = company.registration;
  if (!registration) throw httpError(404, 'This company has no registration application');
  return res.json({ success: true, data: {
    company: { id: String(company._id), name: company.name, slug: company.slug, status: company.status, email: company.email, phone: company.phone, address: company.address, industry: company.industry },
    registration: {
      reference: registration.reference, status: registration.status, submittedAt: registration.submittedAt,
      businessType: registration.businessType, country: registration.country, state: registration.state,
      city: registration.city, postalCode: registration.postalCode, website: registration.website,
      gstin: registration.gstin, pan: registration.pan, cin: registration.cin,
      businessRegistrationNumber: registration.businessRegistrationNumber,
      emailVerificationStatus: registration.emailVerificationStatus,
      administrator: registration.administrator,
      warehouseRequirements: registration.warehouseRequirements,
      settings: registration.settings, acceptance: registration.acceptance,
      reviewedAt: registration.reviewedAt, reviewReason: registration.reviewReason || ''
    }
  } });
}));

router.post('/companies/:id/registration/review', asyncHandler(async (req, res) => {
  const companyId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(companyId)) throw httpError(400, 'Invalid company ID');
  const body = req.body || {};
  const unexpected = Object.keys(body).find(key => !['status', 'reason'].includes(key));
  if (unexpected) throw httpError(400, `Unsupported registration review field: ${unexpected}`);
  const nextStatus = body.status;
  if (!['under_review', 'verified', 'rejected'].includes(nextStatus)) throw httpError(400, 'Choose under_review, verified, or rejected.');
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.trim().length > 500) throw httpError(400, 'A review reason of 1 to 500 characters is required.');
  const reason = body.reason.trim();
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      const actorQuery = User.findById(req.auth.id).select('_id role accountStatus deletedAt').session(session);
      const actor = await actorQuery.lean();
      if (!actor || actor.accountStatus !== 'active' || actor.deletedAt || !isSuperAdminRole(actor.role)) throw Object.assign(httpError(403, 'An active Super Admin account is required for application review'), { code: 'SUPER_ADMIN_REQUIRED' });
      const current = await Company.findById(companyId).session(session).lean();
      if (!current) throw Object.assign(httpError(404, 'Company not found'), { code: 'COMPANY_NOT_FOUND' });
      if (!current.registration) throw Object.assign(httpError(409, 'This company has no registration review workflow'), { code: 'REGISTRATION_NOT_FOUND' });
      const allowedFrom = nextStatus === 'under_review' ? ['pending'] : ['pending', 'under_review'];
      if (!allowedFrom.includes(current.registration.status)) throw Object.assign(httpError(409, `Registration cannot move from '${current.registration.status}' to '${nextStatus}'`), { code: 'REGISTRATION_STATUS_CONFLICT' });
      updated = await Company.findOneAndUpdate(
        { _id: companyId, 'registration.status': current.registration.status },
        { $set: { 'registration.status': nextStatus, 'registration.reviewedBy': actor._id, 'registration.reviewedAt': new Date(), 'registration.reviewReason': reason } },
        { new: true, runValidators: true, session }
      ).lean();
      if (!updated) throw Object.assign(httpError(409, 'Registration status changed; refresh and retry'), { code: 'REGISTRATION_STATUS_CONFLICT' });
      await AuditLog.create([{
        companyId: updated._id, actor: actor._id, targetUser: current.registration.applicantUserId || null,
        action: `admin.company.registration.${nextStatus}`,
        details: { reference: current.registration.reference, previousStatus: current.registration.status, newStatus: nextStatus, reason },
        createdAt: new Date()
      }], { session });
    });
  } finally { await session.endSession(); }
  return res.json({ success: true, data: { companyId: String(updated._id), status: updated.registration.status, reviewedAt: updated.registration.reviewedAt }, message: `Registration marked ${nextStatus}.` });
}));

router.post('/companies/:id/activate', asyncHandler(async (req, res) => {
  const companyId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(companyId)) throw httpError(400, 'Invalid company ID');
  const body = req.body || {};
  const unexpectedFields = Object.keys(body).filter(field => field !== 'reason');
  if (unexpectedFields.length) throw httpError(400, `Unsupported activation field: ${unexpectedFields[0]}`);
  if (typeof body.reason !== 'string' || !body.reason.trim()) throw httpError(400, 'A non-empty activation reason is required');
  const reason = body.reason.trim();
  if (reason.length > 500) throw httpError(400, 'Activation reason must be at most 500 characters');

  const session = await mongoose.startSession();
  let activated;
  try {
    await session.withTransaction(async () => {
      // Authentication is checked on request entry too; revalidate platform authority
      // inside the transaction so stale or demoted credentials cannot activate a tenant.
      const actorQuery = User.findById(req.auth.id).select('_id role accountStatus deletedAt').session(session);
      const actor = await actorQuery.lean();
      if (!actor || actor.accountStatus !== 'active' || actor.deletedAt || !isSuperAdminRole(actor.role)) {
        throw Object.assign(httpError(403, 'An active Super Admin account is required for company activation'), { code: 'SUPER_ADMIN_REQUIRED' });
      }

      const company = await Company.findById(companyId).session(session).lean();
      if (!company) throw Object.assign(httpError(404, 'Company not found'), { code: 'COMPANY_NOT_FOUND' });
      if (company.status !== 'pending') {
        throw Object.assign(httpError(409, `Company cannot be activated from status '${company.status || 'unknown'}'`), { code: 'COMPANY_STATUS_CONFLICT' });
      }
      if (company.registration && company.registration.status !== 'verified') {
        throw Object.assign(httpError(409, 'A registration application must be verified before activation'), { code: 'REGISTRATION_NOT_VERIFIED' });
      }

      activated = await Company.findOneAndUpdate(
        { _id: companyId, status: 'pending' },
        { $set: { status: 'active' } },
        { new: true, runValidators: true, session }
      ).lean();
      if (!activated) throw Object.assign(httpError(409, 'Company status changed; refresh and retry activation'), { code: 'COMPANY_STATUS_CONFLICT' });

      await AuditLog.create([{
        companyId: activated._id,
        actor: actor._id,
        action: 'admin.company.activated',
        details: {
          companyId: String(activated._id),
          previousStatus: company.status,
          newStatus: activated.status,
          reason
        },
        createdAt: new Date()
      }], { session });
    });
  } finally {
    await session.endSession();
  }

  return res.json({ success: true, data: {
    id: String(activated._id), name: activated.name, slug: activated.slug,
    status: activated.status, createdAt: activated.createdAt, updatedAt: activated.updatedAt
  }, message: 'Company activated successfully.' });
}));

router.get('/users', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const filter = { role: { $nin: ['superadmin', 'super_admin'] } };
  const status = String(req.query.status || 'all');
  if (status === 'active' || status === 'inactive' || status === 'deleted') filter.accountStatus = status;
  else if (status !== 'all') throw httpError(400, 'Invalid account status filter');
  const search = String(req.query.search || '').trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const or = [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }];
    if (mongoose.Types.ObjectId.isValid(search)) or.push({ _id: search });
    filter.$or = or;
  }
  const allowedSort = new Set(['name', 'email', 'date', 'accountStatus', 'lastLoginAt']);
  const sortBy = allowedSort.has(req.query.sort) ? req.query.sort : 'date';
  const direction = req.query.direction === 'asc' ? 1 : -1;
  const [users, total] = await Promise.all([
    User.find(filter).sort({ [sortBy]: direction, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    User.countDocuments(filter)
  ]);
  const stats = await userStatsForIds(users.map((user) => user._id));
  res.json({ success: true, data: users.map((user) => ({ ...publicUser(user), stats: stats.get(String(user._id)) })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.post('/users', asyncHandler(async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) throw httpError(400, 'Name must be 2 to 80 characters');
  if (typeof email !== 'string' || !validator.isEmail(email)) throw httpError(400, 'A valid email is required');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw httpError(400, 'Password must be 12 to 128 characters');
  if (phone !== undefined && (typeof phone !== 'string' || phone.length > 40)) throw httpError(400, 'Phone must be at most 40 characters');
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.create({ name: name.trim(), email: normalizedEmail, phone: (phone || '').trim(), password: await bcrypt.hash(password, 12), role: 'staff', clearance: ['staff'], accountStatus: 'active', mustChangePassword: true });
  await audit(req.auth.id, 'admin.user.created', user._id);
  res.status(201).json({ success: true, data: publicUser(user) });
}));

router.get('/users/:id', asyncHandler(async (req, res) => {
  const id = validId(req.params.id);
  const user = await User.findOne({ _id: id, role: { $nin: ['superadmin', 'super_admin'] } }).lean();
  if (!user) throw httpError(404, 'User not found');
  const scope = (await loadUserScopes([id])).get(String(id));
  res.json({ success: true, data: { ...publicUser(user), stats: await userReport(scope), companies: scope.companies } });
}));

router.patch('/users/:id', asyncHandler(async (req, res) => {
  const id = validId(req.params.id);
  const user = await User.findOne({ _id: id, role: { $nin: ['superadmin', 'super_admin'] } });
  if (!user) throw httpError(404, 'User not found');
  const { name, email, phone, accountStatus } = req.body || {};
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) throw httpError(400, 'Name must be 2 to 80 characters');
    user.name = name.trim();
  }
  if (email !== undefined) {
    if (typeof email !== 'string' || !validator.isEmail(email)) throw httpError(400, 'A valid email is required');
    user.email = email.trim().toLowerCase();
  }
  if (phone !== undefined) {
    if (typeof phone !== 'string' || phone.length > 40) throw httpError(400, 'Phone must be at most 40 characters');
    user.phone = phone.trim();
  }
  if (accountStatus !== undefined) {
    if (!['active', 'inactive'].includes(accountStatus)) throw httpError(400, 'Account status must be active or inactive');
    if (user.accountStatus === 'deleted') throw httpError(409, 'Soft-deleted accounts cannot be reactivated through this action. Their warehouse records remain preserved.');
    user.accountStatus = accountStatus;
  }
  await user.save();
  await audit(req.auth.id, accountStatus ? `admin.user.${accountStatus}` : 'admin.user.updated', id, { fields: Object.keys(req.body || {}).filter((key) => ['name', 'email', 'phone', 'accountStatus'].includes(key)) });
  res.json({ success: true, data: publicUser(user) });
}));

router.post('/users/:id/reset-password', asyncHandler(async (req, res) => {
  const id = validId(req.params.id);
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw httpError(400, 'Temporary password must be 12 to 128 characters');
  const user = await User.findOne({ _id: id, role: { $nin: ['superadmin', 'super_admin'] } });
  if (!user) throw httpError(404, 'User not found');
  if (user.accountStatus === 'deleted') throw httpError(409, 'Password reset is unavailable for a deleted account.');
  user.password = await bcrypt.hash(password, 12);
  user.mustChangePassword = true;
  await user.save();
  await audit(req.auth.id, 'admin.user.password-reset', id);
  res.json({ success: true, message: 'Password reset. The user must change it after signing in.' });
}));

router.delete('/users/:id', asyncHandler(async (req, res) => {
  const id = validId(req.params.id);
  const user = await User.findOne({ _id: id, role: { $nin: ['superadmin', 'super_admin'] } });
  if (!user) throw httpError(404, 'User not found');
  user.accountStatus = 'deleted';
  user.deletedAt = new Date();
  await user.save();
  await audit(req.auth.id, 'admin.user.deleted', id, { policy: 'soft-delete; warehouse data preserved' });
  res.json({ success: true, message: 'Account marked deleted. Warehouse records were preserved.' });
}));

router.get('/users/:id/data/:resource', asyncHandler(async (req, res) => {
  const ownerId = validId(req.params.id);
  if (!allowedResources.has(req.params.resource)) throw httpError(404, 'Unknown user data section');
  const user = await User.findOne({ _id: ownerId, role: { $nin: ['superadmin', 'super_admin'] } }).select('_id').lean();
  if (!user) throw httpError(404, 'User not found');
  const scope = (await loadUserScopes([ownerId])).get(String(ownerId));
  const resource = req.params.resource;
  let data;
  if (resource === 'inventory') data = await inventoryRows(scope);
  else if (resource === 'reports') data = await userReport(scope);
  else if (resource === 'activity') data = await userActivity(scope, req.query);
  else data = await ownedModels[resource].find(scopeFilter(scope)).sort({ createdAt: -1, date: -1 }).limit(500).lean();
  res.json({ success: true, data });
}));

router.get('/users/:id/dashboard', asyncHandler(async (req, res) => {
  const ownerId = validId(req.params.id);
  const user = await User.findOne({ _id: ownerId, role: { $nin: ['superadmin', 'super_admin'] } }).select('_id name email accountStatus').lean();
  if (!user) throw httpError(404, 'User not found');
  const scope = (await loadUserScopes([ownerId])).get(String(ownerId));
  const [stats, lowStock, activity, products, inventory, orders] = await Promise.all([
    userReport(scope), lowStockRows(scope), userActivity(scope),
    Item.find(scopeFilter(scope)).sort({ date: -1 }).limit(10).lean(),
    inventoryRows(scope),
    Order.find(scopeFilter(scope)).sort({ date: -1 }).limit(10).lean()
  ]);
  res.json({ success: true, data: { user: publicUser(user), companies: scope.companies, stats, lowStock, recentActivity: activity.slice(0, 10), products, inventory: inventory.slice(0, 10), orders, readOnly: true } });
}));

router.get('/monitor/:resource', asyncHandler(async (req, res) => {
  const resource = req.params.resource;
  if (!['products', 'inventory', 'orders', 'warehouses', 'suppliers', 'categories', 'locations'].includes(resource)) throw httpError(404, 'Unknown monitoring section');
  let data;
  if (resource === 'inventory') data = await inventoryRows(null);
  else {
    const Model = ownedModels[resource];
    data = await Model.find({}).sort({ createdAt: -1, date: -1 }).limit(500).populate('ownerId', 'name email').lean();
  }
  res.json({ success: true, data });
}));

router.get('/activity', asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) throw httpError(400, 'from and to must be valid dates');
  const userId = req.query.userId ? validId(req.query.userId) : null;
  const activity = [];
  const userQuery = { role: { $nin: ['superadmin', 'super_admin'] }, ...(userId ? { _id: userId } : {}), ...((from || to) ? { date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}) };
  const eventQuery = { ...(userId ? { ownerId: userId } : {}), ...((from || to) ? { date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}) };
  const logQuery = { ...(userId ? { targetUser: userId } : {}), ...((from || to) ? { createdAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}) };
  const [users, products, orders, movements, logs] = await Promise.all([
    !req.query.type || req.query.type === 'user.registered' ? User.find(userQuery).sort({ date: -1 }).limit(100).select('name email date accountStatus').lean() : [],
    !req.query.type || req.query.type === 'product.created' ? Item.find(eventQuery).sort({ date: -1 }).limit(100).select('ownerId name skuNumber date').populate('ownerId', 'name email').lean() : [],
    !req.query.type || req.query.type === 'order.created' ? Order.find(eventQuery).sort({ date: -1 }).limit(100).select('ownerId status date').populate('ownerId', 'name email').lean() : [],
    !req.query.type || String(req.query.type).startsWith('inventory.') ? Pallet.aggregate([
      { $match: { ...(userId ? { ownerId: userId } : {}), ...((from || to) ? { 'movementLog.createdAt': { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}) } },
      { $unwind: '$movementLog' },
      ...(req.query.type ? [{ $match: { 'movementLog.type': String(req.query.type).slice('inventory.'.length) } }] : []),
      { $sort: { 'movementLog.createdAt': -1 } }, { $limit: 100 },
      { $project: { ownerId: 1, skuNumber: 1, movement: '$movementLog' } }
    ]) : [],
    !req.query.type || req.query.type === 'user.login' || req.query.type === 'admin.action' ? AuditLog.find({ ...logQuery, ...(req.query.type === 'user.login' ? { action: 'user.login' } : req.query.type === 'admin.action' ? { action: /^admin\./ } : {}) }).sort({ createdAt: -1 }).limit(100).populate('targetUser', 'name email').lean() : []
  ]);
  users.forEach((user) => activity.push({ type: 'user.registered', userId: user._id, user: { name: user.name, email: user.email }, message: 'User registered', at: user.date }));
  products.forEach((product) => activity.push({ type: 'product.created', userId: product.ownerId?._id, user: product.ownerId, message: `Product ${product.name} (${product.skuNumber}) added`, at: product.date }));
  orders.forEach((order) => activity.push({ type: 'order.created', userId: order.ownerId?._id, user: order.ownerId, message: `Order ${order._id} created`, at: order.date }));
  movements.forEach((row) => activity.push({ type: `inventory.${row.movement.type}`, userId: row.ownerId, message: `${row.movement.type}: ${row.movement.quantity} units for ${row.skuNumber} (${row.movement.reason})`, at: row.movement.createdAt }));
  logs.forEach((log) => activity.push({ type: log.action, userId: log.targetUser?._id, user: log.targetUser, message: log.action === 'user.login' ? 'User signed in' : `Admin action: ${log.action}`, at: log.createdAt, details: log.details }));
  const filtered = activity.filter((row) => !req.query.userId || String(row.userId) === String(userId)).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 200);
  res.json({ success: true, data: filtered });
}));

router.get('/audit-logs', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const filter = {};
  if (req.query.userId) filter.targetUser = validId(req.query.userId);
  if (req.query.action) filter.action = String(req.query.action).slice(0, 100);
  const [data, total] = await Promise.all([AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('actor', 'name email').populate('targetUser', 'name email').lean(), AuditLog.countDocuments(filter)]);
  res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

module.exports = router;

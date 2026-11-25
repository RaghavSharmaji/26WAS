const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const User = require('../model/User');
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
const asyncHandler = require('../middleware/asyncHandler');

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

async function inventoryTotal(ownerId) {
  const match = ownerId ? { ownerId } : {};
  const [row] = await Pallet.aggregate([
    { $match: match },
    { $group: { _id: null, units: { $sum: { $ifNull: ['$contAvailable', '$cont'] } }, palletCount: { $sum: 1 } } }
  ]);
  return { units: row?.units || 0, palletCount: row?.palletCount || 0 };
}

async function lowStockRows(ownerId) {
  const query = { reorderLevel: { $gt: 0 } };
  if (ownerId) query.ownerId = ownerId;
  const items = await Item.find(query).select('ownerId name skuNumber reorderLevel').lean();
  if (!items.length) return [];
  const stockRows = await Pallet.aggregate([
    { $match: { ...(ownerId ? { ownerId } : {}), skuNumber: { $in: items.map((item) => item.skuNumber) } } },
    { $group: { _id: { ownerId: '$ownerId', sku: '$skuNumber' }, available: { $sum: { $ifNull: ['$contAvailable', '$cont'] } } } }
  ]);
  const stockByKey = new Map(stockRows.map((row) => [`${row._id.ownerId}:${row._id.sku}`, row.available]));
  return items.map((item) => ({
    item,
    availableQuantity: stockByKey.get(`${item.ownerId}:${item.skuNumber}`) || 0
  })).filter((row) => row.availableQuantity <= row.item.reorderLevel);
}

async function userStatsForIds(ids) {
  const [productRows, palletRows, orderRows, warehouseRows, supplierRows] = await Promise.all([
    Item.aggregate([{ $match: { ownerId: { $in: ids } } }, { $group: { _id: '$ownerId', count: { $sum: 1 } } }]),
    Pallet.aggregate([{ $match: { ownerId: { $in: ids } } }, { $group: { _id: '$ownerId', units: { $sum: { $ifNull: ['$contAvailable', '$cont'] } } } }]),
    Order.aggregate([{ $match: { ownerId: { $in: ids } } }, { $group: { _id: '$ownerId', count: { $sum: 1 } } }]),
    Warehouse.aggregate([{ $match: { ownerId: { $in: ids } } }, { $group: { _id: '$ownerId', count: { $sum: 1 } } }]),
    Supplier.aggregate([{ $match: { ownerId: { $in: ids } } }, { $group: { _id: '$ownerId', count: { $sum: 1 } } }])
  ]);
  const maps = [productRows, palletRows, orderRows, warehouseRows, supplierRows].map((rows) => new Map(rows.map((row) => [String(row._id), row])));
  return new Map(ids.map((id) => {
    const key = String(id);
    return [key, {
      products: maps[0].get(key)?.count || 0,
      inventoryUnits: maps[1].get(key)?.units || 0,
      orders: maps[2].get(key)?.count || 0,
      warehouses: maps[3].get(key)?.count || 0,
      suppliers: maps[4].get(key)?.count || 0
    }];
  }));
}

async function userReport(ownerId) {
  const [productCount, orderCount, warehouseCount, supplierCount, categoryCount, locationCount, inventory, lowStock] = await Promise.all([
    Item.countDocuments({ ownerId }), Order.countDocuments({ ownerId }), Warehouse.countDocuments({ ownerId }), Supplier.countDocuments({ ownerId }),
    Category.countDocuments({ ownerId }), Location.countDocuments({ ownerId }), inventoryTotal(ownerId), lowStockRows(ownerId)
  ]);
  return { productCount, orderCount, warehouseCount, supplierCount, categoryCount, locationCount, inventoryUnits: inventory.units, palletCount: inventory.palletCount, lowStockProducts: lowStock.length };
}

async function inventoryRows(ownerId) {
  const rows = await Pallet.aggregate([
    { $match: ownerId ? { ownerId } : {} },
    { $group: { _id: { ownerId: '$ownerId', sku: '$skuNumber' }, availableQuantity: { $sum: { $ifNull: ['$contAvailable', '$cont'] } }, palletCount: { $sum: 1 } } },
    { $sort: { '_id.sku': 1 } }
  ]);
  const ownerIdStrings = [...new Set(rows.map((row) => row._id.ownerId ? String(row._id.ownerId) : null))];
  const ownerIds = ownerIdStrings.filter(Boolean).map((id) => new mongoose.Types.ObjectId(id));
  const skus = [...new Set(rows.map((row) => row._id.sku))];
  const itemOwnerClauses = [];
  if (ownerIds.length) itemOwnerClauses.push({ ownerId: { $in: ownerIds } });
  if (ownerIdStrings.includes(null)) itemOwnerClauses.push({ ownerId: { $exists: false } });
  const [items, owners] = await Promise.all([
    itemOwnerClauses.length ? Item.find({ $or: itemOwnerClauses, skuNumber: { $in: skus } }).select('ownerId name skuNumber department reorderLevel').lean() : [],
    ownerIds.length ? User.find({ _id: { $in: ownerIds } }).select('name email').lean() : []
  ]);
  const itemByKey = new Map(items.map((item) => [`${item.ownerId}:${item.skuNumber}`, item]));
  const ownerById = new Map(owners.map((owner) => [String(owner._id), { _id: owner._id, name: owner.name, email: owner.email }]));
  return rows.map((row) => {
    const key = `${row._id.ownerId}:${row._id.sku}`;
    return { ownerId: ownerById.get(String(row._id.ownerId)) || row._id.ownerId || null, skuNumber: row._id.sku, availableQuantity: row.availableQuantity, palletCount: row.palletCount, item: itemByKey.get(key) || null };
  });
}

async function userActivity(userId, { from, to, type } = {}) {
  const dateFilter = {};
  if (from) dateFilter.$gte = new Date(from);
  if (to) dateFilter.$lte = new Date(to);
  const dateOk = Object.values(dateFilter).every((date) => !Number.isNaN(date.getTime()));
  if (!dateOk) throw httpError(400, 'from and to must be valid dates');
  const createdFilter = Object.keys(dateFilter).length ? { date: dateFilter } : {};
  const movementMatch = { ownerId: userId };
  if (Object.keys(dateFilter).length) movementMatch['movementLog.createdAt'] = dateFilter;
  const [items, orders, movements, logs] = await Promise.all([
    type && type !== 'product.created' ? [] : Item.find({ ownerId: userId, ...createdFilter }).sort({ date: -1 }).limit(50).select('name skuNumber date').lean(),
    type && type !== 'order.created' ? [] : Order.find({ ownerId: userId, ...createdFilter }).sort({ date: -1 }).limit(50).select('date status').lean(),
    type && !type.startsWith('inventory.') ? [] : Pallet.aggregate([
      { $match: movementMatch }, { $unwind: '$movementLog' },
      ...(Object.keys(dateFilter).length ? [{ $match: { 'movementLog.createdAt': dateFilter } }] : []),
      ...(type?.startsWith('inventory.') ? [{ $match: { 'movementLog.type': type.slice('inventory.'.length) } }] : []),
      { $sort: { 'movementLog.createdAt': -1 } }, { $limit: 50 },
      { $project: { skuNumber: 1, movement: '$movementLog' } }
    ]),
    type && type !== 'admin.action' && type !== 'user.login' ? [] : AuditLog.find({ targetUser: userId, ...(type === 'admin.action' ? { action: /^admin\./ } : type ? { action: type } : {}), ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}) }).sort({ createdAt: -1 }).limit(50).lean()
  ]);
  return [
    ...items.map((item) => ({ type: 'product.created', userId, message: `Product ${item.name} (${item.skuNumber}) added`, at: item.date })),
    ...orders.map((order) => ({ type: 'order.created', userId, message: `Order ${order._id} created (${order.status || 'new'})`, at: order.date })),
    ...movements.map((row) => ({ type: `inventory.${row.movement.type}`, userId, message: `${row.movement.type} ${row.movement.quantity} units for ${row.skuNumber}: ${row.movement.reason}`, at: row.movement.createdAt })),
    ...logs.map((log) => ({ type: log.action, userId, message: log.action === 'user.login' ? 'User signed in' : `Admin action: ${log.action}`, at: log.createdAt, details: log.details }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 100);
}

router.get('/overview', asyncHandler(async (req, res) => {
  const notDeleted = { role: { $ne: 'superadmin' }, accountStatus: { $ne: 'deleted' } };
  const activeUsers = await User.countDocuments({ role: { $ne: 'superadmin' }, $or: [{ accountStatus: 'active' }, { accountStatus: { $exists: false } }] });
  const [totalUsers, inactiveUsers, productCount, orderCount, warehouseCount, supplierCount, categoryCount, locationCount, inventory, lowStock, usersTrend, productsTrend, ordersTrend, activityTrend, inventoryDistribution] = await Promise.all([
    User.countDocuments(notDeleted),
    User.countDocuments({ role: { $ne: 'superadmin' }, accountStatus: 'inactive' }),
    Item.countDocuments(), Order.countDocuments(), Warehouse.countDocuments(), Supplier.countDocuments(), Category.countDocuments(), Location.countDocuments(),
    inventoryTotal(null), lowStockRows(null),
    User.aggregate([{ $match: { role: { $ne: 'superadmin' }, date: { $gte: new Date(Date.now() - 365 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Item.aggregate([{ $match: { date: { $gte: new Date(Date.now() - 365 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Order.aggregate([{ $match: { date: { $gte: new Date(Date.now() - 365 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    AuditLog.aggregate([{ $match: { action: 'user.login', createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Pallet.aggregate([{ $group: { _id: '$department', units: { $sum: { $ifNull: ['$contAvailable', '$cont'] } }, users: { $addToSet: '$ownerId' } } }, { $sort: { units: -1 } }])
  ]);
  res.json({ success: true, data: {
    stats: { totalUsers, activeUsers, inactiveUsers, productCount, inventoryUnits: inventory.units, orderCount, warehouseCount, supplierCount, categoryCount, locationCount, lowStockProducts: lowStock.length },
    trends: { users: usersTrend, products: productsTrend, orders: ordersTrend, activity: activityTrend },
    inventoryDistribution: inventoryDistribution.map((row) => ({ department: row._id || 'Unassigned', units: row.units, users: row.users.filter(Boolean).length }))
  } });
}));

router.get('/users', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const filter = { role: { $ne: 'superadmin' } };
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
  const user = await User.findOne({ _id: id, role: { $ne: 'superadmin' } }).lean();
  if (!user) throw httpError(404, 'User not found');
  res.json({ success: true, data: { ...publicUser(user), stats: await userReport(id) } });
}));

router.patch('/users/:id', asyncHandler(async (req, res) => {
  const id = validId(req.params.id);
  const user = await User.findOne({ _id: id, role: { $ne: 'superadmin' } });
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
  const user = await User.findOne({ _id: id, role: { $ne: 'superadmin' } });
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
  const user = await User.findOne({ _id: id, role: { $ne: 'superadmin' } });
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
  const user = await User.findOne({ _id: ownerId, role: { $ne: 'superadmin' } }).select('_id').lean();
  if (!user) throw httpError(404, 'User not found');
  const resource = req.params.resource;
  let data;
  if (resource === 'inventory') data = await inventoryRows(ownerId);
  else if (resource === 'reports') data = await userReport(ownerId);
  else if (resource === 'activity') data = await userActivity(ownerId, req.query);
  else data = await ownedModels[resource].find({ ownerId }).sort({ createdAt: -1, date: -1 }).limit(500).lean();
  res.json({ success: true, data });
}));

router.get('/users/:id/dashboard', asyncHandler(async (req, res) => {
  const ownerId = validId(req.params.id);
  const user = await User.findOne({ _id: ownerId, role: { $ne: 'superadmin' } }).select('_id name email accountStatus').lean();
  if (!user) throw httpError(404, 'User not found');
  const [stats, lowStock, activity, products, inventory, orders] = await Promise.all([
    userReport(ownerId), lowStockRows(ownerId), userActivity(ownerId),
    Item.find({ ownerId }).sort({ date: -1 }).limit(10).lean(),
    inventoryRows(ownerId),
    Order.find({ ownerId }).sort({ date: -1 }).limit(10).lean()
  ]);
  res.json({ success: true, data: { user: publicUser(user), stats, lowStock, recentActivity: activity.slice(0, 10), products, inventory: inventory.slice(0, 10), orders, readOnly: true } });
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
  const userQuery = { role: { $ne: 'superadmin' }, ...(userId ? { _id: userId } : {}), ...((from || to) ? { date: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {}) };
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

const mongoose = require('mongoose');
const Warehouse = require('../model/Warehouse');
const { runWithAuth } = require('./requestContext');

const read = [
  'dashboard.view', 'company.settings.view', 'users.view', 'roles.view', 'warehouses.view',
  'locations.view', 'products.view', 'categories.view', 'suppliers.view', 'customers.view',
  'purchaseOrders.view', 'receiving.view', 'inventory.view', 'transfers.view', 'orders.view',
  'picking.view', 'packing.view', 'shipping.view', 'returns.view', 'reports.view', 'auditLogs.view'
];

const ROLE_PERMISSIONS = Object.freeze({
  company_admin: ['*'],
  warehouse_manager: [
    ...read, 'locations.create', 'locations.update', 'receiving.create', 'receiving.execute',
    'receiving.putaway', 'inventory.receive', 'inventory.issue', 'inventory.adjust', 'inventory.putaway',
    'inventory.update', 'transfers.create', 'transfers.update', 'orders.update', 'picking.execute',
    'packing.execute', 'shipping.execute', 'returns.receive', 'returns.update'
  ],
  inventory_manager: [
    ...read, 'products.create', 'products.update', 'inventory.receive', 'inventory.issue',
    'inventory.adjust', 'inventory.putaway', 'inventory.update', 'transfers.create', 'transfers.update'
  ],
  procurement_manager: [
    ...read, 'suppliers.create', 'suppliers.update', 'purchaseOrders.create', 'purchaseOrders.update',
    'purchaseOrders.approve', 'receiving.create', 'receiving.execute', 'receiving.putaway', 'inventory.receive'
  ],
  warehouse_staff: [
    ...read, 'receiving.execute', 'receiving.putaway', 'inventory.receive', 'inventory.issue',
    'inventory.putaway', 'orders.update', 'picking.execute', 'packing.execute', 'shipping.execute', 'returns.receive'
  ],
  // Kept for existing Phase 2 memberships. New assignments should use warehouse_staff.
  staff: [
    ...read, 'receiving.execute', 'receiving.putaway', 'inventory.receive', 'inventory.issue',
    'inventory.putaway', 'orders.update', 'picking.execute', 'packing.execute', 'shipping.execute', 'returns.receive'
  ],
  auditor: read,
  legacy_admin: ['*'],
  legacy_staff: [
    ...read, 'receiving.execute', 'receiving.putaway', 'inventory.receive', 'inventory.issue',
    'inventory.putaway', 'orders.update', 'picking.execute', 'packing.execute', 'shipping.execute', 'returns.receive'
  ]
});

const routeRules = [
  ['/api/categories', 'categories.view', { POST: 'categories.create', PUT: 'categories.update', DELETE: 'categories.delete' }],
  ['/api/suppliers', 'suppliers.view', { POST: 'suppliers.create', PUT: 'suppliers.update', DELETE: 'suppliers.delete' }],
  ['/api/warehouses', 'warehouses.view', { POST: 'warehouses.create', PUT: 'warehouses.update', DELETE: 'warehouses.delete' }],
  ['/api/locations', 'locations.view', { POST: 'locations.create', PUT: 'locations.update', DELETE: 'locations.delete' }],
  ['/api/products', 'products.view', { POST: 'products.create', PUT: 'products.update', DELETE: 'products.delete' }],
  ['/api/items', 'products.view', { POST: 'products.create', PUT: 'products.update', DELETE: 'products.delete' }],
  ['/api/inventory', 'inventory.view', { POST: { '/stock-in': 'inventory.receive', '/stock-out': 'inventory.issue', '/adjust': 'inventory.adjust' } }],
  ['/api/pallets', 'inventory.view', { POST: 'inventory.receive', PUT: 'inventory.putaway', DELETE: 'inventory.delete' }],
  ['/api/reports', 'reports.view', {}],
  ['/api/item', 'products.view', { POST: { '/create': 'products.create', '/update': 'products.update', '/delete': 'products.delete' } }],
  ['/api/location', 'locations.view', { POST: { '/create': 'locations.create', '/update': 'locations.update', '/delete': 'locations.delete' }, DELETE: 'locations.delete' }],
  ['/api/pallet', 'inventory.view', { POST: { '/create': 'inventory.receive', '/update': 'inventory.putaway', '/delete': 'inventory.delete' } }],
  ['/api/receiving', 'receiving.view', { POST: {
    '/create': 'receiving.create', '/send': 'receiving.putaway', '/dynamicsend': 'receiving.putaway',
    '/pike-pallet': 'receiving.execute', '/valedation': 'receiving.execute', '/status': 'receiving.view',
    '/get-chart-data': 'reports.view'
  } }],
  ['/api/order', 'orders.view', { POST: { '/create': 'orders.create', '/submit': 'orders.approve' }, PUT: 'orders.update' }],
  ['/api/ticket', 'picking.view', { POST: { '/create': 'picking.execute' }, DELETE: 'picking.delete' }],
  ['/api/picker', 'picking.view', { POST: 'picking.execute' }],
  ['/webs/item', 'products.view', { POST: 'products.create' }]
];

function normalizePath(value) {
  if (!value || value === '/') return '/';
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}

function permissionForRequest(req) {
  const base = normalizePath(req.baseUrl || '');
  const path = normalizePath(req.path || '/');
  const rule = routeRules.find(([prefix]) => prefix === base);
  if (!rule) return null;
  const [, readPermission, methodRules] = rule;
  const route = methodRules[req.method];
  if (typeof route === 'string') return route;
  if (route && typeof route === 'object') {
    const exact = route[path];
    if (exact) return exact;
    if (Object.keys(route).some(key => key.startsWith('/') && path.startsWith(`${key}/`))) {
      return Object.entries(route).find(([key]) => key.startsWith('/') && path.startsWith(`${key}/`))?.[1] || null;
    }
  }
  if (req.method === 'GET' || req.method === 'HEAD') return readPermission;
  return null;
}

function hasPermission(role, permission) {
  const allowed = ROLE_PERMISSIONS[role] || [];
  return allowed.includes('*') || allowed.includes(permission);
}

function deny(res, status, code, message) {
  return res.status(status).json({ success: false, code, message });
}

function requestRole(req) {
  if (req.tenant?.companyId) return req.tenant.membershipRole;
  if (req.tenant?.legacyOwnerId) return req.auth?.role === 'admin' ? 'legacy_admin' : 'legacy_staff';
  return null;
}

function requireCompanyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.auth) return deny(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
    if (req.auth.role === 'superadmin') return deny(res, 403, 'PLATFORM_ROUTE_REQUIRED', 'Use a platform administration endpoint for this action');
    const role = requestRole(req);
    if (!role) return deny(res, 403, 'COMPANY_CONTEXT_REQUIRED', 'An active company membership or legacy owner context is required');
    if (!permissions.every(permission => hasPermission(role, permission))) {
      return deny(res, 403, 'PERMISSION_REQUIRED', 'You do not have permission to perform this action');
    }
    return next();
  };
}

function requirePlatformRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) return deny(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
    if (!roles.includes(req.auth.role)) return deny(res, 403, 'PLATFORM_ROLE_REQUIRED', 'Platform administrator permission is required');
    return next();
  };
}

function authorizeOperationalRequest() {
  return async (req, res, next) => {
    if (!req.auth || !req.tenant) return deny(res, 403, 'TENANT_CONTEXT_REQUIRED', 'Operational requests require a verified tenant context');
    if (req.auth.role === 'superadmin') return deny(res, 403, 'PLATFORM_ROUTE_REQUIRED', 'Use a platform administration endpoint for this action');
    const permission = permissionForRequest(req);
    if (!permission) return deny(res, 403, 'PERMISSION_NOT_CONFIGURED', 'No permission is configured for this operation');
    const role = requestRole(req);
    if (!hasPermission(role, permission)) return deny(res, 403, 'PERMISSION_REQUIRED', 'You do not have permission to perform this action');

    if (req.tenant.companyId) {
      const fields = ['warehouseId', 'warehouse', 'fromWarehouseId', 'toWarehouseId', 'sourceWarehouseId', 'destinationWarehouseId'];
      const ids = new Set();
      for (const source of [req.params || {}, req.query || {}, req.body || {}]) {
        for (const field of fields) {
          const value = source[field];
          if (Array.isArray(value)) value.forEach(id => id && ids.add(String(id)));
          else if (value) ids.add(String(value));
        }
      }
      for (const id of ids) {
        if (!mongoose.Types.ObjectId.isValid(id)) return deny(res, 400, 'INVALID_WAREHOUSE_ID', 'A warehouse identifier is invalid');
        if (req.tenant.activeWarehouseId && String(req.tenant.activeWarehouseId) !== id) {
          return deny(res, 403, 'WAREHOUSE_ACCESS_DENIED', 'The requested warehouse differs from the selected warehouse');
        }
        const context = { ...req.auth, ...req.tenant, role: req.auth.role };
        const warehouse = await runWithAuth(context, () => Warehouse.findOne({ _id: id, companyId: req.tenant.companyId }).select('_id').lean().exec());
        if (!warehouse) return deny(res, 403, 'WAREHOUSE_ACCESS_DENIED', 'The warehouse is not in your company or assigned to you');
      }
    }
    return next();
  };
}

module.exports = {
  ROLE_PERMISSIONS,
  permissionForRequest,
  hasPermission,
  requireCompanyPermission,
  requirePlatformRole,
  authorizeOperationalRequest
};

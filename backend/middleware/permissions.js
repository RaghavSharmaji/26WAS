const mongoose = require('mongoose');
const Warehouse = require('../model/Warehouse');
const { runWithAuth } = require('./requestContext');
const { isSuperAdminRole, normalizeRole } = require('./roleCompatibility');

const read = [
  'dashboard.view', 'company.settings.view', 'users.view', 'roles.view', 'warehouses.view',
  'locations.view', 'products.view', 'categories.view', 'suppliers.view', 'customers.view',
  'purchaseOrders.view', 'receiving.view', 'inventory.view', 'transfers.view', 'orders.view',
  'picking.view', 'packing.view', 'shipping.view', 'returns.view', 'reports.view', 'auditLogs.view'
];

const companyAdminPermissions = [
  ...read,
  'customers.create', 'customers.update',
  'users.manage', 'roles.manage',
  'purchaseOrders.create', 'purchaseOrders.update', 'purchaseOrders.approve',
  'categories.create', 'categories.update', 'categories.delete',
  'suppliers.create', 'suppliers.update', 'suppliers.delete',
  'warehouses.create', 'warehouses.update', 'warehouses.delete',
  'locations.create', 'locations.update', 'locations.delete',
  'products.create', 'products.update', 'products.delete',
  'inventory.receive', 'inventory.issue', 'inventory.adjust', 'inventory.putaway', 'inventory.update', 'inventory.delete',
  'receiving.create', 'receiving.execute', 'receiving.putaway',
  'orders.create', 'orders.update', 'orders.submit', 'orders.cancel', 'inventory.reserve', 'picking.assign',
  'picking.execute', 'picking.delete', 'packing.execute', 'shipping.execute',
  'returns.receive', 'returns.update', 'transfers.create', 'transfers.update'
];

const warehouseRead = [
  'warehouses.view', 'locations.view', 'products.view', 'categories.view', 'suppliers.view',
  'purchaseOrders.view', 'receiving.view', 'inventory.view', 'orders.view', 'customers.view', 'picking.view', 'packing.view',
  'shipping.view', 'reports.view'
];

const warehouseExecution = [
  'receiving.execute', 'receiving.putaway', 'inventory.receive', 'inventory.putaway',
  'picking.execute', 'packing.execute', 'shipping.execute'
];

const legacyAdminPermissions = [
  ...companyAdminPermissions, 'orders.create', 'orders.update', 'receiving.view', 'inventory.view'
];

const rolePermissions = {
  // Enumerated grants avoid authorizing future or platform-only permission IDs.
  company_admin: companyAdminPermissions,
  warehouse_manager: [
    ...warehouseRead, 'locations.create', 'locations.update', 'receiving.create',
    ...warehouseExecution, 'inventory.issue', 'inventory.adjust', 'inventory.update',
    'orders.update', 'inventory.reserve', 'picking.assign', 'transfers.create', 'transfers.update', 'returns.receive', 'returns.update'
  ],
  inventory_manager: [
    ...read, 'products.create', 'products.update', 'inventory.receive', 'inventory.issue', 'inventory.reserve',
    'inventory.adjust', 'inventory.putaway', 'inventory.update', 'transfers.create', 'transfers.update'
  ],
  procurement_manager: [
    ...read, 'suppliers.create', 'suppliers.update', 'purchaseOrders.create', 'purchaseOrders.update',
    'purchaseOrders.approve', 'receiving.create', 'receiving.execute', 'receiving.putaway', 'inventory.receive'
  ],
  warehouse_staff: [...warehouseRead, ...warehouseExecution],
  // Retain the old membership alias only for its existing assigned task grants.
  staff: [...warehouseRead, ...warehouseExecution],
  auditor: read,
  legacy_admin: legacyAdminPermissions,
  legacy_staff: [
    ...warehouseRead, ...warehouseExecution,
    // Preserve existing single-owner CRUD only; these grants never apply to memberships.
    'categories.create', 'categories.update', 'suppliers.create', 'suppliers.update',
    'warehouses.create', 'warehouses.update', 'locations.create', 'locations.update',
    'products.create', 'products.update'
  ]
};
const ROLE_PERMISSIONS = Object.freeze(Object.fromEntries(
  Object.entries(rolePermissions).map(([role, permissions]) => [role, Object.freeze(permissions)])
));
const KNOWN_PERMISSION_IDS = Object.freeze([...new Set(Object.values(ROLE_PERMISSIONS).flat())]);
const knownPermissionSet = new Set(KNOWN_PERMISSION_IDS);

const routeRules = [
  ['/api/customers', 'customers.view', { POST: 'customers.create', PUT: 'customers.update' }],
  ['/api/shipments', 'shipping.view', {}],
  ['/api/categories', 'categories.view', { POST: 'categories.create', PUT: 'categories.update', DELETE: 'categories.delete' }],
  ['/api/suppliers', 'suppliers.view', { POST: 'suppliers.create', PUT: 'suppliers.update', DELETE: 'suppliers.delete' }],
  ['/api/warehouses', 'warehouses.view', { POST: 'warehouses.create', PUT: 'warehouses.update', DELETE: 'warehouses.delete' }],
  ['/api/locations', 'locations.view', { POST: 'locations.create', PUT: 'locations.update', DELETE: 'locations.delete' }],
  ['/api/products', 'products.view', { POST: 'products.create', PUT: 'products.update', DELETE: 'products.delete' }],
  ['/api/items', 'products.view', { POST: 'products.create', PUT: 'products.update', DELETE: 'products.delete' }],
  ['/api/inventory', 'inventory.view', { POST: { '/stock-in': 'inventory.adjust', '/stock-out': 'inventory.issue', '/stock-out/batch': 'inventory.issue', '/adjust': 'inventory.adjust' } }],
  ['/api/pallets', 'inventory.view', { POST: 'inventory.adjust', PUT: 'inventory.putaway', DELETE: 'inventory.delete' }],
  ['/api/reports', 'reports.view', {}],
  ['/api/purchase-orders', 'purchaseOrders.view', {
    POST: { '/': 'purchaseOrders.create', '/:id/submit': 'purchaseOrders.update' },
    PUT: { '/:id': 'purchaseOrders.update' }
  }],
  ['/api/grns', 'receiving.view', {
    POST: { '/': 'receiving.execute', '/:id/lines/:lineId/putaway': 'receiving.putaway' },
    PATCH: { '/:id/lines/:lineId/inspection': 'receiving.execute' }
  }],
  ['/api/item', 'products.view', { POST: { '/create': 'products.create', '/update': 'products.update', '/delete': 'products.delete' } }],
  ['/api/location', 'locations.view', { POST: { '/create': 'locations.create', '/get-info': 'locations.view', '/update': 'locations.update', '/delete': 'locations.delete' }, DELETE: 'locations.delete' }],
  ['/api/pallet', 'inventory.view', { POST: { '/create': 'inventory.adjust', '/status': 'inventory.view', '/update': 'inventory.putaway', '/delete': 'inventory.delete' } }],
  ['/api/receiving', 'receiving.view', { POST: {
    '/create': 'inventory.adjust', '/send': 'receiving.putaway', '/dynamicsend': 'receiving.putaway',
    '/pike-pallet': 'receiving.view', '/valedation': 'receiving.execute', '/status': 'receiving.view',
    '/get-chart-data': 'reports.view'
  } }],
  ['/api/order', 'orders.view', {
    POST: {
      '/': 'orders.create', '/create': 'orders.create', '/:id/submit': 'orders.submit',
      '/:id/reserve': 'inventory.reserve', '/:id/picking/assign': 'picking.assign',
      '/:id/picking/confirm': 'picking.execute', '/:id/packing': 'packing.execute',
      '/:id/dispatch': 'shipping.execute', '/:id/delivery': 'shipping.execute', '/:id/cancel': 'orders.cancel'
    },
    PUT: { '/:id': 'orders.update' }
  }],
  ['/api/ticket', 'picking.view', { POST: { '/create': 'picking.execute' }, DELETE: 'picking.delete' }],
  ['/api/picker', 'picking.view', { POST: 'picking.execute' }],
  ['/webs/item', 'products.view', { POST: 'products.view' }]
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
    const parameterized = Object.entries(route).find(([key]) => {
      if (!key.includes(':')) return false;
      const expected = key.split('/');
      const actual = path.split('/');
      return expected.length === actual.length && expected.every((part, index) => part.startsWith(':') || part === actual[index]);
    });
    if (parameterized) return parameterized[1];
  }
  if (req.method === 'GET' || req.method === 'HEAD') return readPermission;
  return null;
}

function effectivePermissions(role, overrides = []) {
  const allowed = ROLE_PERMISSIONS[role] || [];
  const result = new Set(allowed);
  for (const override of Array.isArray(overrides) ? overrides : []) {
    if (!knownPermissionSet.has(override?.permission)) continue;
    if (override.effect === 'deny') result.delete(override.permission);
    else if (override.effect === 'allow') result.add(override.permission);
  }
  return [...result];
}

function hasPermission(role, permission, overrides = []) {
  if (!knownPermissionSet.has(permission)) return false;
  const matching = (Array.isArray(overrides) ? overrides : []).filter(row => row?.permission === permission);
  if (matching.some(row => row.effect === 'deny')) return false;
  if (matching.some(row => row.effect === 'allow')) return true;
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
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
    if (isSuperAdminRole(req.auth.role)) return deny(res, 403, 'PLATFORM_ROUTE_REQUIRED', 'Use a platform administration endpoint for this action');
    const role = requestRole(req);
    if (!role) return deny(res, 403, 'COMPANY_CONTEXT_REQUIRED', 'An active company membership or legacy owner context is required');
    if (!permissions.every(permission => hasPermission(role, permission, req.tenant?.permissionOverrides))) {
      return deny(res, 403, 'PERMISSION_REQUIRED', 'You do not have permission to perform this action');
    }
    return next();
  };
}

function requirePlatformRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) return deny(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
    if (!roles.map(normalizeRole).includes(normalizeRole(req.auth.role))) return deny(res, 403, 'PLATFORM_ROLE_REQUIRED', 'Platform administrator permission is required');
    return next();
  };
}

function authorizeOperationalRequest() {
  return async (req, res, next) => {
    if (!req.auth || !req.tenant) return deny(res, 403, 'TENANT_CONTEXT_REQUIRED', 'Operational requests require a verified tenant context');
    if (isSuperAdminRole(req.auth.role)) return deny(res, 403, 'PLATFORM_ROUTE_REQUIRED', 'Use a platform administration endpoint for this action');
    const permission = permissionForRequest(req);
    if (!permission) return deny(res, 403, 'PERMISSION_NOT_CONFIGURED', 'No permission is configured for this operation');
    const role = requestRole(req);
    if (!hasPermission(role, permission, req.tenant?.permissionOverrides)) return deny(res, 403, 'PERMISSION_REQUIRED', 'You do not have permission to perform this action');

    // Tenant identifiers are derived from auth + active membership, never from client payloads.
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'companyId')) delete req.body.companyId;
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'ownerId')) delete req.body.ownerId;
    if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'companyId')) delete req.query.companyId;

    const fields = ['warehouseId', 'warehouse', 'fromWarehouseId', 'toWarehouseId', 'sourceWarehouseId', 'destinationWarehouseId'];
    const ids = new Set();
    for (const source of [req.params || {}, req.query || {}, req.body || {}]) {
      for (const field of fields) {
        const value = source[field];
        if (Array.isArray(value)) value.forEach(id => id && ids.add(String(id)));
        else if (value) ids.add(String(value));
      }
    }
    if (req.tenant.companyId) {
      for (const id of ids) {
        if (!mongoose.Types.ObjectId.isValid(id)) return deny(res, 400, 'INVALID_WAREHOUSE_ID', 'A warehouse identifier is invalid');
        if (req.tenant.activeWarehouseId && String(req.tenant.activeWarehouseId) !== id) {
          return deny(res, 403, 'WAREHOUSE_ACCESS_DENIED', 'The requested warehouse differs from the selected warehouse');
        }
        const context = { ...req.auth, ...req.tenant, role: req.auth.role };
        const warehouse = await runWithAuth(context, () => Warehouse.findOne({ _id: id, companyId: req.tenant.companyId }).select('_id').lean().exec());
        if (!warehouse) return deny(res, 403, 'WAREHOUSE_ACCESS_DENIED', 'The warehouse is not in your company or assigned to you');
      }
    } else {
      for (const id of ids) {
        if (!mongoose.Types.ObjectId.isValid(id)) return deny(res, 400, 'INVALID_WAREHOUSE_ID', 'A warehouse identifier is invalid');
        const warehouse = await runWithAuth({ ...req.auth, ...req.tenant }, () =>
          Warehouse.findOne({ _id: id }).select('_id').lean().exec());
        if (!warehouse) return deny(res, 403, 'WAREHOUSE_ACCESS_DENIED', 'The warehouse is not owned by this account');
      }
    }
    return next();
  };
}

module.exports = {
  ROLE_PERMISSIONS,
  KNOWN_PERMISSION_IDS,
  effectivePermissions,
  permissionForRequest,
  hasPermission,
  requireCompanyPermission,
  requirePlatformRole,
  authorizeOperationalRequest
};

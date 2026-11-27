const mongoose = require('mongoose');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const Warehouse = require('../model/Warehouse');
const { runWithAuth } = require('./requestContext');
const { isSuperAdminRole } = require('./roleCompatibility');

function deny(res, status, code, message) {
  return res.status(status).json({ success: false, code, message });
}

function tenantContext(options = {}) {
  return async function resolveTenantContext(req, res, next) {
    if (!req.auth || !req.user) return deny(res, 401, 'AUTHENTICATION_REQUIRED', 'Authentication required');
    if (isSuperAdminRole(req.auth.role)) {
      return deny(res, 403, 'PLATFORM_ROUTE_REQUIRED', 'Platform administrators must use platform administration endpoints');
    }

    try {
      const allMemberships = await CompanyMembership.find({ userId: req.user._id })
        .select('companyId role assignedWarehouseIds permissionOverrides status revision').lean();
      const memberships = allMemberships.filter(row => row.status === 'active');
      const requestedCompanyId = req.get('x-company-id');

      if (!allMemberships.length) {
        if (requestedCompanyId) return deny(res, 403, 'COMPANY_MEMBERSHIP_REQUIRED', 'You are not an active member of that company');
        // Existing accounts remain on the legacy ownerId boundary until an explicit migration.
        req.tenant = { legacyOwnerId: String(req.user._id), actorId: String(req.user._id), role: 'legacy' };
        req.tenantAuth = { ...req.auth, ...req.tenant };
        return runWithAuth(req.tenantAuth, next);
      }
      if (!memberships.length) return deny(res, 403, 'COMPANY_MEMBERSHIP_INACTIVE', 'No active company membership is available for this account');

      if (memberships.length > 1 && !requestedCompanyId) {
        return deny(res, 409, 'COMPANY_SELECTION_REQUIRED', 'Select an active company before continuing');
      }
      if (requestedCompanyId && !mongoose.Types.ObjectId.isValid(requestedCompanyId)) {
        return deny(res, 400, 'INVALID_COMPANY_ID', 'The selected company ID is invalid');
      }
      const membership = memberships.find(row => String(row.companyId) === String(requestedCompanyId || memberships[0].companyId));
      if (!membership) return deny(res, 403, 'COMPANY_MEMBERSHIP_REQUIRED', 'You are not an active member of that company');

      const company = await Company.findById(membership.companyId).select('name slug status').lean();
      if (!company || company.status !== 'active') {
        const pending = company && company.status === 'pending';
        return deny(res, 403, pending ? 'COMPANY_PENDING' : 'COMPANY_UNAVAILABLE',
          pending ? 'This company is not active yet' : 'This company is suspended, deactivated, or unavailable');
      }

      const warehouseIds = (membership.assignedWarehouseIds || []).map(String);
      const companyAdmin = membership.role === 'company_admin';
      const warehouseScoped = !companyAdmin;
      const requestedWarehouseId = req.get('x-warehouse-id');
      let activeWarehouseId = null;
      if (requestedWarehouseId) {
        if (!mongoose.Types.ObjectId.isValid(requestedWarehouseId)) {
          return deny(res, 400, 'INVALID_WAREHOUSE_ID', 'The selected warehouse ID is invalid');
        }
        if (!companyAdmin && !warehouseIds.includes(String(requestedWarehouseId))) {
          return deny(res, 403, 'WAREHOUSE_ACCESS_DENIED', 'You are not assigned to the selected warehouse');
        }
        const warehouse = await runWithAuth({ ...req.auth, companyId: String(company._id), warehouseScoped: false }, async () =>
          Warehouse.findOne({ _id: requestedWarehouseId, companyId: company._id }).select('_id').lean().exec());
        if (!warehouse) return deny(res, 404, 'WAREHOUSE_NOT_FOUND', 'The selected warehouse does not belong to the active company');
        activeWarehouseId = String(warehouse._id);
      }
      const companyContext = {
        actorId: String(req.user._id),
        companyId: String(company._id),
        companySlug: company.slug,
        companyStatus: company.status,
        membershipId: String(membership._id),
        membershipRevision: Number.isSafeInteger(membership.revision) && membership.revision >= 0 ? membership.revision : 0,
        membershipRole: membership.role,
        permissionOverrides: (membership.permissionOverrides || []).map(row => ({ permission: row.permission, effect: row.effect })),
        allowedWarehouseIds: warehouseIds,
        warehouseScoped,
        activeWarehouseId
      };
      req.tenant = companyContext;
      req.membership = membership;
      req.company = company;
      req.tenantAuth = { ...req.auth, ...companyContext };
      return runWithAuth(req.tenantAuth, next);
    } catch (error) {
      return next(error);
    }
  };
}

function requireCompanyAdmin(req, res, next) {
  if (req.auth && isSuperAdminRole(req.auth.role)) return next();
  if (!req.tenant || req.tenant.membershipRole !== 'company_admin') {
    return deny(res, 403, 'COMPANY_ADMIN_REQUIRED', 'Company Admin permission is required');
  }
  return next();
}

module.exports = tenantContext;
module.exports.requireCompanyAdmin = requireCompanyAdmin;

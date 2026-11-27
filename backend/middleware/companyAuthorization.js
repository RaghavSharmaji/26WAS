const { isSuperAdminRole } = require('./roleCompatibility');

function requireCompanyRole(...roles) {
  return (req, res, next) => {
    if (req.auth && isSuperAdminRole(req.auth.role)) {
      return res.status(403).json({ success: false, code: 'PLATFORM_ROUTE_REQUIRED', message: 'Use a platform administration endpoint for this action' });
    }
    if (req.tenant && req.tenant.companyId) {
      if (!roles.includes(req.tenant.membershipRole)) {
        return res.status(403).json({ success: false, code: 'COMPANY_PERMISSION_REQUIRED', message: 'You do not have permission to perform this action' });
      }
      return next();
    }
    if (req.auth && req.auth.role === 'admin') return next();
    return res.status(403).json({ success: false, message: 'Insufficient permissions' });
  };
}

function requireTenantCompanyRole(...roles) {
  return (req, res, next) => {
    if (req.auth && isSuperAdminRole(req.auth.role)) {
      return res.status(403).json({ success: false, code: 'PLATFORM_ROUTE_REQUIRED', message: 'Use a platform administration endpoint for this action' });
    }
    if (!req.tenant || (!req.tenant.companyId && !req.tenant.legacyOwnerId)) {
      return res.status(403).json({ success: false, code: 'TENANT_CONTEXT_REQUIRED', message: 'An active company context is required' });
    }
    // Legacy owner routes are already bounded by the central permission gate
    // and ownerId query plugin; keep this compatibility boundary for old data.
    if (req.tenant.legacyOwnerId) return next();
    if (!req.tenant.companyId) return res.status(403).json({ success: false, code: 'TENANT_CONTEXT_REQUIRED', message: 'An active company context is required' });
    if (!roles.includes(req.tenant.membershipRole)) {
      return res.status(403).json({ success: false, code: 'COMPANY_PERMISSION_REQUIRED', message: 'You do not have permission to perform this action' });
    }
    return next();
  };
}

module.exports = { requireCompanyRole, requireTenantCompanyRole };

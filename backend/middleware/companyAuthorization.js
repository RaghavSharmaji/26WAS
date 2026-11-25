function requireCompanyRole(...roles) {
  return (req, res, next) => {
    if (req.auth && req.auth.role === 'superadmin') return next();
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
    if (!req.tenant || !req.tenant.companyId || (req.auth && req.auth.role === 'superadmin')) return next();
    if (!roles.includes(req.tenant.membershipRole)) {
      return res.status(403).json({ success: false, code: 'COMPANY_PERMISSION_REQUIRED', message: 'You do not have permission to perform this action' });
    }
    return next();
  };
}

module.exports = { requireCompanyRole, requireTenantCompanyRole };

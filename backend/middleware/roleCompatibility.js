// Temporary auth boundary adapter. Stored legacy role values are not rewritten.
const SUPER_ADMIN_ROLES = new Set(['superadmin', 'super_admin']);

function normalizeRole(role) {
  return SUPER_ADMIN_ROLES.has(role) ? 'super_admin' : role;
}

function isSuperAdminRole(role) {
  return SUPER_ADMIN_ROLES.has(role);
}

module.exports = { normalizeRole, isSuperAdminRole };

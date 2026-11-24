const jwt = require('jsonwebtoken');
const User = require('../model/User');
const { runWithAuth } = require('./requestContext');

function unauthorized(res, message) {
  return res.status(401).json({ success: false, message });
}

async function requireAuth(req, res, next) {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : req.get('x-auth-token');
  if (!token) return unauthorized(res, 'Authentication required');

  try {
    const payload = jwt.verify(token, process.env.SECRET_OR_KEY);
    const user = await User.findById(payload.id);
    if (!user || user.accountStatus === 'inactive' || user.accountStatus === 'deleted') {
      return unauthorized(res, 'This account is inactive or unavailable');
    }
    const currentPath = (req.originalUrl || '').split('?')[0];
    const passwordChangeAllowed = new Set(['/api/auth/change-password', '/api/auth/logout', '/api/auth/user']);
    if (user.mustChangePassword && !passwordChangeAllowed.has(currentPath)) {
      return res.status(403).json({ success: false, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your temporary password before using this account.' });
    }
    req.user = user;
    req.auth = { id: String(user._id), role: user.role || 'staff' };
    return runWithAuth(req.auth, next);
  } catch (err) {
    return unauthorized(res, 'Invalid authentication token');
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) return unauthorized(res, 'Authentication required');
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    return next();
  };
}

module.exports = requireAuth;
module.exports.requireAuth = requireAuth;
module.exports.requireRole = requireRole;

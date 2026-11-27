const bcrypt = require('bcryptjs');
const validator = require('validator');
const User = require('../model/User');
const { isSuperAdminRole } = require('../middleware/roleCompatibility');

async function ensureSuperAdmin() {
  const name = (process.env.SUPER_ADMIN_NAME || '').trim();
  const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || '';

  if (!name || !email || !password) {
    throw new Error('Super Admin configuration is required: set SUPER_ADMIN_NAME, SUPER_ADMIN_EMAIL, and SUPER_ADMIN_PASSWORD in backend/.env.');
  }
  if (name.length < 2 || name.length > 80) throw new Error('SUPER_ADMIN_NAME must be 2 to 80 characters.');
  if (!validator.isEmail(email)) throw new Error('SUPER_ADMIN_EMAIL must be a valid email address.');
  if (password.length < 12 || password.length > 128) throw new Error('SUPER_ADMIN_PASSWORD must be 12 to 128 characters.');
  if (/^CHANGE_|replace_with|placeholder/i.test(password)) throw new Error('Replace the example SUPER_ADMIN_PASSWORD with a private secret before starting the backend.');

  const existing = await User.findOne({ email }).select('+password');
  if (existing) {
    if (!isSuperAdminRole(existing.role)) {
      throw new Error('SUPER_ADMIN_EMAIL already belongs to a non-super-admin account. Choose a new email or use the documented explicit promotion procedure.');
    }
    if (existing.accountStatus === 'deleted') {
      throw new Error('The configured Super Admin account is deleted. Restore it through the explicit admin recovery procedure.');
    }
    return { created: false, email };
  }

  const otherSuperAdmin = await User.findOne({ role: { $in: ['super_admin', 'superadmin'] } }).select('_id email').lean();
  if (otherSuperAdmin) {
    throw new Error('A different Super Admin account already exists. Update SUPER_ADMIN_EMAIL to that account or use the explicit Super Admin credential update procedure.');
  }

  await User.create({
    name,
    email,
    password: await bcrypt.hash(password, 12),
    role: 'super_admin',
    clearance: ['super_admin'],
    accountStatus: 'active',
    status: 'on'
  });
  console.log(`Provisioned Super Admin account ${email}`);
  return { created: true, email };
}

module.exports = ensureSuperAdmin;

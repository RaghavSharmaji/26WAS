require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);
const User = require('../model/User');

async function resetSuperAdminPassword() {
  const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || '';
  if (!process.env.MONGODB_URI || !email || password.length < 12 || password.length > 128) {
    throw new Error('Set MONGODB_URI, SUPER_ADMIN_EMAIL, and a 12–128 character SUPER_ADMIN_PASSWORD in backend/.env.');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ email, role: { $in: ['super_admin', 'superadmin'] } });
  if (!user) throw new Error('Configured Super Admin account was not found. Start the backend once to provision it before resetting its password.');
  user.password = await bcrypt.hash(password, 12);
  user.mustChangePassword = false;
  await user.save();
  console.log(`Updated password for Super Admin ${email}`);
}

resetSuperAdminPassword()
  .catch((error) => { console.error(`Super Admin password update failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());

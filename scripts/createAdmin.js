require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../model/User');

async function createOrPromoteAdmin() {
  const { MONGODB_URI, WMS_ADMIN_NAME, WMS_ADMIN_EMAIL, WMS_ADMIN_PASSWORD } = process.env;
  if (!MONGODB_URI || !WMS_ADMIN_NAME || !WMS_ADMIN_EMAIL || !WMS_ADMIN_PASSWORD) {
    throw new Error('Set MONGODB_URI, WMS_ADMIN_NAME, WMS_ADMIN_EMAIL, and WMS_ADMIN_PASSWORD');
  }
  if (WMS_ADMIN_PASSWORD.startsWith('replace_') || WMS_ADMIN_EMAIL.toLowerCase() === 'admin@example.com') {
    throw new Error('Replace the example admin email and password with real values before bootstrapping');
  }
  if (WMS_ADMIN_PASSWORD.length < 12) throw new Error('WMS_ADMIN_PASSWORD must be at least 12 characters');

  await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const email = WMS_ADMIN_EMAIL.trim().toLowerCase();
  const user = await User.findOne({ email }).select('_id').lean();
  if (user) {
    await User.updateOne({ _id: user._id }, { $set: { role: 'admin', clearance: ['admin'] } });
    console.log(`Promoted existing account ${email} to admin`);
    return;
  }

  await User.create({
    name: WMS_ADMIN_NAME.trim(),
    email,
    password: await bcrypt.hash(WMS_ADMIN_PASSWORD, 12),
    role: 'admin',
    clearance: ['admin'],
    status: 'off'
  });
  console.log(`Created admin account ${email}`);
}

createOrPromoteAdmin()
  .catch(error => {
    console.error(`Admin bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());

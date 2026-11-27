const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const gravatar = require('gravatar');
const validator = require('validator');
const mongoose = require('mongoose');
const User = require('../model/User');
const auth = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const AuditLog = require('../model/AuditLog');
const { normalizeRole } = require('../middleware/roleCompatibility');

const router = express.Router();

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    clearance: user.clearance,
    role: normalizeRole(user.role || 'staff'),
    phone: user.phone || '',
    accountStatus: user.accountStatus || 'active',
    registeredAt: user.date,
    lastLoginAt: user.lastLoginAt || null,
    mustChangePassword: Boolean(user.mustChangePassword)
  };
}

function issueToken(user) {
  return jwt.sign({ id: user._id }, process.env.SECRET_OR_KEY, { expiresIn: '7d' });
}

async function register(req, res) {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
    return res.status(400).json({ success: false, message: 'Name must be 2 to 80 characters' });
  }
  if (typeof email !== 'string' || !validator.isEmail(email)) {
    return res.status(400).json({ success: false, message: 'A valid email is required' });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ success: false, message: 'Password must be 8 to 128 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.create({
    name: name.trim(),
    email: normalizedEmail,
    password: await bcrypt.hash(password, 12),
    avatar: gravatar.url(normalizedEmail, { s: '200', r: 'r', d: 'mm' }),
    clearance: ['staff'],
    role: 'staff',
    accountStatus: 'active',
    status: 'on'
  });
  return res.status(201).json({ success: true, token: issueToken(user), user: publicUser(user) });
}

async function login(req, res) {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  if (!user || user.accountStatus === 'inactive' || user.accountStatus === 'deleted' || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  }
  if (mongoose.connection.readyState === 1) {
    user.lastLoginAt = new Date();
    await user.save();
    await AuditLog.create({ actor: user._id, targetUser: user._id, action: 'user.login' });
  }
  return res.status(200).json({ success: true, token: issueToken(user), user: publicUser(user) });
}

router.post('/register', asyncHandler(register));
router.post(['/login', '/'], asyncHandler(login));
router.get('/user', auth, asyncHandler(async (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
}));
router.post('/change-password', auth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
    return res.status(400).json({ success: false, message: 'Current password is required and new password must be 12 to 128 characters' });
  }
  const user = await User.findById(req.auth.id).select('+password');
  if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
    return res.status(400).json({ success: false, message: 'Current password is incorrect' });
  }
  user.password = await bcrypt.hash(newPassword, 12);
  user.mustChangePassword = false;
  await user.save();
  await AuditLog.create({ actor: user._id, targetUser: user._id, action: 'user.password-changed' });
  return res.json({ success: true, user: publicUser(user) });
}));
router.post('/logout', auth, asyncHandler(async (req, res) => {
  res.json({ success: true, message: 'JWT logout is complete when the client discards the token' });
}));

module.exports = router;
module.exports.register = register;

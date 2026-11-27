const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const UserSchema = new Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    select: false
  },
  avatar: {
    type: String
  },
  clearance: [
    {
      type: String
    }
  ],
  role: { type: String, enum: ['super_admin', 'superadmin', 'admin', 'staff'], default: 'staff', index: true },
  phone: { type: String, trim: true, default: '' },
  accountStatus: { type: String, enum: ['active', 'inactive', 'deleted'], default: 'active', index: true },
  emailVerificationStatus: { type: String, enum: ['pending', 'verified'], default: 'pending' },
  lastLoginAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  mustChangePassword: { type: Boolean, default: false },
  authVersion: { type: Number, default: 0, min: 0 },
  status: { type: String },
  date: {
    type: Date,
    default: Date.now
  }
});

UserSchema.set('toJSON', {
  transform(doc, result) {
    delete result.password;
    return result;
  }
});

module.exports = mongoose.model('users', UserSchema);

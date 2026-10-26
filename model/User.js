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
  role: { type: String, enum: ['admin', 'staff'], default: 'staff', index: true },
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

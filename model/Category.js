const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, trim: true, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('categories', CategorySchema);

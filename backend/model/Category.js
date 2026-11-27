const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const CategorySchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' }
  },
  { timestamps: true }
);
CategorySchema.index({ ownerId: 1, name: 1 }, { unique: true });
CategorySchema.index({ companyId: 1, name: 1 }, { unique: true, partialFilterExpression: { companyId: { $type: 'objectId' } } });
CategorySchema.plugin(ownershipPlugin);

module.exports = mongoose.model('categories', CategorySchema);

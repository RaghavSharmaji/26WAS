const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const WarehouseSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    address: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);
WarehouseSchema.index({ ownerId: 1, code: 1 }, { unique: true });
WarehouseSchema.index({ companyId: 1, code: 1 }, { unique: true, partialFilterExpression: { companyId: { $type: 'objectId' } } });
WarehouseSchema.options.tenantWarehouseField = '_id';
WarehouseSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('warehouses', WarehouseSchema);

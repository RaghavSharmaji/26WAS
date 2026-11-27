const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const PutawaySchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'warehouses', required: true, index: true },
  goodsReceiptId: { type: mongoose.Schema.Types.ObjectId, ref: 'goods_receipts', required: true, index: true },
  goodsReceiptLineId: { type: mongoose.Schema.Types.ObjectId, required: true },
  requestKey: { type: String, required: true, trim: true, maxlength: 128 },
  requestHash: { type: String, required: true, minlength: 64, maxlength: 64 },
  sourcePalletId: { type: mongoose.Schema.Types.ObjectId, ref: 'pallets', required: true },
  destinationPalletId: { type: mongoose.Schema.Types.ObjectId, ref: 'pallets', required: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'locations', required: true },
  locationName: { type: String, required: true, trim: true },
  skuNumber: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
  completedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

PutawaySchema.index({ companyId: 1, requestKey: 1 }, { unique: true, name: 'unique_putaway_request', partialFilterExpression: { companyId: { $type: 'objectId' } } });
PutawaySchema.index({ ownerId: 1, requestKey: 1 }, { unique: true, name: 'unique_legacy_putaway_request', partialFilterExpression: { companyId: null } });
PutawaySchema.options.tenantWarehouseField = 'warehouseId';
PutawaySchema.plugin(ownershipPlugin);

module.exports = mongoose.model('putaways', PutawaySchema);

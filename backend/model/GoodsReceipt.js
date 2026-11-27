const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const GoodsReceiptLineSchema = new mongoose.Schema({
  purchaseOrderLineId: { type: mongoose.Schema.Types.ObjectId, required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'items', required: true },
  skuNumber: { type: String, required: true, trim: true },
  productName: { type: String, required: true, trim: true },
  receivedQuantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
  acceptedQuantity: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  rejectedQuantity: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  damagedQuantity: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  incorrectQuantity: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  putawayQuantity: { type: Number, default: 0, min: 0, validate: Number.isInteger },
  inspectionReason: { type: String, trim: true, maxlength: 500, default: '' },
  inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users', default: null },
  inspectedAt: { type: Date, default: null },
  receiptPalletId: { type: mongoose.Schema.Types.ObjectId, ref: 'pallets', required: true }
});

const GoodsReceiptSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'warehouses', required: true, index: true },
  purchaseOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'purchase_orders', required: true, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'suppliers', required: true, index: true },
  reference: { type: String, required: true, trim: true },
  requestKey: { type: String, required: true, trim: true, maxlength: 128 },
  requestHash: { type: String, required: true, minlength: 64, maxlength: 64 },
  status: { type: String, enum: ['received', 'partially_inspected', 'inspected', 'partially_putaway', 'completed'], default: 'received', required: true },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
  receivedAt: { type: Date, required: true, default: Date.now },
  lines: { type: [GoodsReceiptLineSchema], required: true, validate: rows => rows.length > 0 },
  revision: { type: Number, min: 0, default: 0, required: true }
}, { timestamps: true });

GoodsReceiptSchema.index({ companyId: 1, reference: 1 }, { unique: true, partialFilterExpression: { companyId: { $type: 'objectId' } } });
GoodsReceiptSchema.index({ ownerId: 1, reference: 1 }, { unique: true, partialFilterExpression: { companyId: null } });
GoodsReceiptSchema.index({ companyId: 1, requestKey: 1 }, { unique: true, name: 'unique_grn_request', partialFilterExpression: { companyId: { $type: 'objectId' } } });
GoodsReceiptSchema.index({ ownerId: 1, requestKey: 1 }, { unique: true, name: 'unique_legacy_grn_request', partialFilterExpression: { companyId: null } });
GoodsReceiptSchema.options.tenantWarehouseField = 'warehouseId';
GoodsReceiptSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('goods_receipts', GoodsReceiptSchema);

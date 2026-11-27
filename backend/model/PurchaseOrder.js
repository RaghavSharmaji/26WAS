const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const PurchaseOrderLineSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'items', required: true },
  skuNumber: { type: String, required: true, trim: true },
  productName: { type: String, required: true, trim: true },
  orderedQuantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
  receivedQuantity: { type: Number, required: true, default: 0, min: 0, validate: Number.isInteger },
  unitCost: { type: Number, min: 0, default: 0 }
});

const PurchaseOrderSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'warehouses', required: true, index: true },
  supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'suppliers', required: true, index: true },
  reference: { type: String, required: true, trim: true },
  status: { type: String, enum: ['draft', 'submitted', 'partially_received', 'completed'], default: 'draft', required: true, index: true },
  lines: { type: [PurchaseOrderLineSchema], required: true, validate: rows => rows.length > 0 },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'users', default: null },
  submittedAt: { type: Date, default: null },
  revision: { type: Number, min: 0, default: 0, required: true }
}, { timestamps: true });

PurchaseOrderSchema.index({ companyId: 1, reference: 1 }, { unique: true, partialFilterExpression: { companyId: { $type: 'objectId' } } });
PurchaseOrderSchema.index({ ownerId: 1, reference: 1 }, { unique: true, partialFilterExpression: { companyId: null } });
PurchaseOrderSchema.options.tenantWarehouseField = 'warehouseId';
PurchaseOrderSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('purchase_orders', PurchaseOrderSchema);

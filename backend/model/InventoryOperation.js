const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const MovementResultSchema = new mongoose.Schema({
  palletId: { type: mongoose.Schema.Types.ObjectId, ref: 'pallets', required: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
  movementId: { type: mongoose.Schema.Types.ObjectId, required: true },
  stockBefore: { type: Number, required: true, min: 0 },
  stockAfter: { type: Number, required: true, min: 0 }
}, { _id: false });

const InventoryOperationSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  requestKey: { type: String, required: true, trim: true, maxlength: 128 },
  requestHash: { type: String, required: true, minlength: 64, maxlength: 64 },
  type: { type: String, enum: ['stock-out-batch', 'stock-in-adjustment', 'inventory-adjustment', 'order-reservation', 'order-dispatch'], required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'orders', default: null },
  skuNumber: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
  movements: { type: [MovementResultSchema], default: [] }
}, { timestamps: true });

InventoryOperationSchema.index(
  { companyId: 1, requestKey: 1 },
  {
    unique: true,
    name: 'unique_inventory_operation_request_company',
    partialFilterExpression: { companyId: { $type: 'objectId' } }
  }
);
InventoryOperationSchema.index(
  { ownerId: 1, requestKey: 1 },
  {
    unique: true,
    name: 'unique_inventory_operation_request_legacy',
    partialFilterExpression: { companyId: null }
  }
);
InventoryOperationSchema.plugin(ownershipPlugin);

module.exports = mongoose.model('inventory_operations', InventoryOperationSchema);

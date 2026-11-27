/* eslint-disable no-undef */
/* eslint-disable no-multi-assign */
const mongoose = require('mongoose');
const ownershipPlugin = require('../middleware/ownershipPlugin');

const { Schema } = mongoose;
const PALLET_STATUS_VALUES = Object.freeze(['receiving', 'received', 'r/p', 'store', 'picked', 'damaged']);

const StockMovementSchema = new Schema(
  {
    type: { type: String, enum: ['stock-in', 'stock-out', 'adjustment', 'receipt', 'quarantine', 'putaway', 'reserve', 'pick', 'release', 'dispatch'], required: true },
    quantity: { type: Number, required: true, min: 0, validate: Number.isInteger },
    delta: { type: Number, required: true },
    stockBefore: { type: Number, required: true, min: 0 },
    stockAfter: { type: Number, required: true, min: 0 },
    onHandBefore: { type: Number, min: 0 },
    onHandAfter: { type: Number, min: 0 },
    quarantinedBefore: { type: Number, min: 0 },
    quarantinedAfter: { type: Number, min: 0 },
    referenceType: { type: String, trim: true },
    referenceId: { type: Schema.Types.ObjectId },
    reason: { type: String, required: true, trim: true },
    responsibleUser: { type: Schema.Types.ObjectId, ref: 'users', default: null },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const PalletSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
  warehouseId: { type: Schema.Types.ObjectId, ref: 'warehouses', default: null, index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  item: { type: Schema.Types.ObjectId, ref: 'items' },
  size: {
    type: Number,
    required: true,
    min: 0
  },
  skuNumber: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: PALLET_STATUS_VALUES
  },
  location: {
    type: String
  },
  cont: {
    type: Number,
    required: true,
    min: 0,
    validate: Number.isInteger
  },
  contAvailable: {
    type: Number,
    min: 0,
    validate: Number.isInteger,
    default() { return this.cont; }
  },
  contQuarantined: { type: Number, min: 0, validate: Number.isInteger, default: 0 },
  contReserved: { type: Number, min: 0, validate: Number.isInteger, default: 0 },
  contPicked: { type: Number, min: 0, validate: Number.isInteger, default: 0 },
  ounce: {
    type: Number
  },
  department: {
    type: String
  },
  activate: [
    {
      note: { type: String },
      date: {
        type: Date,
        default: Date.now
      }
    }
  ],
  movementLog: { type: [StockMovementSchema], default: [] },
  date: {
    type: Date,
    default: Date.now()
  }
});

PalletSchema.index({ ownerId: 1, skuNumber: 1, location: 1 });
PalletSchema.index({ companyId: 1, warehouseId: 1, skuNumber: 1, location: 1 });
PalletSchema.pre('validate', function requireTenantWarehouse() {
  if (this.companyId && !this.warehouseId) this.invalidate('warehouseId', 'warehouseId is required for company inventory');
  if (Number(this.contAvailable || 0) + Number(this.contQuarantined || 0)
    + Number(this.contReserved || 0) + Number(this.contPicked || 0) > Number(this.cont || 0)) {
    this.invalidate('contAvailable', 'Available, quarantined, reserved and picked quantities cannot exceed on-hand quantity');
  }
});
PalletSchema.options.tenantWarehouseField = 'warehouseId';
PalletSchema.index({ 'movementLog.createdAt': -1 });
PalletSchema.plugin(ownershipPlugin);

const PalletModel = mongoose.model('pallets', PalletSchema);
PalletModel.STATUS_VALUES = PALLET_STATUS_VALUES;

module.exports = PalletModel;

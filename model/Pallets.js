/* eslint-disable no-undef */
/* eslint-disable no-multi-assign */
const mongoose = require('mongoose');

const { Schema } = mongoose;

const StockMovementSchema = new Schema(
  {
    type: { type: String, enum: ['stock-in', 'stock-out', 'adjustment'], required: true },
    quantity: { type: Number, required: true, min: 0, validate: Number.isInteger },
    delta: { type: Number, required: true },
    stockBefore: { type: Number, required: true, min: 0 },
    stockAfter: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true },
    responsibleUser: { type: Schema.Types.ObjectId, ref: 'users', default: null },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const PalletSchema = new Schema({
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
    type: String
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

PalletSchema.index({ skuNumber: 1, location: 1 });
PalletSchema.index({ 'movementLog.createdAt': -1 });

module.exports = mongoose.model('pallets', PalletSchema);

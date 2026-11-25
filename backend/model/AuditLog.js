const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'companies', default: null, index: true },
  warehouseId: { type: mongoose.Schema.Types.ObjectId, ref: 'warehouses', default: null, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'users', default: null, index: true },
  action: { type: String, required: true, index: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('audit_logs', AuditLogSchema);

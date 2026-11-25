const mongoose = require('mongoose');

const CompanyMembershipSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'companies', required: true, index: true },
  role: {
    type: String,
    enum: ['company_admin', 'warehouse_manager', 'inventory_manager', 'procurement_manager', 'warehouse_staff', 'staff', 'auditor'],
    required: true,
    default: 'warehouse_staff'
  },
  status: { type: String, enum: ['invited', 'active', 'inactive'], required: true, default: 'active', index: true },
  assignedWarehouseIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'warehouses' }]
}, { timestamps: true });

CompanyMembershipSchema.index({ companyId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('company_memberships', CompanyMembershipSchema);

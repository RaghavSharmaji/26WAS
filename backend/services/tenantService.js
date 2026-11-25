const mongoose = require('mongoose');
const Warehouse = require('../model/Warehouse');
const Location = require('../model/Location');
const { runWithAuth } = require('../middleware/requestContext');

async function resolveWarehouse(req, warehouseId, { required = true } = {}) {
  if (!req.tenant || !req.tenant.companyId) return null;
  if (!warehouseId) {
    if (!required) return null;
    throw Object.assign(new Error('warehouseId is required for this operation'), { status: 400 });
  }
  if (!mongoose.Types.ObjectId.isValid(warehouseId)) {
    throw Object.assign(new Error('Invalid warehouseId'), { status: 400 });
  }
  if (req.tenant.activeWarehouseId && String(req.tenant.activeWarehouseId) !== String(warehouseId)) {
    throw Object.assign(new Error('The requested warehouse does not match the selected warehouse context'), { status: 403 });
  }
  const warehouse = await runWithAuth({
    ...req.auth, ...req.tenant, role: req.auth.role, membershipRole: req.tenant.membershipRole
  }, async () => Warehouse.findOne({ _id: warehouseId, companyId: req.tenant.companyId })
    .select('_id companyId active').lean().exec());
  if (!warehouse) throw Object.assign(new Error('Warehouse not found in the active company or not assigned to you'), { status: 404 });
  if (warehouse.active === false) throw Object.assign(new Error('Warehouse is inactive'), { status: 409 });
  return warehouse;
}

async function resolveLocation(req, locationName, warehouseId) {
  if (!req.tenant || !req.tenant.companyId || !locationName) return null;
  const location = await Location.findOne({ fullName: locationName, warehouse: warehouseId }).select('_id').lean();
  if (!location) throw Object.assign(new Error('Location not found in the selected warehouse'), { status: 404 });
  return location;
}

module.exports = { resolveWarehouse, resolveLocation };

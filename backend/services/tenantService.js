const mongoose = require('mongoose');
const Warehouse = require('../model/Warehouse');
const Location = require('../model/Location');
const Pallet = require('../model/Pallets');
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

async function resolvePalletLocation(req, pallet, locationName) {
  if (!locationName) return null;
  const warehouseId = pallet && pallet.warehouseId ? String(pallet.warehouseId) : null;
  if (req.tenant && req.tenant.companyId) {
    if (!warehouseId) throw Object.assign(new Error('Pallet has no warehouse assignment'), { status: 409 });
    await resolveWarehouse(req, warehouseId);
  }
  const location = await Location.findOne({
    fullName: locationName,
    ...(warehouseId ? { warehouse: warehouseId } : {})
  }).select('_id warehouse fullName status').lean();
  if (!location) throw Object.assign(new Error('Location is not in the pallet warehouse'), { status: 404 });
  if (warehouseId && String(location.warehouse || '') !== warehouseId) {
    throw Object.assign(new Error('Pallets can only be relocated within their assigned warehouse'), { status: 403 });
  }
  if (!warehouseId && location.warehouse) {
    throw Object.assign(new Error('Pallet warehouse assignment does not match the destination location'), { status: 403 });
  }
  return location;
}

async function movePallet(req, palletId, locationName, { requireReceived = false, findAvailable = false, status } = {}) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const pallet = await Pallet.findOne({ _id: palletId }).session(session);
      if (!pallet) throw Object.assign(new Error('Pallet not found'), { status: 404 });
      if (requireReceived && pallet.status !== 'received') throw Object.assign(new Error(`Pallet must be received before putaway (current: ${pallet.status})`), { status: 409 });
      const warehouseId = pallet.warehouseId ? String(pallet.warehouseId) : null;
      if (req.tenant?.companyId) {
        if (!warehouseId) throw Object.assign(new Error('Pallet has no warehouse assignment'), { status: 409 });
        await resolveWarehouse(req, warehouseId);
      }
      let destination;
      const criteria = {
        ...(locationName ? { fullName: locationName } : {}),
        ...(warehouseId ? { warehouse: warehouseId } : {})
      };
      if (findAvailable) {
        criteria.status = 'empty';
        criteria.maxSize = { $gte: pallet.size };
      }
      destination = await Location.findOne(criteria).session(session);
      if (!destination) throw Object.assign(new Error(findAvailable ? 'No suitable location in the pallet warehouse' : 'Location not found in the pallet warehouse'), { status: 404 });
      if (warehouseId && String(destination.warehouse || '') !== warehouseId) throw Object.assign(new Error('Pallets can only be moved within their assigned warehouse'), { status: 403 });
      if (!warehouseId && destination.warehouse) throw Object.assign(new Error('Pallet warehouse does not match destination location'), { status: 403 });
      if (['maintenance', 'upcoming'].includes(destination.status)) throw Object.assign(new Error('Location is not available for pallet placement'), { status: 409 });
      if (destination.skuNumber && destination.skuNumber !== pallet.skuNumber) throw Object.assign(new Error(`mix sku not permitted (${pallet.skuNumber} - ${destination.skuNumber})`), { status: 409 });
      if (Number(destination.size || 0) + Number(pallet.size || 0) > Number(destination.maxSize || 0)) throw Object.assign(new Error('Pallet exceeds destination capacity'), { status: 409 });
      const source = pallet.location ? await Location.findOne({ fullName: pallet.location, ...(warehouseId ? { warehouse: warehouseId } : {}) }).session(session) : null;
      if (pallet.location && !source) throw Object.assign(new Error('Current pallet location is missing or outside its warehouse'), { status: 409 });
      if (source && (!(source.palletId || []).some(id => String(id) === String(pallet._id))
        || Number(source.size || 0) < Number(pallet.size || 0))) {
        throw Object.assign(new Error('Current pallet and location occupancy are inconsistent; relocation was stopped'), { status: 409 });
      }
      if (source && String(source._id) === String(destination._id)) {
        if (requireReceived) pallet.status = 'r/p';
        if (status) pallet.status = status;
        await pallet.save({ session });
        result = { pallet, location: destination };
        return;
      }
      if (source) {
        source.size = Math.max(0, Number(source.size || 0) - Number(pallet.size || 0));
        source.palletId = (source.palletId || []).filter(id => String(id) !== String(pallet._id));
        if (!source.palletId.length) {
          source.skuNumber = null;
          source.status = 'empty';
        }
        await source.save({ session });
      }
      destination.size = Number(destination.size || 0) + Number(pallet.size || 0);
      destination.skuNumber = pallet.skuNumber;
      destination.department = pallet.department;
      destination.status = 'occupied';
      if (!(destination.palletId || []).some(id => String(id) === String(pallet._id))) destination.palletId.push(pallet._id);
      pallet.location = destination.fullName;
      if (requireReceived) {
        pallet.status = 'r/p';
        pallet.date = Date.now();
      }
      if (status) pallet.status = status;
      await destination.save({ session });
      await pallet.save({ session });
      result = { pallet, location: destination };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { resolveWarehouse, resolveLocation, resolvePalletLocation, movePallet };

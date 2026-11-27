const Pallet = require('../model/Pallets');
const Location = require('../model/Location');
const Warehouse = require('../model/Warehouse');
const createCrudRouter = require('./crudFactory');
const validators = require('../validators/records');

module.exports = createCrudRouter({
  Model: Location,
  writeRoles: ['company_admin', 'warehouse_manager'],
  validate: validators.location,
  beforeCreate: async data => {
    if (data.status === 'occupied') {
      const error = new Error('Use pallet movement operations to occupy a location');
      error.status = 409;
      error.code = 'LOCATION_OCCUPANCY_REQUIRES_MOVEMENT';
      throw error;
    }
  },
  beforeSave: async data => {
    if (data.warehouse && !await Warehouse.exists({ _id: data.warehouse })) {
      const error = new Error('Warehouse not found');
      error.status = 404;
      throw error;
    }
  },
  beforeUpdate: async (data, current) => {
    if (data.status !== undefined && data.status !== current.status) {
      const occupied = Number(current.size || 0) > 0 || (current.palletId || []).length > 0;
      if (occupied || ['occupied', 'empty'].includes(data.status)) {
        const error = new Error('Location occupancy status is maintained by pallet movement operations');
        error.status = 409;
        error.code = 'LOCATION_OCCUPANCY_REQUIRES_MOVEMENT';
        throw error;
      }
    }
    if (data.maxSize !== undefined && data.maxSize < Number(current.size || 0)) {
      const error = new Error('maxSize cannot be less than current occupied size');
      error.status = 409;
      throw error;
    }
  },
  beforeDelete: location => Pallet.exists({ location: location.fullName })
});

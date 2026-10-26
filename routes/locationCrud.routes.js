const Pallet = require('../model/Pallets');
const Location = require('../model/Location');
const Warehouse = require('../model/Warehouse');
const createCrudRouter = require('./crudFactory');
const validators = require('../validators/records');

module.exports = createCrudRouter({
  Model: Location,
  validate: validators.location,
  beforeSave: async data => {
    if (data.warehouse && !await Warehouse.exists({ _id: data.warehouse })) {
      const error = new Error('Warehouse not found');
      error.status = 404;
      throw error;
    }
  },
  beforeDelete: location => Pallet.exists({ location: location.fullName })
});

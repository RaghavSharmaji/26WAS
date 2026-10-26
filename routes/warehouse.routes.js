const Location = require('../model/Location');
const Warehouse = require('../model/Warehouse');
const createCrudRouter = require('./crudFactory');
const validators = require('../validators/records');

module.exports = createCrudRouter({
  Model: Warehouse,
  validate: validators.warehouse,
  beforeDelete: warehouse => Location.exists({ warehouse: warehouse._id })
});

const Item = require('../model/Item');
const Supplier = require('../model/Supplier');
const createCrudRouter = require('./crudFactory');
const validators = require('../validators/records');

module.exports = createCrudRouter({
  Model: Supplier,
  writeRoles: ['company_admin'],
  validate: validators.supplier,
  beforeDelete: supplier => Item.exists({ suppliers: supplier._id })
});

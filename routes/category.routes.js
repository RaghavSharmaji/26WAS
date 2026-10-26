const Item = require('../model/Item');
const Category = require('../model/Category');
const createCrudRouter = require('./crudFactory');
const validators = require('../validators/records');

module.exports = createCrudRouter({
  Model: Category,
  validate: validators.category,
  beforeDelete: category => Item.exists({ category: category._id })
});

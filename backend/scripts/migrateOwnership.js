require('dotenv').config();
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);
const User = require('../model/User');
const models = [
  require('../model/Item'), require('../model/Product'), require('../model/Pallets'),
  require('../model/Order'), require('../model/Ticket'), require('../model/Category'),
  require('../model/Supplier'), require('../model/Warehouse'), require('../model/Location')
];

async function migrateOwnership() {
  const ownerEmail = (process.env.LEGACY_DATA_OWNER_EMAIL || '').trim().toLowerCase();
  if (!process.env.MONGODB_URI || !ownerEmail) {
    throw new Error('Set MONGODB_URI and LEGACY_DATA_OWNER_EMAIL to an existing normal WMS user in backend/.env before migrating.');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const owner = await User.findOne({ email: ownerEmail, role: { $ne: 'superadmin' }, accountStatus: { $ne: 'deleted' } }).select('_id email').lean();
  if (!owner) throw new Error('LEGACY_DATA_OWNER_EMAIL must match an existing non-Super-Admin WMS user.');

  const summary = [];
  for (const Model of models) {
    const result = await Model.updateMany(
      { $or: [{ ownerId: { $exists: false } }, { ownerId: null }] },
      { $set: { ownerId: owner._id } }
    );
    summary.push({ model: Model.modelName, migrated: result.modifiedCount || 0 });
  }

  const oldGlobalIndexes = new Map([
    ['items', ['skuNumber_1']], ['categories', ['name_1']], ['suppliers', ['email_1']],
    ['warehouses', ['code_1']], ['locations', ['fullName_1']]
  ]);
  for (const Model of models) {
    const existingIndexes = await Model.collection.indexes().catch(() => []);
    const obsolete = oldGlobalIndexes.get(Model.collection.name) || [];
    for (const indexName of obsolete) {
      if (existingIndexes.some((index) => index.name === indexName)) {
        await Model.collection.dropIndex(indexName);
      }
    }
    await Model.createIndexes();
  }

  console.log(`Assigned unowned legacy records to the selected account (${summary.reduce((sum, row) => sum + row.migrated, 0)} records).`);
  summary.forEach((row) => console.log(`${row.model}: ${row.migrated}`));
}

migrateOwnership()
  .catch((error) => { console.error(`Ownership migration failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());

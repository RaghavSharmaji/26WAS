require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const User = require('../model/User');

const TENANT_COLLECTIONS = [
  { name: 'items', warehouseField: null },
  { name: 'products', warehouseField: 'warehouseId' },
  { name: 'categories', warehouseField: null },
  { name: 'suppliers', warehouseField: null },
  { name: 'warehouses', warehouseField: null },
  { name: 'locations', warehouseField: 'warehouse' },
  { name: 'pallets', warehouseField: 'warehouseId' },
  { name: 'orders', warehouseField: 'warehouseId' },
  { name: 'tickets', warehouseField: 'warehouseId' }
];
const COMPANY_UNIQUE_KEYS = {
  items: ['skuNumber'],
  categories: ['name'],
  suppliers: ['email'],
  warehouses: ['code'],
  locations: ['warehouse', 'fullName']
};
const CONFIRMATION = 'I_HAVE_VERIFIED_A_BACKUP';

function objectId(value, label) {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new Error(`${label} must be a valid MongoDB ObjectId`);
  return new mongoose.Types.ObjectId(value);
}

function loadMapping() {
  const configuredPath = process.env.COMPANY_MIGRATION_MAP;
  if (!configuredPath) throw new Error('Set COMPANY_MIGRATION_MAP to a reviewed JSON mapping file; no migration file is bundled.');
  const mappingPath = path.resolve(process.cwd(), configuredPath);
  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  if (!Array.isArray(mapping.companies) || !Array.isArray(mapping.users)) {
    throw new Error('Mapping file must contain companies[] and users[] arrays.');
  }
  return mapping;
}

function validateMapping(mapping) {
  const companyIds = new Set();
  const companySlugs = new Set();
  const companyById = new Map();
  mapping.companies.forEach((company, index) => {
    company._id = objectId(company.id, `companies[${index}].id`);
    if (!company.name || !company.slug) throw new Error(`companies[${index}] requires name and slug`);
    company.slug = String(company.slug).trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(company.slug)) throw new Error(`companies[${index}].slug is invalid`);
    if (companySlugs.has(company.slug)) throw new Error(`Duplicate company slug ${company.slug} in mapping`);
    const id = String(company._id);
    if (companyIds.has(id)) throw new Error(`Duplicate company id ${id} in mapping`);
    companyIds.add(id);
    companySlugs.add(company.slug);
    companyById.set(id, company);
  });
  const userMap = new Map();
  mapping.users.forEach((row, index) => {
    row.userObjectId = objectId(row.userId, `users[${index}].userId`);
    row.companyObjectId = objectId(row.companyId, `users[${index}].companyId`);
    if (!companyIds.has(String(row.companyObjectId))) throw new Error(`users[${index}] references a company not declared in companies[]`);
    if (userMap.has(String(row.userObjectId))) throw new Error(`User ${row.userId} maps to more than one company; use a reviewed manual migration for multi-company legacy ownership`);
    if (!['company_admin', 'warehouse_manager', 'staff', 'auditor'].includes(row.role)) throw new Error(`users[${index}].role must be explicitly set to a permitted company role`);
    row.assignedWarehouseIds = row.assignedWarehouseIds || [];
    if (!Array.isArray(row.assignedWarehouseIds)) throw new Error(`users[${index}].assignedWarehouseIds must be an array`);
    row.assignedWarehouseIds = row.assignedWarehouseIds.map((id, warehouseIndex) => objectId(id, `users[${index}].assignedWarehouseIds[${warehouseIndex}]`));
    userMap.set(String(row.userObjectId), row);
  });
  const explicitWarehouseRows = new Map();
  (mapping.warehouseAssignments || []).forEach((row, index) => {
    if (!['products', 'locations', 'pallets', 'orders', 'tickets'].includes(row.collection)) {
      throw new Error(`warehouseAssignments[${index}].collection is unsupported`);
    }
    row.recordObjectId = objectId(row.recordId, `warehouseAssignments[${index}].recordId`);
    row.warehouseObjectId = objectId(row.warehouseId, `warehouseAssignments[${index}].warehouseId`);
    const key = `${row.collection}:${row.recordObjectId}`;
    if (explicitWarehouseRows.has(key)) throw new Error(`Duplicate warehouse mapping for ${key}`);
    explicitWarehouseRows.set(key, row.warehouseObjectId);
  });
  return { userMap, companyById, explicitWarehouseRows };
}

async function makeReport(mapping, indexes) {
  const { userMap, explicitWarehouseRows } = indexes;
  const db = mongoose.connection.db;
  const report = { mode: process.argv.includes('--apply') ? 'apply-preflight' : 'dry-run', collections: [], unmappedUsers: [], unmappedWarehouses: [], existingConflicts: [], duplicateKeys: [], warehouseAssignmentsPlanned: [] };
  const usedExplicitWarehouseRows = new Set();
  for (const config of TENANT_COLLECTIONS) {
    const collection = db.collection(config.name);
    const ownerless = await collection.countDocuments({ $or: [{ ownerId: { $exists: false } }, { ownerId: null }] });
    if (ownerless) report.unmappedUsers.push({ collection: config.name, ownerId: null, records: ownerless });
    const grouped = await collection.aggregate([
      { $match: { ownerId: { $exists: true, $ne: null } } },
      { $group: { _id: '$ownerId', total: { $sum: 1 }, missingCompany: { $sum: { $cond: [{ $in: [{ $ifNull: ['$companyId', null] }, [null]] }, 1, 0] } } } }
    ]).toArray();
    let missingCompany = 0;
    let alreadyScoped = 0;
    let warehouseNeedsMapping = 0;
    for (const group of grouped) {
      const mappingRow = userMap.get(String(group._id));
      if (!mappingRow) {
        report.unmappedUsers.push({ collection: config.name, userId: String(group._id), records: group.total });
        continue;
      }
      const mismatched = await collection.countDocuments({ ownerId: group._id, companyId: { $type: 'objectId', $ne: mappingRow.companyObjectId } });
      if (mismatched) report.existingConflicts.push({ collection: config.name, ownerId: String(group._id), records: mismatched, issue: 'existing companyId conflicts with explicit user mapping' });
      missingCompany += group.missingCompany;
      alreadyScoped += group.total - group.missingCompany;
      if (config.warehouseField) {
        const docs = await collection.find({ ownerId: group._id, companyId: { $in: [null] } }).project({ _id: 1, [config.warehouseField]: 1, location: 1 }).toArray();
        const locations = config.name === 'pallets' || config.name === 'products'
          ? await db.collection('locations').find({ ownerId: group._id }).project({ fullName: 1, warehouse: 1 }).toArray()
          : [];
        for (const doc of docs) {
          let warehouseId = doc[config.warehouseField];
          if (!warehouseId && ['pallets', 'products'].includes(config.name) && doc.location) {
            const candidates = locations.filter(location => location.fullName === doc.location && location.warehouse);
            if (candidates.length === 1) warehouseId = candidates[0].warehouse;
          }
          if (!warehouseId) {
            const explicitKey = `${config.name}:${doc._id}`;
            warehouseId = explicitWarehouseRows.get(explicitKey);
            if (warehouseId) usedExplicitWarehouseRows.add(explicitKey);
          }
          if (warehouseId) {
            const warehouse = await db.collection('warehouses').findOne({ _id: warehouseId });
            const warehouseOwnerMapping = warehouse && userMap.get(String(warehouse.ownerId));
            if (!warehouse || !warehouseOwnerMapping || String(warehouseOwnerMapping.companyObjectId) !== String(mappingRow.companyObjectId)) {
              report.existingConflicts.push({ collection: config.name, recordId: String(doc._id), issue: 'warehouse does not map to the same company' });
              continue;
            }
            if (!doc[config.warehouseField]) {
              report.warehouseAssignmentsPlanned.push({ collection: config.name, recordId: String(doc._id), field: config.warehouseField, warehouseId: String(warehouseId) });
            }
          } else {
            report.unmappedWarehouses.push({ collection: config.name, recordId: String(doc._id), ownerId: String(group._id) });
            warehouseNeedsMapping += 1;
          }
        }
      }
    }
    report.collections.push({ name: config.name, ownerGroups: grouped.length, missingCompany, alreadyScoped, warehouseNeedsMapping });
  }
  for (const [key] of explicitWarehouseRows.entries()) {
    if (usedExplicitWarehouseRows.has(key)) continue;
    const [collectionName, recordId] = key.split(':');
    const record = await db.collection(collectionName).findOne({ _id: new mongoose.Types.ObjectId(recordId) });
    const ownerMapping = record && userMap.get(String(record.ownerId));
    if (!record || !ownerMapping) {
      report.existingConflicts.push({ record: key, issue: 'warehouse mapping did not match a record with a mapped owner' });
      continue;
    }
    const warehouseField = TENANT_COLLECTIONS.find(row => row.name === collectionName).warehouseField;
    const targetWarehouseId = explicitWarehouseRows.get(key);
    if (String(record.companyId || '') !== String(ownerMapping.companyObjectId)
      || String(record[warehouseField] || '') !== String(targetWarehouseId)) {
      report.existingConflicts.push({ record: key, issue: 'existing company or warehouse assignment conflicts with the explicit mapping' });
    }
  }
  for (const member of mapping.users) {
    if (!await User.exists({ _id: member.userObjectId })) report.existingConflicts.push({ userId: String(member.userObjectId), issue: 'mapped user does not exist' });
    for (const warehouseId of member.assignedWarehouseIds) {
      const warehouse = await db.collection('warehouses').findOne({ _id: warehouseId });
      const ownerMembership = warehouse && userMap.get(String(warehouse.ownerId));
      if (!warehouse || !ownerMembership || String(ownerMembership.companyObjectId) !== String(member.companyObjectId)) {
        report.existingConflicts.push({ userId: String(member.userObjectId), warehouseId: String(warehouseId), issue: 'assigned warehouse does not map to this company' });
      }
    }
  }
  for (const [companyId, company] of indexes.companyById.entries()) {
    const userIds = [...userMap.entries()].filter(([, member]) => String(member.companyObjectId) === companyId).map(([userId]) => new mongoose.Types.ObjectId(userId));
    for (const [collectionName, fields] of Object.entries(COMPANY_UNIQUE_KEYS)) {
      const match = { $and: [
        { companyId: { $in: [null, new mongoose.Types.ObjectId(companyId)] } },
        { $or: [{ ownerId: { $in: userIds } }, { companyId: new mongoose.Types.ObjectId(companyId) }] }
      ] };
      if (collectionName === 'suppliers') match.$and.push({ email: { $type: 'string' } });
      const key = Object.fromEntries(fields.map(field => [field, `$${field}`]));
      const duplicates = await db.collection(collectionName).aggregate([
        { $match: match },
        { $group: { _id: key, count: { $sum: 1 }, recordIds: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 100 }
      ]).toArray();
      duplicates.forEach(row => report.duplicateKeys.push({ companyId, companyName: company.name, collection: collectionName, key: row._id, count: row.count, recordIds: row.recordIds }));
    }
  }
  report.readyToApply = report.unmappedUsers.length === 0 && report.unmappedWarehouses.length === 0
    && report.existingConflicts.length === 0 && report.duplicateKeys.length === 0;
  report.notes = [
    'Dry-run performs reads only. ownerId is preserved.',
    'Unmapped rows, warehouse assignments, and duplicate company keys must be resolved before apply.',
    'Company and membership creation plus companyId backfill are transactional; no records are deleted.'
  ];
  return report;
}

async function applyMapping(mapping, indexes, report) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const company of mapping.companies) {
        await Company.updateOne(
          { _id: company._id },
          { $setOnInsert: {
            name: company.name, slug: company.slug, legalBusinessName: company.legalBusinessName || '',
            email: company.email || '', phone: company.phone || '', address: company.address || '',
            logo: company.logo || '', industry: company.industry || '', status: company.status || 'pending'
          } },
          { upsert: true, session, runValidators: true }
        );
      }
      for (const member of mapping.users) {
        await CompanyMembership.updateOne(
          { companyId: member.companyObjectId, userId: member.userObjectId },
          { $setOnInsert: { role: member.role, status: 'active', assignedWarehouseIds: member.assignedWarehouseIds } },
          { upsert: true, session }
        );
      }
      for (const { name } of TENANT_COLLECTIONS) {
        const collection = mongoose.connection.db.collection(name);
        for (const [userId, member] of indexes.userMap.entries()) {
          await collection.updateMany(
            { ownerId: new mongoose.Types.ObjectId(userId), companyId: { $in: [null] } },
            { $set: { companyId: member.companyObjectId } },
            { session }
          );
        }
      }
      for (const assignment of report.warehouseAssignmentsPlanned) {
        await mongoose.connection.db.collection(assignment.collection).updateOne(
          { _id: new mongoose.Types.ObjectId(assignment.recordId) },
          { $set: { [assignment.field]: new mongoose.Types.ObjectId(assignment.warehouseId) } },
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  const mapping = loadMapping();
  const indexes = validateMapping(mapping);
  await mongoose.connect(process.env.MONGODB_URI);
  const report = await makeReport(mapping, indexes);
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--apply')) {
    if (process.argv.includes('--confirm') && process.argv[process.argv.indexOf('--confirm') + 1] !== CONFIRMATION) {
      throw new Error(`Confirmation phrase must be: ${CONFIRMATION}`);
    }
    if (!process.argv.includes('--confirm')) throw new Error(`Apply requires --confirm ${CONFIRMATION}`);
    if (!report.readyToApply) throw new Error('Preflight found unresolved mappings or conflicts; no changes were written.');
    await applyMapping(mapping, indexes, report);
    console.log('Company migration applied. Verify database counts against the preflight report before changing application rollout state.');
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Company migration stopped: ${error.message}`);
    process.exitCode = 1;
  }).finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
}

module.exports = { validateMapping, makeReport, applyMapping, TENANT_COLLECTIONS, COMPANY_UNIQUE_KEYS, CONFIRMATION };

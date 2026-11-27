require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const User = require('../model/User');
const { isSuperAdminRole } = require('../middleware/roleCompatibility');
const { acquireMigrationWriteFreeze, releaseMigrationWriteFreeze } = require('../middleware/migrationWriteFreeze');

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
const WRITE_FREEZE_CONFIRMATION = 'I_HAVE_FROZEN_APPLICATION_WRITES';
// Keep this migration atomic and bounded. Larger datasets require a reviewed,
// checkpointed migration design and must not be partially applied here.
const MAX_ATOMIC_WRITES = 1000;
const MAX_PREFLIGHT_RECORDS = 10000;
const MAX_PREFLIGHT_OWNER_GROUPS = 1000;
const MAX_PREFLIGHT_COMPANY_ADMINS = 1000;

function objectId(value, label) {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new Error(`${label} must be a valid MongoDB ObjectId`);
  return new mongoose.Types.ObjectId(value);
}

function assertExactWriteCount(result, expectedCount, label) {
  if (!result || result.matchedCount !== expectedCount || result.modifiedCount !== expectedCount) {
    throw new Error(`${label} matched/modified count mismatch; transaction aborted.`);
  }
}

function isActiveNonDeletedUser(user) {
  return Boolean(user && user.accountStatus === 'active'
    && (user.deletedAt === null || user.deletedAt === undefined));
}

function isVerifiedCompanyAdminMembership(membership, user) {
  return Boolean(membership && membership.role === 'company_admin' && membership.status === 'active'
    && membership.userId && isActiveNonDeletedUser(user) && !isSuperAdminRole(user.role));
}

async function getVerifiedActiveCompanyAdminIds(companyId, { session } = {}) {
  const query = CompanyMembership.find({
    companyId: new mongoose.Types.ObjectId(companyId), role: 'company_admin', status: 'active'
  }).select('userId role status').sort({ userId: 1 }).limit(MAX_PREFLIGHT_COMPANY_ADMINS + 1);
  if (session) query.session(session);
  const memberships = await query.lean();
  if (memberships.length > MAX_PREFLIGHT_COMPANY_ADMINS) {
    throw new Error(`Company Admin verification exceeded the ${MAX_PREFLIGHT_COMPANY_ADMINS} membership limit for company ${companyId}.`);
  }

  const verifiedIds = [];
  for (const membership of memberships) {
    if (!membership?.userId || membership.role !== 'company_admin' || membership.status !== 'active') continue;
    const userQuery = User.findById(membership.userId).select('_id role accountStatus deletedAt');
    if (session) userQuery.session(session);
    const user = await userQuery.lean();
    if (isVerifiedCompanyAdminMembership(membership, user)) verifiedIds.push(String(membership.userId));
  }
  return [...new Set(verifiedIds)].sort();
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
    if (!['company_admin', 'warehouse_manager', 'inventory_manager', 'procurement_manager', 'warehouse_staff', 'staff', 'auditor'].includes(row.role)) throw new Error(`users[${index}].role must be explicitly set to a permitted company role`);
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
  if (mapping.companies.length + mapping.users.length + explicitWarehouseRows.size > MAX_ATOMIC_WRITES) {
    throw new Error(`Mapping exceeds the safe preflight limit of ${MAX_ATOMIC_WRITES} company, user, and warehouse rows.`);
  }
  return { userMap, companyById, explicitWarehouseRows };
}

async function makeReport(mapping, indexes, { session } = {}) {
  const { userMap, explicitWarehouseRows } = indexes;
  const db = mongoose.connection.db;
  const report = { mode: process.argv.includes('--apply') ? 'apply-preflight' : 'dry-run', collections: [], unmappedUsers: [], unmappedWarehouses: [], existingConflicts: [], duplicateKeys: [], warehouseAssignmentsPlanned: [], expectedMissingCompanyByOwner: {} };
  const usedExplicitWarehouseRows = new Set();
  const mappedUserState = new Map();
  for (const [companyId, company] of indexes.companyById.entries()) {
    const byId = await db.collection('companies').findOne({ _id: new mongoose.Types.ObjectId(companyId) }, { session });
    const bySlug = await db.collection('companies').findOne({ slug: company.slug }, { session });
    if (byId && (byId.name !== company.name || String(byId.slug || '').toLowerCase() !== company.slug)) {
      report.existingConflicts.push({ companyId, issue: 'company ID already exists with different name or slug' });
    }
    if (bySlug && String(bySlug._id) !== companyId) {
      report.existingConflicts.push({ companyId, slug: company.slug, existingCompanyId: String(bySlug._id), issue: 'company slug already belongs to a different ID' });
    }
  }
  for (const config of TENANT_COLLECTIONS) {
    const collection = db.collection(config.name);
    const ownerless = await collection.countDocuments({ $or: [{ ownerId: { $exists: false } }, { ownerId: null }] }, { session });
    if (ownerless) report.unmappedUsers.push({ collection: config.name, ownerId: null, records: ownerless });
    const malformedOwners = await collection.countDocuments({ ownerId: { $exists: true, $ne: null, $not: { $type: 'objectId' } } }, { session });
    if (malformedOwners) report.existingConflicts.push({ collection: config.name, records: malformedOwners, issue: 'non-null ownerId value is not an ObjectId and cannot be safely mapped' });
    const malformedCompanyIds = await collection.countDocuments({
      companyId: { $exists: true, $ne: null, $not: { $type: 'objectId' } }
    }, { session });
    if (malformedCompanyIds) report.existingConflicts.push({
      collection: config.name, records: malformedCompanyIds, issue: 'non-null companyId value is not an ObjectId'
    });
    const ownerRecordCount = await collection.countDocuments({ ownerId: { $exists: true, $ne: null } }, { session });
    if (ownerRecordCount > MAX_PREFLIGHT_RECORDS) {
      report.existingConflicts.push({ collection: config.name, records: ownerRecordCount, issue: `preflight safety limit exceeded (${MAX_PREFLIGHT_RECORDS} owner records); use a separately reviewed checkpointed migration on restored staging data` });
      report.collections.push({ name: config.name, ownerGroups: null, ownerRecordCount, missingCompany: null, alreadyScoped: null, warehouseNeedsMapping: null, skipped: true });
      continue;
    }
    const groupedQuery = collection.aggregate([
      { $match: { ownerId: { $exists: true, $ne: null } } },
      { $group: { _id: '$ownerId', total: { $sum: 1 }, missingCompany: { $sum: { $cond: [{ $in: [{ $ifNull: ['$companyId', null] }, [null]] }, 1, 0] } } } },
      { $limit: MAX_PREFLIGHT_OWNER_GROUPS + 1 }
    ]);
    const grouped = session ? await groupedQuery.session(session).toArray() : await groupedQuery.toArray();
    if (grouped.length > MAX_PREFLIGHT_OWNER_GROUPS) {
      report.existingConflicts.push({ collection: config.name, issue: `preflight safety limit exceeded (${MAX_PREFLIGHT_OWNER_GROUPS} owner groups); use a separately reviewed checkpointed migration on restored staging data` });
      report.collections.push({ name: config.name, ownerGroups: null, ownerRecordCount, missingCompany: null, alreadyScoped: null, warehouseNeedsMapping: null, skipped: true });
      continue;
    }
    let missingCompany = 0;
    let alreadyScoped = 0;
    let warehouseNeedsMapping = 0;
    for (const group of grouped) {
      const mappingRow = userMap.get(String(group._id));
      if (!mappingRow) {
        report.unmappedUsers.push({ collection: config.name, userId: String(group._id), records: group.total });
        continue;
      }
      const mismatched = await collection.countDocuments({ ownerId: group._id, companyId: { $type: 'objectId', $ne: mappingRow.companyObjectId } }, { session });
      if (mismatched) report.existingConflicts.push({ collection: config.name, ownerId: String(group._id), records: mismatched, issue: 'existing companyId conflicts with explicit user mapping' });
      missingCompany += group.missingCompany;
      report.expectedMissingCompanyByOwner[`${config.name}:${group._id}`] = group.missingCompany;
      alreadyScoped += group.total - group.missingCompany;
      if (config.warehouseField) {
        const docs = await collection.find({ ownerId: group._id }, { session }).project({ _id: 1, companyId: 1, [config.warehouseField]: 1, location: 1 }).limit(MAX_PREFLIGHT_RECORDS + 1).toArray();
        if (docs.length > MAX_PREFLIGHT_RECORDS) {
          report.existingConflicts.push({ collection: config.name, ownerId: String(group._id), issue: `warehouse preflight safety limit exceeded (${MAX_PREFLIGHT_RECORDS} records)` });
          continue;
        }
        for (const doc of docs) {
          if (doc.companyId && String(doc.companyId) !== String(mappingRow.companyObjectId)) continue;
          let warehouseId = doc[config.warehouseField];
          if (!warehouseId && ['pallets', 'products'].includes(config.name) && doc.location) {
            const candidates = await db.collection('locations').find({ ownerId: group._id, fullName: doc.location, warehouse: { $exists: true, $ne: null } }, { session })
              .project({ fullName: 1, warehouse: 1 }).limit(2).toArray();
            if (candidates.length === 1) warehouseId = candidates[0].warehouse;
            else if (candidates.length > 1) report.existingConflicts.push({ collection: config.name, recordId: String(doc._id), issue: 'location name is ambiguous for warehouse inference' });
          }
          if (!warehouseId) {
            const explicitKey = `${config.name}:${doc._id}`;
            warehouseId = explicitWarehouseRows.get(explicitKey);
            if (warehouseId) usedExplicitWarehouseRows.add(explicitKey);
          }
          if (warehouseId) {
            if (!mongoose.Types.ObjectId.isValid(String(warehouseId))) {
              report.existingConflicts.push({ collection: config.name, recordId: String(doc._id), issue: 'warehouse assignment is not a valid ObjectId' });
              continue;
            }
            const warehouse = await db.collection('warehouses').findOne({ _id: warehouseId }, { session });
            const warehouseOwnerMapping = warehouse && userMap.get(String(warehouse.ownerId));
            const warehouseCompanyMatches = warehouse && (warehouse.companyId
              ? String(warehouse.companyId) === String(mappingRow.companyObjectId)
              : warehouseOwnerMapping && String(warehouseOwnerMapping.companyObjectId) === String(mappingRow.companyObjectId));
            if (!warehouse || !warehouseCompanyMatches) {
              report.existingConflicts.push({ collection: config.name, recordId: String(doc._id), issue: 'warehouse does not map to the same company' });
              continue;
            }
            if (!doc[config.warehouseField]) {
              report.warehouseAssignmentsPlanned.push({ collection: config.name, recordId: String(doc._id), ownerId: String(group._id), companyId: doc.companyId ? String(doc.companyId) : null, expectedCompanyId: String(mappingRow.companyObjectId), field: config.warehouseField, warehouseId: String(warehouseId) });
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
    const record = await db.collection(collectionName).findOne({ _id: new mongoose.Types.ObjectId(recordId) }, { session });
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
    const userQuery = User.findById(member.userObjectId).select('_id role accountStatus deletedAt');
    if (session) userQuery.session(session);
    const user = await userQuery.lean();
    const accountEligible = isActiveNonDeletedUser(user) && !isSuperAdminRole(user.role);
    mappedUserState.set(String(member.userObjectId), { accountEligible, existingMembership: null, membershipMatches: false });
    if (!user) report.existingConflicts.push({ userId: String(member.userObjectId), issue: 'mapped user does not exist' });
    else if (isSuperAdminRole(user.role)) report.existingConflicts.push({ userId: String(member.userObjectId), issue: 'Super Admin cannot be mapped as a company member' });
    else if (!isActiveNonDeletedUser(user)) report.existingConflicts.push({ userId: String(member.userObjectId), issue: 'mapped user is inactive or deleted' });
    const membershipQuery = CompanyMembership.findOne({ companyId: member.companyObjectId, userId: member.userObjectId });
    if (session) membershipQuery.session(session);
    const existingMembership = await membershipQuery.lean();
    if (existingMembership) {
      const expectedWarehouses = member.assignedWarehouseIds.map(String).sort();
      const actualWarehouses = (existingMembership.assignedWarehouseIds || []).map(String).sort();
      const mismatches = [];
      if (existingMembership.role !== member.role) mismatches.push('role');
      if (existingMembership.status !== 'active') mismatches.push('status');
      if (JSON.stringify(actualWarehouses) !== JSON.stringify(expectedWarehouses)) mismatches.push('assigned warehouse IDs');
      if (mismatches.length) report.existingConflicts.push({ userId: String(member.userObjectId), companyId: String(member.companyObjectId), issue: `existing membership mismatch: ${mismatches.join(', ')}` });
    }
    mappedUserState.set(String(member.userObjectId), {
      accountEligible,
      existingMembership,
      membershipMatches: !existingMembership || (
        existingMembership.role === member.role
        && existingMembership.status === 'active'
        && JSON.stringify((existingMembership.assignedWarehouseIds || []).map(String).sort())
          === JSON.stringify(member.assignedWarehouseIds.map(String).sort())
      )
    });
    for (const warehouseId of member.assignedWarehouseIds) {
      const warehouse = await db.collection('warehouses').findOne({ _id: warehouseId }, { session });
      const ownerMembership = warehouse && userMap.get(String(warehouse.ownerId));
      const warehouseCompanyMatches = warehouse && (warehouse.companyId
        ? String(warehouse.companyId) === String(member.companyObjectId)
        : ownerMembership && String(ownerMembership.companyObjectId) === String(member.companyObjectId));
      if (!warehouse || !warehouseCompanyMatches) {
        report.existingConflicts.push({ userId: String(member.userObjectId), warehouseId: String(warehouseId), issue: 'assigned warehouse does not map to this company' });
      }
    }
  }
  report.verifiedCompanyAdminsByCompany = {};
  for (const [companyId, company] of indexes.companyById.entries()) {
    const verifiedAdmins = new Set();
    for (const [userId, member] of userMap.entries()) {
      if (String(member.companyObjectId) !== companyId || member.role !== 'company_admin') continue;
      const state = mappedUserState.get(userId);
      // A new mapped membership will be created active by apply. If one already
      // exists, it must exactly match the reviewed mapping to be trusted.
      if (state?.accountEligible && state.membershipMatches) verifiedAdmins.add(userId);
    }

    const adminQuery = CompanyMembership.find({
      companyId: new mongoose.Types.ObjectId(companyId), role: 'company_admin', status: 'active'
    }).select('userId role status').sort({ userId: 1 }).limit(MAX_PREFLIGHT_COMPANY_ADMINS + 1);
    if (session) adminQuery.session(session);
    const existingAdmins = await adminQuery.lean();
    if (existingAdmins.length > MAX_PREFLIGHT_COMPANY_ADMINS) {
      report.existingConflicts.push({
        companyId, companyName: company.name,
        issue: `active Company Admin verification exceeded the ${MAX_PREFLIGHT_COMPANY_ADMINS} membership preflight limit`
      });
    }
    for (const membership of existingAdmins) {
      if (!membership || membership.role !== 'company_admin' || membership.status !== 'active' || !membership.userId) continue;
      const userId = String(membership.userId);
      const mapped = userMap.get(userId);
      if (mapped && String(mapped.companyObjectId) === companyId) {
        const state = mappedUserState.get(userId);
        if (mapped.role !== 'company_admin' || !state?.accountEligible || !state.membershipMatches
          || !state.existingMembership || state.existingMembership.role !== 'company_admin'
          || state.existingMembership.status !== 'active') continue;
        verifiedAdmins.add(userId);
        continue;
      }
      const adminUserQuery = User.findById(membership.userId).select('_id role accountStatus deletedAt');
      if (session) adminUserQuery.session(session);
      const adminUser = await adminUserQuery.lean();
      if (isVerifiedCompanyAdminMembership(membership, adminUser)) {
        verifiedAdmins.add(userId);
      }
    }

    const adminIds = [...verifiedAdmins].sort();
    report.verifiedCompanyAdminsByCompany[companyId] = adminIds;
    if (!adminIds.length) {
      report.existingConflicts.push({
        code: 'MISSING_ACTIVE_COMPANY_ADMIN', companyId, companyName: company.name,
        issue: `company ${company.name} (${companyId}) has no verified active Company Admin; explicitly map an active, non-deleted, non-Super Admin user as company_admin or retain a valid existing active Company Admin membership`
      });
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
      const duplicateQuery = db.collection(collectionName).aggregate([
        { $match: match },
        { $group: { _id: key, count: { $sum: 1 }, recordIds: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 100 }
      ]);
      const duplicates = session ? await duplicateQuery.session(session).toArray() : await duplicateQuery.toArray();
      duplicates.forEach(row => report.duplicateKeys.push({ companyId, companyName: company.name, collection: collectionName, key: row._id, count: row.count, recordIds: row.recordIds }));
    }
  }
  report.expectedMissingCompanyByCollection = Object.fromEntries(report.collections.map(row => [row.name, row.missingCompany]));
  report.plannedWriteCount = mapping.companies.length + mapping.users.length
    + report.collections.reduce((sum, row) => sum + row.missingCompany, 0)
    + report.warehouseAssignmentsPlanned.length;
  report.readyToApply = report.unmappedUsers.length === 0 && report.unmappedWarehouses.length === 0
    && report.existingConflicts.length === 0 && report.duplicateKeys.length === 0;
  if (report.plannedWriteCount > MAX_ATOMIC_WRITES) {
    report.readyToApply = false;
    report.existingConflicts.push({ issue: `planned migration has ${report.plannedWriteCount} writes; atomic limit is ${MAX_ATOMIC_WRITES}. Use a separately reviewed checkpointed process on a restored staging copy.` });
  }
  report.notes = [
    'Dry-run performs reads only. ownerId is preserved.',
    'Unmapped rows, warehouse assignments, and duplicate company keys must be resolved before apply.',
    'Apply re-runs preflight in the transaction, uses conditional updates, and verifies all results before commit.',
    `This migration refuses plans above ${MAX_ATOMIC_WRITES} writes; it intentionally has no unsafe partial-batch resume mode.`,
    `Preflight refuses collections above ${MAX_PREFLIGHT_RECORDS} owner records or ${MAX_PREFLIGHT_OWNER_GROUPS} owner groups so its materialized result remains bounded.`,
    'Freeze application writes for the full preflight/apply window and maintain a verified backup.',
    'A transaction abort is the rollback mechanism. Do not use ad hoc reverse writes; restore a verified backup if reconciliation fails.'
  ];
  return report;
}

async function applyMapping(mapping, indexes, report) {
  if (!report || report.readyToApply !== true) throw new Error('Apply is blocked unless the latest preflight report is readyToApply.');
  if (report.backupConfirmation !== CONFIRMATION) throw new Error(`Apply requires backup confirmation: ${CONFIRMATION}`);
  if (report.writeFreezeConfirmation !== WRITE_FREEZE_CONFIRMATION) throw new Error(`Apply requires confirmation that external database writers are stopped: ${WRITE_FREEZE_CONFIRMATION}`);
  const db = mongoose.connection.db;
  const lockToken = crypto.randomUUID();
  await acquireMigrationWriteFreeze(db, lockToken);
  let session;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const current = await makeReport(mapping, indexes, { session });
      const missingAdmin = current.existingConflicts.find(conflict => conflict.code === 'MISSING_ACTIVE_COMPANY_ADMIN');
      if (missingAdmin) throw new Error(`Company Admin revalidation failed: ${missingAdmin.issue}`);
      if (!current.readyToApply || current.plannedWriteCount !== report.plannedWriteCount
        || JSON.stringify(current.expectedMissingCompanyByOwner) !== JSON.stringify(report.expectedMissingCompanyByOwner)
        || JSON.stringify(current.warehouseAssignmentsPlanned) !== JSON.stringify(report.warehouseAssignmentsPlanned)
        || JSON.stringify(current.verifiedCompanyAdminsByCompany) !== JSON.stringify(report.verifiedCompanyAdminsByCompany)) {
        throw new Error('Preflight/apply drift detected inside transaction; no migration changes committed. Re-run dry-run and review the new report.');
      }
      for (const company of mapping.companies) {
        const result = await Company.updateOne(
          { _id: company._id },
          { $setOnInsert: {
            name: company.name, slug: company.slug, legalBusinessName: company.legalBusinessName || '',
            email: company.email || '', phone: company.phone || '', address: company.address || '',
            logo: company.logo || '', industry: company.industry || '', status: company.status || 'pending'
          } },
          { upsert: true, session, runValidators: true }
        );
        if (result.matchedCount === 0 && result.upsertedCount !== 1) throw new Error(`Company write did not match expected state: ${company._id}`);
      }
      for (const member of mapping.users) {
        const result = await CompanyMembership.updateOne(
          { companyId: member.companyObjectId, userId: member.userObjectId },
          { $setOnInsert: { role: member.role, status: 'active', assignedWarehouseIds: member.assignedWarehouseIds } },
          { upsert: true, session }
        );
        if (result.matchedCount === 0 && result.upsertedCount !== 1) throw new Error(`Membership write did not match expected state: ${member.userObjectId}`);
        const finalMembership = await CompanyMembership.findOne({ companyId: member.companyObjectId, userId: member.userObjectId }).session(session).lean();
        const expectedWarehouses = member.assignedWarehouseIds.map(String).sort();
        const actualWarehouses = (finalMembership?.assignedWarehouseIds || []).map(String).sort();
        if (!finalMembership || finalMembership.role !== member.role || finalMembership.status !== 'active'
          || JSON.stringify(actualWarehouses) !== JSON.stringify(expectedWarehouses)) {
          throw new Error(`Final membership verification failed for user ${member.userObjectId}`);
        }
      }
      for (const { name } of TENANT_COLLECTIONS) {
        const collection = mongoose.connection.db.collection(name);
        for (const [userId, member] of indexes.userMap.entries()) {
          const expectedCount = current.expectedMissingCompanyByOwner[`${name}:${userId}`] || 0;
          if (!expectedCount) continue;
          const result = await collection.updateMany(
            { ownerId: new mongoose.Types.ObjectId(userId), companyId: { $in: [null] } },
            { $set: { companyId: member.companyObjectId } },
            { session }
          );
          assertExactWriteCount(result, expectedCount, `Company backfill in ${name} for owner ${userId}`);
        }
      }
      for (const assignment of report.warehouseAssignmentsPlanned) {
        const filter = {
          _id: new mongoose.Types.ObjectId(assignment.recordId),
          ownerId: new mongoose.Types.ObjectId(assignment.ownerId),
          [assignment.field]: { $in: [null] },
          companyId: new mongoose.Types.ObjectId(assignment.expectedCompanyId)
        };
        const result = await mongoose.connection.db.collection(assignment.collection).updateOne(
          filter,
          { $set: { [assignment.field]: new mongoose.Types.ObjectId(assignment.warehouseId) } },
          { session }
        );
        assertExactWriteCount(result, 1, `Warehouse assignment ${assignment.collection}/${assignment.recordId}`);
      }

      // Verify the invariant against persisted membership and user records in
      // the transaction's post-write state, independently for every company.
      for (const [companyId, company] of indexes.companyById.entries()) {
        const verifiedAdminIds = await getVerifiedActiveCompanyAdminIds(companyId, { session });
        if (verifiedAdminIds.length === 0) {
          throw new Error(`Post-write Company Admin verification failed for company ${company.name} (${companyId}); transaction aborted.`);
        }
      }
    });
  } finally {
    try {
      if (session) await session.endSession();
    } finally {
      await releaseMigrationWriteFreeze(db, lockToken);
    }
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
    const freezeIndex = process.argv.indexOf('--confirm-write-freeze');
    if (freezeIndex < 0 || process.argv[freezeIndex + 1] !== WRITE_FREEZE_CONFIRMATION) {
      throw new Error(`Apply requires --confirm-write-freeze ${WRITE_FREEZE_CONFIRMATION} to attest that direct database writers are stopped; this phrase is not the application lock`);
    }
    if (!report.readyToApply) throw new Error('Preflight found unresolved mappings or conflicts; no changes were written.');
    console.log('Acquiring shared MongoDB application write freeze. Direct database writers must also remain stopped for this operation.');
    await applyMapping(mapping, indexes, { ...report, backupConfirmation: CONFIRMATION, writeFreezeConfirmation: WRITE_FREEZE_CONFIRMATION });
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

module.exports = { validateMapping, makeReport, applyMapping, assertExactWriteCount, TENANT_COLLECTIONS, COMPANY_UNIQUE_KEYS, CONFIRMATION, WRITE_FREEZE_CONFIRMATION, MAX_ATOMIC_WRITES, MAX_PREFLIGHT_RECORDS, MAX_PREFLIGHT_OWNER_GROUPS, MAX_PREFLIGHT_COMPANY_ADMINS };

const mongoose = require('mongoose');
const { EventEmitter } = require('events');
const User = require('../model/User');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const { createTestDb } = require('./helpers/writeFreezeTestDb');
const migrationWriteFreeze = require('../middleware/migrationWriteFreeze');
const {
  acquireApplicationWriteLease, releaseApplicationWriteLease, acquireMigrationWriteFreeze, releaseMigrationWriteFreeze,
  inspectWriteFreeze, recoverAbandonedWriteLease, recoverAbandonedMigrationLock,
  OWNER_STOPPED_CONFIRMATION, processIdentity, CONTROL_COLLECTION, CONTROL_ID
} = migrationWriteFreeze;
const { validateMapping, makeReport, applyMapping, assertExactWriteCount, TENANT_COLLECTIONS, WRITE_FREEZE_CONFIRMATION, MAX_PREFLIGHT_RECORDS, MAX_PREFLIGHT_OWNER_GROUPS, MAX_PREFLIGHT_COMPANY_ADMINS } = require('../scripts/migrateCompanies');

const validMapping = () => ({
  companies: [{ id: '64b000000000000000000070', name: 'Example Co', slug: 'example-co' }],
  users: [{ userId: '64b000000000000000000071', companyId: '64b000000000000000000070', role: 'company_admin' }]
});
function resultQuery(value) {
  return {
    select: jest.fn(function select() { return this; }),
    session: jest.fn(function session() { return this; }),
    sort: jest.fn(function sort() { return this; }),
    limit: jest.fn(function limit() { return this; }),
    lean: jest.fn().mockResolvedValue(value)
  };
}
function stubValidMappedUser({
  user = { role: 'staff', accountStatus: 'active', deletedAt: null },
  membership = null,
  usersById = {},
  companyAdmins = []
} = {}) {
  const userQuery = { session: jest.fn(function session() { return this; }), lean: jest.fn().mockResolvedValue(user) };
  const membershipQuery = { session: jest.fn(function session() { return this; }), lean: jest.fn().mockResolvedValue(membership) };
  const userSpy = jest.spyOn(User, 'findById').mockImplementation(userId => ({
    select: jest.fn(() => ({ ...userQuery, lean: jest.fn().mockResolvedValue(usersById[String(userId)] || user) }))
  }));
  const membershipSpy = jest.spyOn(CompanyMembership, 'findOne').mockReturnValue(membershipQuery);
  let adminsQuery;
  const adminsSpy = jest.spyOn(CompanyMembership, 'find').mockImplementation(filter => {
    adminsQuery = resultQuery(companyAdmins.filter(row => String(row.companyId) === String(filter.companyId)
      && row.role === filter.role && row.status === filter.status));
    return adminsQuery;
  });
  const restore = () => { userSpy.mockRestore(); membershipSpy.mockRestore(); adminsSpy.mockRestore(); };
  Object.defineProperty(restore, 'adminsQuery', { get: () => adminsQuery });
  return restore;
}
function findCursor(rows = []) {
  return { project: jest.fn(function project() { return this; }), limit: jest.fn(function limit() { return this; }), toArray: async () => rows };
}
async function runPreflight(mapping, userStubs = {}) {
  const originalDb = mongoose.connection.db;
  const collection = {
    aggregate: () => ({ session: jest.fn().mockReturnThis(), toArray: async () => [] }),
    countDocuments: async () => 0,
    find: () => findCursor(),
    findOne: async () => null
  };
  mongoose.connection.db = createTestDb(() => collection);
  const restoreUsers = stubValidMappedUser(userStubs);
  try {
    return await makeReport(mapping, validateMapping(mapping));
  } finally {
    restoreUsers();
    mongoose.connection.db = originalDb;
  }
}

describe('company migration safety', () => {
  test('a valid mapped active Company Admin satisfies each company requirement', async () => {
    const mapping = validMapping();
    const report = await runPreflight(mapping);
    const companyId = mapping.companies[0].id;
    expect(report.readyToApply).toBe(true);
    expect(report.verifiedCompanyAdminsByCompany[companyId]).toEqual([mapping.users[0].userId]);
    expect(report.existingConflicts).not.toContainEqual(expect.objectContaining({ code: 'MISSING_ACTIVE_COMPANY_ADMIN' }));
  });

  test('active Company Admin verification exceeding 1,000 records fails closed', async () => {
    const mapping = validMapping();
    const companyId = mapping.companies[0].id;
    const companyAdmins = Array.from({ length: MAX_PREFLIGHT_COMPANY_ADMINS + 1 }, () => ({
      userId: new mongoose.Types.ObjectId(), companyId, role: 'company_admin', status: 'active'
    }));
    const restoreUsers = stubValidMappedUser({ companyAdmins });
    const originalDb = mongoose.connection.db;
    const collection = {
      aggregate: () => ({ toArray: async () => [] }), countDocuments: async () => 0,
      find: () => findCursor(), findOne: async () => null
    };
    mongoose.connection.db = createTestDb(() => collection);
    try {
      const indexes = validateMapping(mapping);
      const report = await makeReport(mapping, indexes);
      expect(restoreUsers.adminsQuery.limit).toHaveBeenCalledWith(MAX_PREFLIGHT_COMPANY_ADMINS + 1);
      expect(report.readyToApply).toBe(false);
      expect(report.existingConflicts).toContainEqual(expect.objectContaining({
        companyId,
        issue: `active Company Admin verification exceeded the ${MAX_PREFLIGHT_COMPANY_ADMINS} membership preflight limit`
      }));
      await expect(applyMapping(mapping, indexes, {
        ...report, backupConfirmation: 'I_HAVE_VERIFIED_A_BACKUP', writeFreezeConfirmation: WRITE_FREEZE_CONFIRMATION
      })).rejects.toThrow(/latest preflight report is readyToApply/);
    } finally {
      restoreUsers();
      mongoose.connection.db = originalDb;
    }
  });

  test.each(['warehouse_manager', 'staff', 'auditor', 'inventory_manager', 'procurement_manager'])(
    'a company mapped only to %s is blocked without a verified active Company Admin', async role => {
      const mapping = validMapping();
      mapping.users[0].role = role;
      const report = await runPreflight(mapping);
      expect(report.readyToApply).toBe(false);
      expect(report.existingConflicts).toContainEqual(expect.objectContaining({
        code: 'MISSING_ACTIVE_COMPANY_ADMIN', companyId: mapping.companies[0].id
      }));
    }
  );

  test.each([
    ['inactive', { role: 'staff', accountStatus: 'inactive', deletedAt: null }],
    ['deleted', { role: 'staff', accountStatus: 'active', deletedAt: new Date() }]
  ])('a mapped Company Admin with an %s account is not counted', async (label, user) => {
    const mapping = validMapping();
    const report = await runPreflight(mapping, { user });
    expect(report.readyToApply).toBe(false);
    expect(report.verifiedCompanyAdminsByCompany[mapping.companies[0].id]).toEqual([]);
    expect(report.existingConflicts).toContainEqual(expect.objectContaining({
      code: 'MISSING_ACTIVE_COMPANY_ADMIN', companyId: mapping.companies[0].id
    }));
  });

  test('an existing active Company Admin with an active non-deleted account satisfies the requirement', async () => {
    const mapping = validMapping();
    mapping.users[0].role = 'warehouse_manager';
    const adminId = '64b000000000000000000072';
    const report = await runPreflight(mapping, {
      companyAdmins: [{ userId: new mongoose.Types.ObjectId(adminId), companyId: new mongoose.Types.ObjectId(mapping.companies[0].id), role: 'company_admin', status: 'active' }]
    });
    expect(report.readyToApply).toBe(true);
    expect(report.verifiedCompanyAdminsByCompany[mapping.companies[0].id]).toEqual([adminId]);
  });

  test('a revoked or inactive existing Company Admin membership is not counted', async () => {
    const mapping = validMapping();
    mapping.users[0].role = 'warehouse_manager';
    const adminId = '64b000000000000000000072';
    const report = await runPreflight(mapping, {
      companyAdmins: [{ userId: new mongoose.Types.ObjectId(adminId), companyId: new mongoose.Types.ObjectId(mapping.companies[0].id), role: 'company_admin', status: 'inactive' }]
    });
    expect(report.readyToApply).toBe(false);
    expect(report.verifiedCompanyAdminsByCompany[mapping.companies[0].id]).toEqual([]);
  });

  test.each([
    ['inactive', { role: 'staff', accountStatus: 'inactive', deletedAt: null }],
    ['deleted', { role: 'staff', accountStatus: 'active', deletedAt: new Date() }]
  ])('an existing active Company Admin membership for an %s account is not counted', async (label, adminUser) => {
    const mapping = validMapping();
    mapping.users[0].role = 'warehouse_manager';
    const adminId = '64b000000000000000000072';
    const companyId = new mongoose.Types.ObjectId(mapping.companies[0].id);
    const report = await runPreflight(mapping, {
      usersById: { [adminId]: adminUser },
      companyAdmins: [{ userId: new mongoose.Types.ObjectId(adminId), companyId, role: 'company_admin', status: 'active' }]
    });
    expect(report.readyToApply).toBe(false);
    expect(report.verifiedCompanyAdminsByCompany[mapping.companies[0].id]).toEqual([]);
  });

  test('one company without a verified active Company Admin blocks a multi-company migration', async () => {
    const mapping = validMapping();
    const secondCompanyId = '64b000000000000000000073';
    mapping.companies.push({ id: secondCompanyId, name: 'Second Co', slug: 'second-co' });
    mapping.users.push({ userId: '64b000000000000000000074', companyId: secondCompanyId, role: 'auditor', assignedWarehouseIds: [] });
    const report = await runPreflight(mapping);
    expect(report.readyToApply).toBe(false);
    expect(report.existingConflicts).toContainEqual(expect.objectContaining({
      code: 'MISSING_ACTIVE_COMPANY_ADMIN', companyId: secondCompanyId
    }));
    expect(report.verifiedCompanyAdminsByCompany[mapping.companies[0].id]).toHaveLength(1);
    expect(report.verifiedCompanyAdminsByCompany[secondCompanyId]).toEqual([]);
  });

  test('a mismatched existing membership cannot satisfy the mapped Company Admin requirement', async () => {
    const mapping = validMapping();
    const report = await runPreflight(mapping, {
      membership: { role: 'company_admin', status: 'inactive', assignedWarehouseIds: [] }
    });
    expect(report.readyToApply).toBe(false);
    expect(report.verifiedCompanyAdminsByCompany[mapping.companies[0].id]).toEqual([]);
  });

  test.each(['mapped Company Admin account becomes inactive', 'existing Company Admin membership is revoked'])(
    'transaction-time preflight blocks apply when an admin becomes invalid: %s', async scenario => {
      const originalDb = mongoose.connection.db;
      const collection = {
        aggregate: () => ({ session: jest.fn().mockReturnThis(), toArray: async () => [] }),
        countDocuments: jest.fn().mockResolvedValue(0),
        find: () => findCursor(),
        findOne: async () => null,
        updateMany: jest.fn()
      };
      mongoose.connection.db = createTestDb(() => collection);
      const mapping = validMapping();
      const mappedUserId = mapping.users[0].userId;
      const activeUser = { _id: mappedUserId, role: 'staff', accountStatus: 'active', deletedAt: null };
      const inactiveUser = { ...activeUser, accountStatus: 'inactive' };
      const userQueryFor = user => ({
        select: () => ({ session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(user) })
      });
      let mappedUserReads = 0;
      const adminUser = { _id: '64b000000000000000000072', role: 'staff', accountStatus: 'active', deletedAt: null };
      const userRead = jest.spyOn(User, 'findById').mockImplementation(userId => {
        if (String(userId) !== mappedUserId) return userQueryFor(adminUser);
        mappedUserReads += 1;
        const losesEligibility = scenario.startsWith('mapped') && mappedUserReads > 1;
        return userQueryFor(losesEligibility ? inactiveUser : activeUser);
      });
      const membershipQueryFor = membership => ({ session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(membership) });
      const membershipRead = jest.spyOn(CompanyMembership, 'findOne').mockReturnValue(membershipQueryFor(null));
      const activeAdminMembership = [{
        userId: new mongoose.Types.ObjectId('64b000000000000000000072'),
        companyId: new mongoose.Types.ObjectId(mapping.companies[0].id), role: 'company_admin', status: 'active'
      }];
      const adminQuery = admins => ({ ...resultQuery(admins), select() { return this; } });
      const adminRead = jest.spyOn(CompanyMembership, 'find')
        .mockReturnValueOnce(adminQuery(scenario.startsWith('mapped') ? [] : activeAdminMembership))
        .mockReturnValueOnce(adminQuery([]));
      const companyWrite = jest.spyOn(Company, 'updateOne').mockResolvedValue({ matchedCount: 0, upsertedCount: 1 });
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue({
        withTransaction: jest.fn(async callback => callback()), endSession: jest.fn()
      });
      try {
        if (!scenario.startsWith('mapped')) mapping.users[0].role = 'warehouse_manager';
        const indexes = validateMapping(mapping);
        const reviewed = await makeReport(mapping, indexes);
        expect(reviewed.readyToApply).toBe(true);
        await expect(applyMapping(mapping, indexes, {
          ...reviewed,
          backupConfirmation: 'I_HAVE_VERIFIED_A_BACKUP',
          writeFreezeConfirmation: WRITE_FREEZE_CONFIRMATION
        })).rejects.toThrow(/Company Admin revalidation failed/);
        expect(companyWrite).not.toHaveBeenCalled();
      } finally {
        userRead.mockRestore(); membershipRead.mockRestore(); adminRead.mockRestore();
        companyWrite.mockRestore(); startSession.mockRestore(); mongoose.connection.db = originalDb;
      }
    }
  );

  test('conditional migration writes abort when matched or modified counts drift', () => {
    expect(() => assertExactWriteCount({ matchedCount: 3, modifiedCount: 3 }, 3, 'test write')).not.toThrow();
    expect(() => assertExactWriteCount({ matchedCount: 2, modifiedCount: 2 }, 3, 'test write')).toThrow(/count mismatch/);
    expect(() => assertExactWriteCount({ matchedCount: 3, modifiedCount: 2 }, 3, 'test write')).toThrow(/count mismatch/);
  });

  test('requires explicit user-to-company mapping and rejects duplicate user mappings', () => {
    expect(() => validateMapping({ companies: [], users: [] })).not.toThrow();
    const mapping = validMapping();
    mapping.users.push({ ...mapping.users[0] });
    expect(() => validateMapping(mapping)).toThrow(/maps to more than one company/);
  });

  test('dry-run reports without writing records', async () => {
    const originalDb = mongoose.connection.db;
    const collection = {
      aggregate: () => ({ toArray: async () => [] }),
      countDocuments: async () => 0,
      find: () => findCursor(),
      findOne: async () => null,
      updateMany: jest.fn(), updateOne: jest.fn()
    };
    mongoose.connection.db = createTestDb(() => collection);
    const restoreUsers = stubValidMappedUser();
    const mapping = validMapping();
    const indexes = validateMapping(mapping);
    try {
      const report = await makeReport(mapping, indexes);
      expect(report.mode).toBe('dry-run');
      expect(report.collections.map(row => row.name)).toEqual(TENANT_COLLECTIONS.map(row => row.name));
      expect(report.readyToApply).toBe(true);
      expect(collection.updateMany).not.toHaveBeenCalled();
      expect(collection.updateOne).not.toHaveBeenCalled();
    } finally {
      restoreUsers();
      mongoose.connection.db = originalDb;
    }
  });

  test('dry-run blocks apply when company-scoped unique keys would collide', async () => {
    const originalDb = mongoose.connection.db;
    const collection = (name) => ({
      aggregate: pipeline => ({ toArray: async () => (
        name === 'items' && pipeline.some(stage => stage.$group && stage.$group._id && stage.$group._id.skuNumber)
          ? [{ _id: { skuNumber: 'SKU-1' }, count: 2, recordIds: ['one', 'two'] }]
          : []
      ) }),
      countDocuments: async () => 0,
      find: () => findCursor(),
      findOne: async () => null
    });
    mongoose.connection.db = { collection: jest.fn(name => collection(name)) };
    const restoreUsers = stubValidMappedUser();
    const mapping = validMapping();
    const indexes = validateMapping(mapping);
    try {
      const report = await makeReport(mapping, indexes);
      expect(report.readyToApply).toBe(false);
      expect(report.duplicateKeys).toContainEqual(expect.objectContaining({ collection: 'items', count: 2, key: { skuNumber: 'SKU-1' } }));
    } finally {
      restoreUsers();
      mongoose.connection.db = originalDb;
    }
  });

  test('apply revalidates preflight in one transaction and verifies membership state', async () => {
    const originalDb = mongoose.connection.db;
    const collection = {
      aggregate: () => ({ session: function session() { return this; }, toArray: async () => [] }),
      countDocuments: jest.fn().mockResolvedValue(0),
      find: () => findCursor(),
      findOne: async () => null,
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
    };
    mongoose.connection.db = createTestDb(() => collection);
    const companyUpdate = jest.spyOn(Company, 'updateOne').mockResolvedValue({ matchedCount: 0, upsertedCount: 1 });
    const membershipUpdate = jest.spyOn(CompanyMembership, 'updateOne').mockResolvedValue({ matchedCount: 0, upsertedCount: 1 });
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mapping = validMapping();
    const indexes = validateMapping(mapping);
    const userQuery = { session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ role: 'staff', accountStatus: 'active', deletedAt: null }) };
    const userRead = jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn(() => userQuery) });
    const membershipRead = jest.spyOn(CompanyMembership, 'findOne')
      .mockReturnValueOnce({ session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({
        role: 'company_admin', status: 'active', assignedWarehouseIds: []
      }) });
    const adminQueries = [];
    const adminRead = jest.spyOn(CompanyMembership, 'find').mockImplementation(() => {
      const query = resultQuery(adminQueries.length === 2 ? [{
        userId: new mongoose.Types.ObjectId(mapping.users[0].userId), role: 'company_admin', status: 'active'
      }] : []);
      adminQueries.push(query);
      return query;
    });
    try {
      const report = await makeReport(mapping, indexes);
      expect(report.readyToApply).toBe(true);
      await applyMapping(mapping, indexes, { ...report, backupConfirmation: 'I_HAVE_VERIFIED_A_BACKUP', writeFreezeConfirmation: WRITE_FREEZE_CONFIRMATION });
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(companyUpdate).toHaveBeenCalledTimes(1);
      expect(membershipUpdate).toHaveBeenCalledTimes(1);
      expect(adminQueries).toHaveLength(3);
      expect(adminQueries[2].session).toHaveBeenCalledWith(session);
      expect(collection.updateMany).not.toHaveBeenCalled();
    } finally {
      userRead.mockRestore(); membershipRead.mockRestore(); adminRead.mockRestore();
      startSession.mockRestore();
      companyUpdate.mockRestore();
      membershipUpdate.mockRestore();
      mongoose.connection.db = originalDb;
    }
  });

  test('post-write Company Admin verification aborts the transaction when any company has no qualifying admin', async () => {
    const originalDb = mongoose.connection.db;
    const collection = {
      aggregate: () => ({ session: jest.fn().mockReturnThis(), toArray: async () => [] }),
      countDocuments: jest.fn().mockResolvedValue(0), find: () => findCursor(), findOne: async () => null,
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 })
    };
    mongoose.connection.db = createTestDb(() => collection);
    const mapping = validMapping();
    const indexes = validateMapping(mapping);
    let transactionState = 'not-started';
    const mutationStates = [];
    const companyUpdate = jest.spyOn(Company, 'updateOne').mockImplementation(async () => {
      mutationStates.push(transactionState);
      return { matchedCount: 0, upsertedCount: 1 };
    });
    const membershipUpdate = jest.spyOn(CompanyMembership, 'updateOne').mockImplementation(async () => {
      mutationStates.push(transactionState);
      return { matchedCount: 0, upsertedCount: 1 };
    });
    const userQuery = { session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({
      _id: mapping.users[0].userId, role: 'staff', accountStatus: 'active', deletedAt: null
    }) };
    const userRead = jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn(() => userQuery) });
    const membershipQuery = membership => ({ session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(membership) });
    const membershipRead = jest.spyOn(CompanyMembership, 'findOne')
      .mockReturnValueOnce(membershipQuery(null))
      .mockReturnValueOnce(membershipQuery(null))
      .mockReturnValueOnce(membershipQuery({ role: 'company_admin', status: 'active', assignedWarehouseIds: [] }));
    const adminQueries = [];
    const adminRead = jest.spyOn(CompanyMembership, 'find').mockImplementation(() => {
      const query = resultQuery([]);
      adminQueries.push(query);
      return query;
    });
    const session = {
      withTransaction: jest.fn(async callback => {
        transactionState = 'running';
        try {
          const result = await callback();
          transactionState = 'committed';
          return result;
        } catch (error) {
          transactionState = 'aborted';
          throw error;
        }
      }),
      endSession: jest.fn()
    };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const reviewed = await makeReport(mapping, indexes);
      expect(reviewed.readyToApply).toBe(true);
      await expect(applyMapping(mapping, indexes, {
        ...reviewed, backupConfirmation: 'I_HAVE_VERIFIED_A_BACKUP', writeFreezeConfirmation: WRITE_FREEZE_CONFIRMATION
      })).rejects.toThrow(/Post-write Company Admin verification failed/);
      expect(companyUpdate).toHaveBeenCalledTimes(1);
      expect(membershipUpdate).toHaveBeenCalledTimes(1);
      expect(mutationStates).toEqual(['running', 'running']);
      expect(adminQueries).toHaveLength(3);
      expect(adminQueries[2].session).toHaveBeenCalledWith(session);
      expect(transactionState).toBe('aborted');
      expect(transactionState).not.toBe('committed');
    } finally {
      userRead.mockRestore(); membershipRead.mockRestore(); adminRead.mockRestore(); startSession.mockRestore();
      companyUpdate.mockRestore(); membershipUpdate.mockRestore();
      mongoose.connection.db = originalDb;
    }
  });

  test('dry-run blocks warehouse-bound company records missing warehouse assignment even when already scoped', async () => {
    const originalDb = mongoose.connection.db;
    const mapping = validMapping();
    const itemOwner = new mongoose.Types.ObjectId(mapping.users[0].userId);
    const companyId = new mongoose.Types.ObjectId(mapping.companies[0].id);
    const dbCollection = name => ({
      aggregate: () => ({ toArray: async () => name === 'products' ? [{ _id: itemOwner, total: 1, missingCompany: 0 }] : [] }),
      countDocuments: async () => 0,
      find: filter => findCursor(
        name === 'products' ? [{ _id: new mongoose.Types.ObjectId('64b000000000000000000072'), companyId, warehouseId: null, location: 'A-1' }] : []
      ),
      findOne: async () => null
    });
    mongoose.connection.db = { collection: jest.fn(name => dbCollection(name)) };
    const restoreUsers = stubValidMappedUser();
    try {
      const report = await makeReport(mapping, validateMapping(mapping));
      expect(report.readyToApply).toBe(false);
      expect(report.unmappedWarehouses).toContainEqual(expect.objectContaining({ collection: 'products' }));
    } finally {
      restoreUsers();
      mongoose.connection.db = originalDb;
    }
  });

  test('dry-run blocks a company ID collision with different company details', async () => {
    const originalDb = mongoose.connection.db;
    const mapping = validMapping();
    const dbCollection = name => ({
      aggregate: () => ({ toArray: async () => [] }),
      countDocuments: async () => 0,
      find: () => findCursor(),
      findOne: async filter => name === 'companies' && filter._id
        ? { _id: filter._id, name: 'Different Co', slug: 'different-co' }
        : null
    });
    mongoose.connection.db = { collection: jest.fn(name => dbCollection(name)) };
    const restoreUsers = stubValidMappedUser();
    try {
      const report = await makeReport(mapping, validateMapping(mapping));
      expect(report.readyToApply).toBe(false);
      expect(report.existingConflicts).toContainEqual(expect.objectContaining({ issue: 'company ID already exists with different name or slug' }));
    } finally {
      restoreUsers();
      mongoose.connection.db = originalDb;
    }
  });

  test('dry-run blocks an existing slug owned by another company ID', async () => {
    const originalDb = mongoose.connection.db;
    const mapping = validMapping();
    const otherId = new mongoose.Types.ObjectId('64b000000000000000000099');
    const dbCollection = name => ({
      aggregate: () => ({ toArray: async () => [] }), countDocuments: async () => 0,
      find: () => findCursor(),
      findOne: async filter => name === 'companies' && filter.slug ? { _id: otherId, slug: 'example-co' } : null
    });
    mongoose.connection.db = { collection: jest.fn(name => dbCollection(name)) };
    const restoreUsers = stubValidMappedUser();
    try {
      const report = await makeReport(mapping, validateMapping(mapping));
      expect(report.readyToApply).toBe(false);
      expect(report.existingConflicts).toContainEqual(expect.objectContaining({ issue: 'company slug already belongs to a different ID' }));
    } finally { restoreUsers(); mongoose.connection.db = originalDb; }
  });

  test('dry-run refuses large migration plans rather than starting an unbounded transaction', async () => {
    const originalDb = mongoose.connection.db;
    const mapping = validMapping();
    const ownerId = new mongoose.Types.ObjectId(mapping.users[0].userId);
    const dbCollection = name => ({
      aggregate: pipeline => ({ toArray: async () => pipeline[1]?.$group?._id === '$ownerId' && name === 'items'
        ? [{ _id: ownerId, total: 999, missingCompany: 999 }] : [] }),
      countDocuments: async () => 0,
      find: () => findCursor(), findOne: async () => null
    });
    mongoose.connection.db = { collection: jest.fn(name => dbCollection(name)) };
    const restoreUsers = stubValidMappedUser();
    try {
      const report = await makeReport(mapping, validateMapping(mapping));
      expect(report.plannedWriteCount).toBeGreaterThan(1000);
      expect(report.readyToApply).toBe(false);
      expect(report.existingConflicts.some(row => /atomic limit/.test(row.issue))).toBe(true);
    } finally { restoreUsers(); mongoose.connection.db = originalDb; }
  });

  test('dry-run refuses oversized preflight scans before materializing records', async () => {
    const originalDb = mongoose.connection.db;
    const mapping = validMapping();
    const dbCollection = name => ({
      aggregate: pipeline => ({ toArray: async () => (name === 'items' && pipeline[1]?.$group?._id === '$ownerId'
        ? (() => { throw new Error('preflight did not stop before owner aggregation'); })() : []) }),
      countDocuments: async filter => name === 'items' && filter.ownerId ? MAX_PREFLIGHT_RECORDS + 1 : 0,
      find: () => findCursor(), findOne: async () => null
    });
    mongoose.connection.db = { collection: jest.fn(name => dbCollection(name)) };
    const restoreUsers = stubValidMappedUser();
    try {
      const report = await makeReport(mapping, validateMapping(mapping));
      expect(report.readyToApply).toBe(false);
      expect(report.existingConflicts).toContainEqual(expect.objectContaining({ collection: 'items', records: MAX_PREFLIGHT_RECORDS + 1 }));
    } finally { restoreUsers(); mongoose.connection.db = originalDb; }
  });

  test('mapping with excessive users cannot enter a migration plan', () => {
    const mapping = validMapping();
    mapping.users = Array.from({ length: MAX_PREFLIGHT_OWNER_GROUPS + 1 }, (_, index) => ({
      userId: new mongoose.Types.ObjectId().toString(), companyId: mapping.companies[0].id, role: 'staff'
    }));
    expect(() => validateMapping(mapping)).toThrow(/safe preflight limit/);
  });

  test('dry-run blocks malformed non-null companyId types', async () => {
    const originalDb = mongoose.connection.db;
    const mapping = validMapping();
    const dbCollection = name => ({
      aggregate: () => ({ toArray: async () => [] }),
      countDocuments: async filter => name === 'items' && filter.companyId ? 1 : 0,
      find: () => findCursor(),
      findOne: async () => null
    });
    mongoose.connection.db = { collection: jest.fn(name => dbCollection(name)) };
    const restoreUsers = stubValidMappedUser();
    try {
      const report = await makeReport(mapping, validateMapping(mapping));
      expect(report.readyToApply).toBe(false);
      expect(report.existingConflicts).toContainEqual(expect.objectContaining({ collection: 'items', issue: 'non-null companyId value is not an ObjectId' }));
    } finally {
      restoreUsers();
      mongoose.connection.db = originalDb;
    }
  });

  test.each([
    ['role', { role: 'warehouse_manager', status: 'active', assignedWarehouseIds: [] }],
    ['inactive status', { role: 'company_admin', status: 'inactive', assignedWarehouseIds: [] }],
    ['warehouse grants', { role: 'company_admin', status: 'active', assignedWarehouseIds: ['64b000000000000000000099'] }]
  ])('preflight blocks an existing membership %s mismatch', async (label, membership) => {
    const originalDb = mongoose.connection.db;
    const collection = { aggregate: () => ({ toArray: async () => [] }), countDocuments: async () => 0, find: () => findCursor(), findOne: async () => null };
    mongoose.connection.db = { collection: jest.fn(() => collection) };
    const restoreUsers = stubValidMappedUser({ membership });
    try {
      const mapping = validMapping();
      const report = await makeReport(mapping, validateMapping(mapping));
      expect(report.readyToApply).toBe(false);
      expect(report.existingConflicts).toContainEqual(expect.objectContaining({ issue: expect.stringContaining('existing membership mismatch') }));
    } finally { restoreUsers(); mongoose.connection.db = originalDb; }
  });

  test.each([
    ['inactive', { role: 'staff', accountStatus: 'inactive', deletedAt: null }],
    ['deleted', { role: 'staff', accountStatus: 'active', deletedAt: new Date() }],
    ['Super Admin', { role: 'superadmin', accountStatus: 'active', deletedAt: null }]
  ])('preflight rejects %s mapped users', async (label, user) => {
    const originalDb = mongoose.connection.db;
    const collection = { aggregate: () => ({ toArray: async () => [] }), countDocuments: async () => 0, find: () => findCursor(), findOne: async () => null };
    mongoose.connection.db = { collection: jest.fn(() => collection) };
    const restoreUsers = stubValidMappedUser({ user });
    try {
      const mapping = validMapping();
      const report = await makeReport(mapping, validateMapping(mapping));
      expect(report.readyToApply).toBe(false);
      expect(report.existingConflicts.some(row => /mapped user is inactive|Super Admin/.test(row.issue))).toBe(true);
    } finally { restoreUsers(); mongoose.connection.db = originalDb; }
  });

  test('apply aborts before writes when membership data changes after preflight', async () => {
    const originalDb = mongoose.connection.db;
    const collection = { aggregate: () => ({ session: jest.fn().mockReturnThis(), toArray: async () => [] }), countDocuments: async () => 0, find: () => findCursor(), findOne: async () => null, updateMany: jest.fn() };
    mongoose.connection.db = createTestDb(() => collection);
    const userQuery = { session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ role: 'staff', accountStatus: 'active', deletedAt: null }) };
    const userRead = jest.spyOn(User, 'findById').mockReturnValue({ select: jest.fn(() => userQuery) });
    const membershipRead = jest.spyOn(CompanyMembership, 'findOne')
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ session: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ role: 'warehouse_manager', status: 'active', assignedWarehouseIds: [] }) });
      const adminRead = jest.spyOn(CompanyMembership, 'find').mockReturnValue(resultQuery([]));
    const companyWrite = jest.spyOn(Company, 'updateOne').mockResolvedValue({ matchedCount: 0, upsertedCount: 1 });
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const mapping = validMapping();
      const indexes = validateMapping(mapping);
      const reviewed = await makeReport(mapping, indexes);
      await expect(applyMapping(mapping, indexes, { ...reviewed, backupConfirmation: 'I_HAVE_VERIFIED_A_BACKUP', writeFreezeConfirmation: WRITE_FREEZE_CONFIRMATION }))
        .rejects.toThrow(/Company Admin revalidation failed/);
      expect(companyWrite).not.toHaveBeenCalled();
      expect(await mongoose.connection.db.collection(CONTROL_COLLECTION).findOne({ _id: CONTROL_ID })).toMatchObject({ maintenance: false, activeWrites: 0 });
    } finally {
        userRead.mockRestore(); membershipRead.mockRestore(); adminRead.mockRestore(); companyWrite.mockRestore(); startSession.mockRestore(); mongoose.connection.db = originalDb;
    }
  });

  test('applyMapping refuses to run without ready preflight and explicit backup confirmation', async () => {
    const mapping = validMapping();
    const indexes = validateMapping(mapping);
    await expect(applyMapping(mapping, indexes, { readyToApply: false, backupConfirmation: 'I_HAVE_VERIFIED_A_BACKUP' }))
      .rejects.toThrow(/latest preflight report/);
    await expect(applyMapping(mapping, indexes, { readyToApply: true }))
      .rejects.toThrow(/backup confirmation/);
  });

  test('shared migration freeze waits for application write leases and can be safely released', async () => {
    const db = createTestDb();
    const lease = await acquireApplicationWriteLease(db);
    expect(lease.activeWrites).toBe(1);
    expect(lease.lease.leaseId).toBeTruthy();
    await expect(acquireMigrationWriteFreeze(db, 'migration-token', { waitMs: 0 }))
      .rejects.toThrow(/1 application write request/);
    await releaseApplicationWriteLease(db, lease.lease);
    await acquireMigrationWriteFreeze(db, 'migration-token');
    await expect(acquireApplicationWriteLease(db)).resolves.toBeNull();
    await releaseMigrationWriteFreeze(db, 'migration-token');
    await expect(acquireApplicationWriteLease(db)).resolves.toMatchObject({ maintenance: false, activeWrites: 1 });
  });

  test('concurrent migration attempts cannot both acquire the shared lock', async () => {
    const db = createTestDb();
    const attempts = await Promise.allSettled([
      acquireMigrationWriteFreeze(db, 'migration-a'),
      acquireMigrationWriteFreeze(db, 'migration-b')
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    const winner = attempts.find(result => result.status === 'fulfilled').value.lockToken;
    await releaseMigrationWriteFreeze(db, winner);
  });

  test('one application instance cannot release another unique write lease', async () => {
    const db = createTestDb();
    const acquired = await acquireApplicationWriteLease(db);
    const foreignLease = { ...acquired.lease, ownerInstanceId: 'different-process-instance' };
    await expect(releaseApplicationWriteLease(db, foreignLease)).rejects.toThrow(/another process instance/);
    expect(await db.collection(CONTROL_COLLECTION).findOne({ _id: CONTROL_ID })).toMatchObject({ activeWrites: 1 });
    await releaseApplicationWriteLease(db, acquired.lease);
    expect(await db.collection(CONTROL_COLLECTION).findOne({ _id: CONTROL_ID })).toMatchObject({ activeWrites: 0, activeWriteLeases: [] });
  });

  test('shared control state blocks writes and migration while any lease is active', async () => {
    const db = createTestDb();
    const firstAppInstance = await acquireApplicationWriteLease(db);
    const secondAppInstance = await acquireApplicationWriteLease(db);
    expect(firstAppInstance.lease.leaseId).not.toBe(secondAppInstance.lease.leaseId);
    await expect(acquireMigrationWriteFreeze(db, 'blocked-lock', { waitMs: 0 })).rejects.toThrow(/2 application write request/);
    await releaseApplicationWriteLease(db, firstAppInstance.lease);
    await releaseApplicationWriteLease(db, secondAppInstance.lease);
    await acquireMigrationWriteFreeze(db, 'shared-lock');
    await expect(acquireApplicationWriteLease(db)).resolves.toBeNull();
    await releaseMigrationWriteFreeze(db, 'shared-lock');
  });

  test('migration waits for active leases to drain, then atomically blocks new leases', async () => {
    const db = createTestDb();
    const lease = await acquireApplicationWriteLease(db);
    const pendingLock = acquireMigrationWriteFreeze(db, 'drain-lock', { waitMs: 1000, pollIntervalMs: 5 });
    setTimeout(() => releaseApplicationWriteLease(db, lease.lease), 20);
    const lock = await pendingLock;
    expect(lock).toMatchObject({ maintenance: true, activeWrites: 0, activeWriteLeases: [] });
    await expect(acquireApplicationWriteLease(db)).resolves.toBeNull();
    await releaseMigrationWriteFreeze(db, 'drain-lock');
  });

  test('legacy nonzero counters without per-lease ownership fail closed and are not normalized', async () => {
    const legacyRecord = { _id: CONTROL_ID, maintenance: false, activeWrites: 1, lockToken: null, lockedAt: new Date() };
    const db = createTestDb(() => ({}), legacyRecord);
    await expect(acquireApplicationWriteLease(db)).rejects.toThrow(/Legacy write-freeze state has active or unverifiable ownership/);
    const snapshot = await inspectWriteFreeze(db);
    expect(snapshot.consistent).toBe(false);
    expect(db.getControlCollection().getDocument()).toEqual(legacyRecord);
  });

  test('an active migration lock cannot be cleared by age or without exact owner-stop attestation', async () => {
    const db = createTestDb();
    const acquired = await acquireMigrationWriteFreeze(db, 'stale-looking-token');
    await expect(recoverAbandonedMigrationLock(db, {
      lockToken: acquired.lockToken,
      ownerInstanceId: acquired.lockOwner.instanceId,
      operator: 'operator', reason: 'old lock', confirmation: undefined
    }, () => false)).rejects.toThrow(/confirm-owner-stopped/);
    expect(await inspectWriteFreeze(db)).toMatchObject({ consistent: true, record: { maintenance: true } });
  });

  test('recovery refuses while migration is active, while other writes remain, or when owner identity mismatches', async () => {
    const db = createTestDb();
    const first = await acquireApplicationWriteLease(db);
    const second = await acquireApplicationWriteLease(db);
    const recovery = {
      leaseId: first.lease.leaseId,
      ownerInstanceId: first.lease.ownerInstanceId,
      operator: 'warehouse-ops', reason: 'verified crashed worker',
      confirmation: OWNER_STOPPED_CONFIRMATION
    };
    await expect(recoverAbandonedWriteLease(db, recovery, () => false)).rejects.toThrow(/other active writes remain/);
    await releaseApplicationWriteLease(db, second.lease);
    await expect(recoverAbandonedWriteLease(db, { ...recovery, ownerInstanceId: 'wrong-owner' }, () => false)).rejects.toThrow(/does not match/);
    await releaseApplicationWriteLease(db, first.lease);
    await acquireMigrationWriteFreeze(db, 'active-migration');
    await expect(recoverAbandonedWriteLease(db, recovery, () => false)).rejects.toThrow(/migration lock is active/);
  });

  test('explicit recovery reconciles only the sole exact abandoned lease and records an audit entry', async () => {
    const db = createTestDb();
    const acquired = await acquireApplicationWriteLease(db);
    await expect(recoverAbandonedWriteLease(db, {
      leaseId: acquired.lease.leaseId, ownerInstanceId: acquired.lease.ownerInstanceId,
      operator: 'radhe@example.test', reason: 'Process supervisor confirms instance stopped',
      confirmation: OWNER_STOPPED_CONFIRMATION
    }, () => true)).rejects.toThrow(/PID .* is present/);
    expect(db.getControlCollection().getDocument().activeWrites).toBe(1);
    const audit = await recoverAbandonedWriteLease(db, {
      leaseId: acquired.lease.leaseId,
      ownerInstanceId: acquired.lease.ownerInstanceId,
      operator: 'radhe@example.test', reason: 'Process supervisor confirms instance stopped',
      confirmation: OWNER_STOPPED_CONFIRMATION
    }, () => false);
    expect(audit).toMatchObject({ action: 'application_write_lease', targetId: acquired.lease.leaseId, operator: 'radhe@example.test' });
    expect(await inspectWriteFreeze(db)).toMatchObject({
      consistent: true,
      record: { maintenance: false, activeWrites: 0, activeWriteLeases: [], recoveryAudit: [audit] }
    });
  });

  test('concurrent recovery attempts can reconcile an exact lease only once', async () => {
    const db = createTestDb();
    const acquired = await acquireApplicationWriteLease(db);
    const recovery = {
      leaseId: acquired.lease.leaseId,
      ownerInstanceId: acquired.lease.ownerInstanceId,
      operator: 'operator', reason: 'owner stopped', confirmation: OWNER_STOPPED_CONFIRMATION
    };
    const outcomes = await Promise.allSettled([
      recoverAbandonedWriteLease(db, recovery, () => false),
      recoverAbandonedWriteLease(db, recovery, () => false)
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(db.getControlCollection().getDocument().recoveryAudit).toHaveLength(1);
  });

  test('migration lock recovery requires stopped owner and writes an atomic audit record', async () => {
    const db = createTestDb();
    const lock = await acquireMigrationWriteFreeze(db, 'recoverable-lock');
    await expect(recoverAbandonedMigrationLock(db, {
      lockToken: lock.lockToken, ownerInstanceId: lock.lockOwner.instanceId,
      operator: 'operator', reason: 'process confirmed stopped', confirmation: OWNER_STOPPED_CONFIRMATION
    }, () => true)).rejects.toThrow(/PID .* is present/);
    const audit = await recoverAbandonedMigrationLock(db, {
      lockToken: lock.lockToken, ownerInstanceId: lock.lockOwner.instanceId,
      operator: 'operator', reason: 'process supervisor confirms migration exited', confirmation: OWNER_STOPPED_CONFIRMATION
    }, () => false);
    expect(audit.action).toBe('migration_lock');
    expect(db.getControlCollection().getDocument()).toMatchObject({ maintenance: false, lockToken: null, recoveryAudit: [audit] });
  });

  test('wrong migration token cannot release a lock owned by this process', async () => {
    const db = createTestDb();
    await acquireMigrationWriteFreeze(db, 'correct-token');
    await expect(releaseMigrationWriteFreeze(db, 'wrong-token')).rejects.toThrow(/owned by this process/);
    expect(db.getControlCollection().getDocument()).toMatchObject({ maintenance: true, lockToken: 'correct-token', lockOwner: { instanceId: processIdentity.instanceId } });
    await releaseMigrationWriteFreeze(db, 'correct-token');
  });

  test('aborted HTTP response retains its lease until safe operator reconciliation', async () => {
    const originalDb = mongoose.connection.db;
    const db = createTestDb();
    mongoose.connection.db = db;
    const req = { method: 'POST' };
    const res = new EventEmitter();
    res.writableFinished = false;
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    const next = jest.fn();
    try {
      migrationWriteFreeze(req, res, next);
      await new Promise(resolve => setImmediate(resolve));
      expect(next).toHaveBeenCalledTimes(1);
      expect(await db.collection(CONTROL_COLLECTION).findOne({ _id: CONTROL_ID })).toMatchObject({ activeWrites: 1 });
      res.emit('close');
      await new Promise(resolve => setImmediate(resolve));
      expect(await db.collection(CONTROL_COLLECTION).findOne({ _id: CONTROL_ID })).toMatchObject({ activeWrites: 1 });
      res.writableFinished = true;
      res.emit('finish');
      await new Promise(resolve => setImmediate(resolve));
      expect(await db.collection(CONTROL_COLLECTION).findOne({ _id: CONTROL_ID })).toMatchObject({ activeWrites: 0 });
    } finally {
      mongoose.connection.db = originalDb;
    }
  });

  test('retired owner-only migration fails closed without opening a database connection', async () => {
    const { migrateOwnership } = require('../scripts/migrateOwnership');
    await expect(migrateOwnership()).rejects.toThrow(/disabled/);
  });
});

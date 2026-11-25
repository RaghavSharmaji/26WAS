const mongoose = require('mongoose');
const User = require('../model/User');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const { validateMapping, makeReport, applyMapping, TENANT_COLLECTIONS } = require('../scripts/migrateCompanies');

const validMapping = () => ({
  companies: [{ id: '64b000000000000000000070', name: 'Example Co', slug: 'example-co' }],
  users: [{ userId: '64b000000000000000000071', companyId: '64b000000000000000000070', role: 'company_admin' }]
});

describe('company migration safety', () => {
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
      find: () => ({ project: () => ({ toArray: async () => [] }) }),
      findOne: async () => null,
      updateMany: jest.fn(), updateOne: jest.fn()
    };
    mongoose.connection.db = { collection: jest.fn(() => collection) };
    const existsSpy = jest.spyOn(User, 'exists').mockResolvedValue(true);
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
      existsSpy.mockRestore();
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
      find: () => ({ project: () => ({ toArray: async () => [] }) }),
      findOne: async () => null
    });
    mongoose.connection.db = { collection: jest.fn(name => collection(name)) };
    const existsSpy = jest.spyOn(User, 'exists').mockResolvedValue(true);
    const mapping = validMapping();
    const indexes = validateMapping(mapping);
    try {
      const report = await makeReport(mapping, indexes);
      expect(report.readyToApply).toBe(false);
      expect(report.duplicateKeys).toContainEqual(expect.objectContaining({ collection: 'items', count: 2, key: { skuNumber: 'SKU-1' } }));
    } finally {
      existsSpy.mockRestore();
      mongoose.connection.db = originalDb;
    }
  });

  test('explicit apply uses one transaction and preserves ownerId while scoping legacy rows', async () => {
    const originalDb = mongoose.connection.db;
    const collection = { updateMany: jest.fn().mockResolvedValue({}), updateOne: jest.fn().mockResolvedValue({}) };
    mongoose.connection.db = { collection: jest.fn(() => collection) };
    const companyUpdate = jest.spyOn(Company, 'updateOne').mockResolvedValue({});
    const membershipUpdate = jest.spyOn(CompanyMembership, 'updateOne').mockResolvedValue({});
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mapping = validMapping();
    const indexes = validateMapping(mapping);
    try {
      await applyMapping(mapping, indexes, { warehouseAssignmentsPlanned: [] });
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(companyUpdate).toHaveBeenCalledTimes(1);
      expect(membershipUpdate).toHaveBeenCalledTimes(1);
      expect(collection.updateMany).toHaveBeenCalledTimes(TENANT_COLLECTIONS.length);
      const [, update] = collection.updateMany.mock.calls[0];
      expect(update.$set.companyId).toEqual(new mongoose.Types.ObjectId(mapping.users[0].companyId));
      expect(update.$set.ownerId).toBeUndefined();
    } finally {
      startSession.mockRestore();
      companyUpdate.mockRestore();
      membershipUpdate.mockRestore();
      mongoose.connection.db = originalDb;
    }
  });
});

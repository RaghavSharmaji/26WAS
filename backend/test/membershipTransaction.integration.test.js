const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const integrationUri = process.env.WAREFLOW_M3_TEST_URI;
const describeIfLocalReplica = integrationUri ? describe : describe.skip;

if (integrationUri) {
  const parsedUri = new URL(integrationUri);
  if (parsedUri.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '::1'].includes(parsedUri.hostname)) {
    throw new Error('WAREFLOW_M3_TEST_URI must connect to a local loopback MongoDB only.');
  }
  if (!parsedUri.pathname.includes('wareflow_phase3_m3_test')) {
    throw new Error('WAREFLOW_M3_TEST_URI database name must include wareflow_phase3_m3_test.');
  }
}

process.env.SECRET_OR_KEY = process.env.SECRET_OR_KEY || 'phase3-membership-integration-test-secret';

const app = require('../server');
const User = require('../model/User');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const Warehouse = require('../model/Warehouse');
const AuditLog = require('../model/AuditLog');

describeIfLocalReplica('membership transactions on local MongoDB replica set', () => {
  let fixtures;
  let originalAuditCreate;
  let originalCompanyUpdate;

  beforeAll(async () => {
    await mongoose.connect(integrationUri, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([
      User.init(), Company.init(), CompanyMembership.init(), Warehouse.init(), AuditLog.init()
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(() => {
    fixtures = { users: [], companies: [], memberships: [], warehouses: [] };
    originalAuditCreate = AuditLog.create;
    originalCompanyUpdate = Company.updateOne;
  });

  afterEach(async () => {
    AuditLog.create = originalAuditCreate;
    Company.updateOne = originalCompanyUpdate;
    if (!fixtures) return;
    await Promise.all([
      AuditLog.deleteMany({ companyId: { $in: fixtures.companies } }),
      CompanyMembership.deleteMany({ _id: { $in: fixtures.memberships } }),
      Warehouse.deleteMany({ _id: { $in: fixtures.warehouses } }),
      Company.deleteMany({ _id: { $in: fixtures.companies } }),
      User.deleteMany({ _id: { $in: fixtures.users } })
    ]);
  });

  async function setup({ admins = 1, targetRole = 'warehouse_manager' } = {}) {
    const suffix = crypto.randomBytes(8).toString('hex');
    const company = await Company.create({ name: `Integration ${suffix}`, slug: `m3-${suffix}`, status: 'active' });
    fixtures.companies.push(company._id);
    const warehouse = await Warehouse.create({
      companyId: company._id, ownerId: new mongoose.Types.ObjectId(),
      name: `Warehouse ${suffix}`, code: suffix.slice(0, 8).toUpperCase(), active: true
    });
    const secondWarehouse = await Warehouse.create({
      companyId: company._id, ownerId: warehouse.ownerId,
      name: `Second Warehouse ${suffix}`, code: `S${suffix.slice(0, 7).toUpperCase()}`, active: true
    });
    fixtures.warehouses.push(warehouse._id, secondWarehouse._id);

    const users = await User.create(Array.from({ length: admins + 1 }, (_, index) => ({
      name: `Integration ${suffix} User ${index}`,
      email: `m3-${suffix}-${index}@example.test`, password: 'hashed-test-password',
      role: 'admin', accountStatus: 'active'
    })));
    fixtures.users.push(...users.map(user => user._id));

    const memberships = await CompanyMembership.create([
      ...users.slice(0, admins).map(user => ({
        userId: user._id, companyId: company._id, role: 'company_admin', status: 'active',
        assignedWarehouseIds: [warehouse._id], revision: 0
      })),
      {
        userId: users[admins]._id, companyId: company._id, role: targetRole, status: 'active',
        assignedWarehouseIds: [warehouse._id], revision: 0
      }
    ]);
    fixtures.memberships.push(...memberships.map(membership => membership._id));
    return { company, warehouse, secondWarehouse, users, memberships };
  }

  function auth(userId) {
    return `Bearer ${jwt.sign({ id: String(userId), role: 'admin' }, process.env.SECRET_OR_KEY)}`;
  }

  test('commits membership update and matching audit record together', async () => {
    const { company, warehouse, users, memberships } = await setup();
    const response = await request(app).patch(`/api/companies/${company._id}/members/${users[1]._id}`)
      .set('Authorization', auth(users[0]._id)).set('X-Company-Id', String(company._id))
      .send({ role: 'auditor', expectedRevision: 0, reason: 'Grant read-only audit access' });

    expect(response.status).toBe(200);
    const stored = await CompanyMembership.findById(memberships[1]._id).lean();
    expect(stored).toMatchObject({ role: 'auditor', status: 'active', revision: 1 });
    expect(stored.assignedWarehouseIds.map(String)).toEqual([String(warehouse._id)]);
    const audit = await AuditLog.findOne({ companyId: company._id, action: 'company.membership.updated' }).lean();
    expect(audit).toMatchObject({ actor: users[0]._id, targetUser: users[1]._id });
    expect(audit.details).toMatchObject({ reason: 'Grant read-only audit access', previousRole: 'warehouse_manager', newRole: 'auditor' });
  });

  test('rolls back membership update when audit insertion fails', async () => {
    const { company, users, memberships } = await setup();
    const create = AuditLog.create.bind(AuditLog);
    AuditLog.create = async (documents, options) => {
      if (documents?.[0]?.action === 'company.membership.updated') throw new Error('injected audit failure');
      return create(documents, options);
    };

    const response = await request(app).patch(`/api/companies/${company._id}/members/${users[1]._id}`)
      .set('Authorization', auth(users[0]._id)).set('X-Company-Id', String(company._id))
      .send({ role: 'auditor', expectedRevision: 0, reason: 'Audit failure rollback check' });

    expect(response.status).toBe(500);
    expect(await CompanyMembership.findById(memberships[1]._id).lean()).toMatchObject({ role: 'warehouse_manager', revision: 0 });
    expect(await AuditLog.countDocuments({ companyId: company._id, action: 'company.membership.updated' })).toBe(0);
  });

  test('rolls back and writes no membership audit when the actor account becomes inactive inside the transaction', async () => {
    const { company, users, memberships } = await setup();
    const updateCompany = Company.updateOne.bind(Company);
    Company.updateOne = async (filter, update, options) => {
      const result = await updateCompany(filter, update, options);
      if (String(filter?._id) === String(company._id) && update?.$inc?.membershipRevision) {
        await User.updateOne({ _id: users[0]._id }, { $set: { accountStatus: 'inactive' } }, { session: options.session });
      }
      return result;
    };

    const response = await request(app).patch(`/api/companies/${company._id}/members/${users[1]._id}`)
      .set('Authorization', auth(users[0]._id)).set('X-Company-Id', String(company._id))
      .send({ role: 'auditor', expectedRevision: 0, reason: 'Actor deactivation rollback test' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ACTOR_ACCOUNT_UNAVAILABLE');
    expect(await CompanyMembership.findById(memberships[1]._id).lean()).toMatchObject({ role: 'warehouse_manager', revision: 0 });
    expect(await AuditLog.countDocuments({ companyId: company._id, action: 'company.membership.updated' })).toBe(0);
    expect(await User.findById(users[0]._id).select('accountStatus').lean()).toMatchObject({ accountStatus: 'active' });
  });

  test('concurrent attempts to remove the last two active Company Admins leave one active', async () => {
    const { company, users, memberships } = await setup({ admins: 2 });
    const attempts = await Promise.all([
      request(app).delete(`/api/companies/${company._id}/members/${users[1]._id}`)
        .set('Authorization', auth(users[0]._id)).set('X-Company-Id', String(company._id))
        .send({ expectedRevision: 0, reason: 'Concurrent administrator removal test' }),
      request(app).delete(`/api/companies/${company._id}/members/${users[0]._id}`)
        .set('Authorization', auth(users[1]._id)).set('X-Company-Id', String(company._id))
        .send({ expectedRevision: 0, reason: 'Concurrent administrator removal test' })
    ]);

    expect(attempts.filter(result => result.status === 200)).toHaveLength(1);
    const activeAdmins = await CompanyMembership.countDocuments({ companyId: company._id, role: 'company_admin', status: 'active' });
    expect(activeAdmins).toBe(1);
    expect(await CompanyMembership.countDocuments({ _id: { $in: memberships.slice(0, 2).map(row => row._id) }, status: 'inactive' })).toBe(1);
  });

  test('concurrent updates using one stale revision permit one change and reject the other', async () => {
    const { company, users, memberships } = await setup({ admins: 2 });
    const targetId = users[2]._id;
    const attempts = await Promise.all([
      request(app).patch(`/api/companies/${company._id}/members/${targetId}`)
        .set('Authorization', auth(users[0]._id)).set('X-Company-Id', String(company._id))
        .send({ role: 'auditor', expectedRevision: 0, reason: 'Concurrent stale revision test' }),
      request(app).patch(`/api/companies/${company._id}/members/${targetId}`)
        .set('Authorization', auth(users[1]._id)).set('X-Company-Id', String(company._id))
        .send({ assignedWarehouseIds: [String(fixtures.warehouses[1])], expectedRevision: 0, reason: 'Concurrent stale revision test' })
    ]);

    expect(attempts.filter(result => result.status === 200)).toHaveLength(1);
    expect(attempts.filter(result => result.status === 409)).toHaveLength(1);
    expect(await CompanyMembership.findById(memberships[2]._id).lean()).toMatchObject({ revision: 1 });
  });
});

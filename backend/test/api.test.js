process.env.SECRET_OR_KEY = 'unit-test-secret-that-is-long-enough';
const mongoose = require('mongoose');
const { createTestDb } = require('./helpers/writeFreezeTestDb');
const { acquireMigrationWriteFreeze, releaseMigrationWriteFreeze } = require('../middleware/migrationWriteFreeze');

jest.mock('../model/User', () => ({ create: jest.fn(), find: jest.fn(), findById: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../model/Company', () => ({ create: jest.fn(), find: jest.fn(), findById: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(), countDocuments: jest.fn(), updateOne: jest.fn(), exists: jest.fn(), collection: { indexes: jest.fn() } }));
jest.mock('../model/CompanyMembership', () => ({ create: jest.fn(), find: jest.fn(), findOne: jest.fn(), updateOne: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../model/AuditLog', () => ({ create: jest.fn() }));
jest.mock('../model/Category', () => ({
  create: jest.fn(), find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), exists: jest.fn(), aggregate: jest.fn()
}));
jest.mock('../model/Supplier', () => ({
  create: jest.fn(), find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), exists: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn()
}));
jest.mock('../model/Warehouse', () => ({
  create: jest.fn(), find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), exists: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn()
}));
jest.mock('../model/Location', () => ({
  create: jest.fn(), find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), exists: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn()
}));
jest.mock('../model/Item', () => {
  const MockItem = jest.fn(function mockItem(data) {
    Object.assign(this, data);
    this.save = jest.fn().mockResolvedValue(this);
  });
  Object.assign(MockItem, {
    create: jest.fn(), find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(),
    countDocuments: jest.fn(), exists: jest.fn(), aggregate: jest.fn()
  });
  return MockItem;
});
jest.mock('../model/Order', () => {
  const MockOrder = jest.fn(function mockOrder(data) {
    Object.assign(this, data);
    this.save = jest.fn().mockResolvedValue(this);
  });
  Object.assign(MockOrder, {
    create: jest.fn(), find: jest.fn(), findOne: jest.fn(), findById: jest.fn(),
    findByIdAndUpdate: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn()
  });
  return MockOrder;
});
jest.mock('../model/Product', () => {
  const MockProduct = jest.fn(function mockProduct(data) {
    Object.assign(this, data);
    this._id = new (jest.requireActual('mongoose').Types.ObjectId)();
    this.save = jest.fn().mockResolvedValue(this);
  });
  Object.assign(MockProduct, { find: jest.fn(), findOne: jest.fn(), create: jest.fn() });
  return MockProduct;
});
jest.mock('../model/Ticket', () => {
  const MockTicket = jest.fn(function mockTicket(data) {
    Object.assign(this, data);
    this._id = new (jest.requireActual('mongoose').Types.ObjectId)();
    this.save = jest.fn().mockResolvedValue(this);
  });
  Object.assign(MockTicket, { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), countDocuments: jest.fn() });
  return MockTicket;
});
jest.mock('../model/Pallets', () => ({
  create: jest.fn(), find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), aggregate: jest.fn(),
  findOneAndUpdate: jest.fn(), aggregate: jest.fn(), exists: jest.fn(),
  STATUS_VALUES: ['receiving', 'received', 'r/p', 'store', 'picked', 'damaged']
}));
jest.mock('../services/inventoryService', () => ({
  changePalletStock: jest.fn(), receivePalletStock: jest.fn(), adjustPalletStock: jest.fn(),
  receiveNewPallet: jest.fn(), deductPalletStockBatch: jest.fn()
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../server');
const User = require('../model/User');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const AuditLog = require('../model/AuditLog');
const Category = require('../model/Category');
const Supplier = require('../model/Supplier');
const Item = require('../model/Item');
const Order = require('../model/Order');
const Product = require('../model/Product');
const Ticket = require('../model/Ticket');
const Pallet = require('../model/Pallets');
const Warehouse = require('../model/Warehouse');
const Location = require('../model/Location');
const inventoryService = require('../services/inventoryService');

const staffId = '64b000000000000000000001';
const adminId = '64b000000000000000000002';
const tokenFor = (id, role) => jwt.sign({ id, role }, process.env.SECRET_OR_KEY);
const queryFor = value => {
  const query = {
    select: () => query,
    session: () => query,
    populate: () => query,
    lean: async () => value,
    exec: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return query;
};
function mockActiveActorTransaction(userId, role = 'admin') {
  const actor = { _id: userId, role, accountStatus: 'active', deletedAt: null };
  const transactionQuery = {
    select: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(actor)
  };
  User.findById.mockImplementationOnce(async () => actor)
    .mockImplementationOnce(() => transactionQuery);
  return transactionQuery;
}
const queryWithExec = value => {
  const query = {
    select: () => query,
    session: () => query,
    sort: () => query,
    lean: () => query,
    exec: async () => value,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject)
  };
  return query;
};

beforeEach(() => {
  jest.clearAllMocks();
  mongoose.connection.db = createTestDb();
  CompanyMembership.findOne.mockReset();
  CompanyMembership.find.mockReturnValue({ select: () => ({ lean: async () => [] }) });
});

describe('authentication and resource APIs', () => {
  const validCompanyApplication = () => ({
    company: {
      legalName: 'Northwind Trading Private Limited', displayName: 'Northwind Trading', businessType: 'private_limited',
      industry: 'wholesale', email: 'company@northwind.example', phone: '+919876543210', country: 'India',
      state: 'Maharashtra', city: 'Mumbai', address: '100 Warehouse Road', postalCode: '400001',
      website: 'https://northwind.example', gstin: '27ABCDE1234F1Z5', pan: 'ABCDE1234F', cin: '', businessRegistrationNumber: ''
    },
    administrator: { name: 'Avery Admin', designation: 'Operations Director', email: 'avery@northwind.example', phone: '9876543210', password: 'StrongPass123!', confirmPassword: 'StrongPass123!' },
    warehouseRequirements: { expectedWarehouses: 2, approximateSkus: 500, monthlyOrders: 1200, employees: 20, primaryWarehouseName: 'Mumbai Main', primaryWarehouseType: 'distribution', primaryWarehouseAddress: '100 Warehouse Road', currency: 'INR', timeZone: 'Asia/Kolkata', measurementUnits: 'metric' },
    acceptance: { terms: true, privacy: true, accuracy: true }
  });
  const enableRegistrationIndexes = () => Company.collection.indexes.mockResolvedValue([
    ...['registration.reference', 'registration.companyEmail', 'registration.administrator.email', 'registration.gstin', 'registration.pan', 'registration.cin', 'registration.businessRegistrationNumber']
      .map(field => ({ key: { [field]: 1 }, unique: true, sparse: true }))
  ]);

  describe('public company registration', () => {
    test('creates a pending company, canonical Company Admin membership, and audit event atomically', async () => {
      enableRegistrationIndexes();
      User.findOne.mockReturnValue(queryFor(null));
      Company.findOne.mockReturnValue(queryFor(null));
      Company.findOne.mockReturnValue(queryFor(null));
      User.create.mockImplementation(async ([row]) => [{ ...row, _id: new mongoose.Types.ObjectId() }]);
      Company.create.mockImplementation(async ([row]) => [{ ...row, _id: new mongoose.Types.ObjectId() }]);
      CompanyMembership.create.mockResolvedValue([{}]);
      AuditLog.create.mockResolvedValue([{}]);
      const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      try {
        const response = await request(app).post('/api/companies/register').send(validCompanyApplication());
        expect(response.status).toBe(201);
        expect(response.body.data).toMatchObject({ companyName: 'Northwind Trading', status: 'pending' });
        expect(response.body.data.reference).toMatch(/^WF-[A-F0-9]{16}$/);
        expect(User.create.mock.calls[0][0][0]).toMatchObject({ role: 'staff', accountStatus: 'active', emailVerificationStatus: 'pending' });
        expect(User.create.mock.calls[0][1]).toEqual({ session });
        expect(User.create.mock.calls[0][0][0].password).not.toBe('StrongPass123!');
        expect(Company.create.mock.calls[0][0][0]).toMatchObject({ status: 'pending', registration: { status: 'pending', emailVerificationStatus: 'pending' } });
        expect(CompanyMembership.create.mock.calls[0][0][0]).toMatchObject({ role: 'company_admin', status: 'active', revision: 0 });
        expect(CompanyMembership.create.mock.calls[0][1]).toEqual({ session });
        expect(AuditLog.create.mock.calls[0][0][0].action).toBe('company.registration.submitted');
        expect(AuditLog.create.mock.calls[0][1]).toEqual({ session });
        expect(session.endSession).toHaveBeenCalled();
      } finally { startSession.mockRestore(); }
    });

    test.each([
      ['weak password', body => { body.administrator.password = body.administrator.confirmPassword = 'weak'; }],
      ['missing required company information', body => { body.company.legalName = ''; }],
      ['password mismatch', body => { body.administrator.confirmPassword = 'DifferentStrong123!'; }],
      ['invalid company email', body => { body.company.email = 'not-an-email'; }],
      ['invalid administrator phone', body => { body.administrator.phone = 'phone'; }],
      ['role escalation payload', body => { body.role = 'super_admin'; }],
      ['administrator role escalation', body => { body.administrator.role = 'super_admin'; }],
      ['caller company ID payload', body => { body.companyId = '64b000000000000000000099'; }],
      ['active tenant payload', body => { body.company.status = 'active'; }],
      ['caller ownership payload', body => { body.ownerId = staffId; }],
      ['missing terms acceptance', body => { body.acceptance.terms = false; }],
      ['invalid PAN', body => { body.company.pan = 'not-a-pan'; }]
    ])('rejects unsafe registration input (%s)', async (_label, mutate) => {
      const body = validCompanyApplication(); mutate(body);
      User.findOne.mockReturnValue(queryFor(null));
      Company.findOne.mockReturnValue(queryFor(null));
      const response = await request(app).post('/api/companies/register').send(body);
      expect(response.status).toBe(400);
      expect(User.create).not.toHaveBeenCalled();
      expect(Company.create).not.toHaveBeenCalled();
    });

    test('prevents duplicate applicant accounts without modifying existing access', async () => {
      enableRegistrationIndexes();
      User.findOne.mockReturnValue(queryFor({ _id: staffId }));
      const response = await request(app).post('/api/companies/register').send(validCompanyApplication());
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ACCOUNT_ALREADY_EXISTS');
      expect(User.create).not.toHaveBeenCalled();
      expect(Company.create).not.toHaveBeenCalled();
    });

    test.each(['company email', 'GSTIN', 'PAN'])('blocks duplicate %s registrations', async kind => {
      const body = validCompanyApplication();
      enableRegistrationIndexes();
      User.findOne.mockReturnValue(queryFor(null));
      Company.findOne.mockReturnValue(queryFor({ _id: '64b000000000000000000020' }));
      const response = await request(app).post('/api/companies/register').send(body);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('DUPLICATE_COMPANY_REGISTRATION');
      expect(User.create).not.toHaveBeenCalled();
      expect(Company.create).not.toHaveBeenCalled();
    });

    test('fails closed when the reviewed uniqueness indexes are not deployed', async () => {
      Company.collection.indexes.mockResolvedValue([]);
      const response = await request(app).post('/api/companies/register').send(validCompanyApplication());
      expect(response.status).toBe(503);
      expect(response.body.code).toBe('REGISTRATION_INDEXES_NOT_READY');
      expect(User.create).not.toHaveBeenCalled();
      expect(Company.create).not.toHaveBeenCalled();
    });

    test('rejects unauthenticated registration status requests', async () => {
      const response = await request(app).get('/api/companies/registration/status');
      expect(response.status).toBe(401);
      expect(Company.find).not.toHaveBeenCalled();
    });
  });

  const activeCompanyId = '64b000000000000000000022';
  const setMembership = (role, status = 'active') => {
    CompanyMembership.find.mockReturnValue({ select: () => ({ lean: async () => [{
      _id: '64b000000000000000000023', companyId: activeCompanyId, role, status, assignedWarehouseIds: []
    }] }) });
    Company.findById.mockReturnValue({ select: () => ({ lean: async () => ({
      _id: activeCompanyId, name: 'Test Co', slug: 'test-co', status: 'active'
    }) }) });
  };

  test('rejects protected requests without a token', async () => {
    const response = await request(app).get('/api/categories');
    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/authentication required/i);
  });

  test('legacy order routes require authentication and reject an unverified company switch', async () => {
    const anonymous = await request(app).get('/api/order');
    expect(anonymous.status).toBe(401);
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const switched = await request(app).get('/api/order')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
      .set('X-Company-Id', '64b000000000000000000099');
    expect(switched.status).toBe(403);
    expect(switched.body.code).toBe('COMPANY_MEMBERSHIP_REQUIRED');
  });

  test('authenticated user creates a company and receives Company Admin membership', async () => {
    const mongoose = require('mongoose');
    const companyId = '64b000000000000000000020';
    const company = { _id: companyId, name: 'Northwind', slug: 'northwind', status: 'pending' };
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    mockActiveActorTransaction(staffId, 'staff');
    Company.create.mockResolvedValue([company]);
    CompanyMembership.create.mockResolvedValue([{ _id: '64b000000000000000000021' }]);
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const response = await request(app).post('/api/companies')
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
        .send({ name: 'Northwind', slug: 'Northwind' });
      expect(response.status).toBe(201);
      expect(response.body.data.name).toBe('Northwind');
      expect(response.body.data.role).toBe('company_admin');
      expect(CompanyMembership.create.mock.calls[0][0][0]).toMatchObject({ userId: staffId, role: 'company_admin', status: 'active' });
    } finally {
      startSession.mockRestore();
    }
  });

  test('company selection identifies a pending company as awaiting platform activation', async () => {
    const companyId = '64b000000000000000000020';
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    CompanyMembership.findOne.mockReturnValue({ lean: async () => ({ _id: '64b000000000000000000021', role: 'company_admin', status: 'active' }) });
    Company.findById.mockReturnValue({ select: () => ({ lean: async () => ({ _id: companyId, name: 'Northwind', status: 'pending' }) }) });
    const response = await request(app).post(`/api/companies/${companyId}/select`)
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('COMPANY_PENDING');
    expect(response.body.message).toMatch(/awaiting activation/i);
  });

  describe('Super Admin company activation', () => {
    const companyId = '64b000000000000000000020';
    const platformId = '64b000000000000000000098';
    const pendingCompany = { _id: companyId, name: 'Northwind', slug: 'northwind', status: 'pending', createdAt: new Date('2026-01-01T00:00:00Z') };
    const activeCompany = { ...pendingCompany, status: 'active', updatedAt: new Date('2026-01-02T00:00:00Z') };
    const activationPath = `/api/admin/companies/${companyId}/activate`;
    const transactionSession = () => ({ withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() });
    const authorizePlatformRequest = (role = 'super_admin') => {
      const actorQuery = mockActiveActorTransaction(platformId, role);
      return actorQuery;
    };

    test.each(['super_admin', 'superadmin'])('%s activates a pending company and atomically audits actor, company, statuses and reason', async platformRole => {
      const session = transactionSession();
      const actorQuery = authorizePlatformRequest(platformRole);
      Company.findById.mockReturnValue(queryFor(pendingCompany));
      Company.findOneAndUpdate.mockReturnValue(queryFor(activeCompany));
      AuditLog.create.mockResolvedValue([{}]);
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      try {
        const response = await request(app).post(activationPath)
          .set('Authorization', `Bearer ${tokenFor(platformId, platformRole)}`)
          .send({ reason: 'Company verification completed' });
        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({ id: companyId, status: 'active' });
        expect(Company.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: companyId, status: 'pending' }, { $set: { status: 'active' } },
          { new: true, runValidators: true, session }
        );
        expect(AuditLog.create).toHaveBeenCalledWith([expect.objectContaining({
          companyId, actor: platformId, action: 'admin.company.activated',
          details: { companyId, previousStatus: 'pending', newStatus: 'active', reason: 'Company verification completed' },
          createdAt: expect.any(Date)
        })], { session });
        expect(actorQuery.session).toHaveBeenCalledWith(session);
        expect(session.endSession).toHaveBeenCalled();
      } finally { startSession.mockRestore(); }
    });

    test('Super Admin can list companies with status and search filters', async () => {
      User.findById.mockResolvedValue({ _id: platformId, role: 'super_admin', accountStatus: 'active' });
      const findQuery = {
        sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([pendingCompany])
      };
      Company.find.mockReturnValue(findQuery);
      Company.countDocuments.mockResolvedValue(1);
      const response = await request(app).get('/api/admin/companies')
        .set('Authorization', `Bearer ${tokenFor(platformId, 'super_admin')}`)
        .query({ status: 'pending', search: 'Northwind', page: 1, limit: 25 });
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({ id: companyId, status: 'pending', slug: 'northwind' });
      expect(Company.find).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', $or: expect.any(Array) }));
      expect(findQuery.sort).toHaveBeenCalledWith({ createdAt: -1, _id: 1 });
    });

    test('Super Admin registration review is transactional, reasoned, and audited', async () => {
      const session = transactionSession();
      const actorQuery = authorizePlatformRequest('super_admin');
      const registrationCompany = { ...pendingCompany, registration: { reference: 'WF-1234', status: 'pending', applicantUserId: staffId } };
      const reviewedCompany = { ...registrationCompany, registration: { ...registrationCompany.registration, status: 'verified', reviewedAt: new Date('2026-02-01T00:00:00Z') } };
      Company.findById.mockReturnValue(queryFor(registrationCompany));
      Company.findOneAndUpdate.mockReturnValue(queryFor(reviewedCompany));
      AuditLog.create.mockResolvedValue([{}]);
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      try {
        const response = await request(app).post(`/api/admin/companies/${companyId}/registration/review`)
          .set('Authorization', `Bearer ${tokenFor(platformId, 'super_admin')}`)
          .send({ status: 'verified', reason: 'Business details reviewed' });
        expect(response.status).toBe(200);
        expect(Company.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: companyId, 'registration.status': 'pending' },
          { $set: expect.objectContaining({ 'registration.status': 'verified', 'registration.reviewedBy': platformId, 'registration.reviewReason': 'Business details reviewed' }) },
          { new: true, runValidators: true, session }
        );
        expect(AuditLog.create).toHaveBeenCalledWith([expect.objectContaining({
          action: 'admin.company.registration.verified', targetUser: staffId,
          details: { reference: 'WF-1234', previousStatus: 'pending', newStatus: 'verified', reason: 'Business details reviewed' }
        })], { session });
        expect(actorQuery.session).toHaveBeenCalledWith(session);
      } finally { startSession.mockRestore(); }
    });

    test('new application cannot activate until registration is verified', async () => {
      const session = transactionSession();
      authorizePlatformRequest('super_admin');
      Company.findById.mockReturnValue(queryFor({ ...pendingCompany, registration: { status: 'under_review' } }));
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      try {
        const response = await request(app).post(activationPath)
          .set('Authorization', `Bearer ${tokenFor(platformId, 'super_admin')}`)
          .send({ reason: 'Reviewed' });
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('REGISTRATION_NOT_VERIFIED');
        expect(Company.findOneAndUpdate).not.toHaveBeenCalled();
        expect(AuditLog.create).not.toHaveBeenCalled();
      } finally { startSession.mockRestore(); }
    });

    test('Company Admin cannot review an application or see its private details', async () => {
      User.findById.mockResolvedValue({ _id: adminId, role: 'staff', accountStatus: 'active', deletedAt: null });
      const token = `Bearer ${tokenFor(adminId, 'staff')}`;
      const detail = await request(app).get(`/api/admin/companies/${companyId}/registration`).set('Authorization', token);
      const review = await request(app).post(`/api/admin/companies/${companyId}/registration/review`)
        .set('Authorization', token).send({ status: 'verified', reason: 'Attempted bypass' });
      expect(detail.status).toBe(403);
      expect(review.status).toBe(403);
      expect(Company.findById).not.toHaveBeenCalled();
      expect(Company.findOneAndUpdate).not.toHaveBeenCalled();
      expect(AuditLog.create).not.toHaveBeenCalled();
    });

    test.each(['company_admin', 'warehouse_manager', 'inventory_manager', 'procurement_manager', 'warehouse_staff', 'staff', 'auditor', 'admin'])(
      '%s cannot access platform company activation', async role => {
        User.findById.mockResolvedValue({ _id: staffId, role, accountStatus: 'active', deletedAt: null });
        const response = await request(app).post(activationPath)
          .set('Authorization', `Bearer ${tokenFor(staffId, role)}`)
          .send({ reason: 'Not an administrator' });
        expect(response.status).toBe(403);
        expect(Company.findOneAndUpdate).not.toHaveBeenCalled();
        const listing = await request(app).get('/api/admin/companies')
          .set('Authorization', `Bearer ${tokenFor(staffId, role)}`);
        expect(listing.status).toBe(403);
        expect(Company.find).not.toHaveBeenCalled();
        expect(AuditLog.create).not.toHaveBeenCalled();
      }
    );

    test('rejects an unauthenticated activation request', async () => {
      const response = await request(app).post(activationPath).send({ reason: 'No actor' });
      expect(response.status).toBe(401);
      expect(Company.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('revalidates active Super Admin identity inside the transaction', async () => {
      const session = transactionSession();
      const initialActor = { _id: platformId, role: 'super_admin', accountStatus: 'active', deletedAt: null };
      const staleActorQuery = {
        select: jest.fn().mockReturnThis(), session: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue({ ...initialActor, accountStatus: 'inactive' })
      };
      User.findById.mockResolvedValueOnce(initialActor).mockReturnValueOnce(staleActorQuery);
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const response = await request(app).post(activationPath)
          .set('Authorization', `Bearer ${tokenFor(platformId, 'super_admin')}`)
          .send({ reason: 'Reviewed' });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('SUPER_ADMIN_REQUIRED');
        expect(staleActorQuery.session).toHaveBeenCalledWith(session);
        expect(Company.findById).not.toHaveBeenCalled();
        expect(Company.findOneAndUpdate).not.toHaveBeenCalled();
        expect(AuditLog.create).not.toHaveBeenCalled();
      } finally { startSession.mockRestore(); errorLog.mockRestore(); }
    });

    test.each([undefined, '', '   '])('requires a non-empty activation reason (%s)', async reason => {
      User.findById.mockResolvedValue({ _id: platformId, role: 'super_admin', accountStatus: 'active' });
      const response = await request(app).post(activationPath)
        .set('Authorization', `Bearer ${tokenFor(platformId, 'super_admin')}`)
        .send(reason === undefined ? {} : { reason });
      expect(response.status).toBe(400);
      expect(Company.findOneAndUpdate).not.toHaveBeenCalled();
      expect(AuditLog.create).not.toHaveBeenCalled();
    });

    test('rejects caller-supplied privileged fields', async () => {
      User.findById.mockResolvedValue({ _id: platformId, role: 'super_admin', accountStatus: 'active' });
      const response = await request(app).post(activationPath)
        .set('Authorization', `Bearer ${tokenFor(platformId, 'super_admin')}`)
        .send({ reason: 'Reviewed', status: 'active', ownerId: staffId });
      expect(response.status).toBe(400);
      expect(Company.findOneAndUpdate).not.toHaveBeenCalled();
    });

    test('rejects a nonexistent company without writing an audit record', async () => {
      const session = transactionSession();
      authorizePlatformRequest();
      Company.findById.mockReturnValue(queryFor(null));
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const response = await request(app).post(activationPath)
          .set('Authorization', `Bearer ${tokenFor(platformId, 'super_admin')}`)
          .send({ reason: 'Reviewed' });
        expect(response.status).toBe(404);
        expect(response.body.code).toBe('COMPANY_NOT_FOUND');
        expect(AuditLog.create).not.toHaveBeenCalled();
      } finally { startSession.mockRestore(); errorLog.mockRestore(); }
    });

    test.each(['active', 'suspended', 'deactivated', 'unknown'])('rejects a company in %s state', async status => {
      const session = transactionSession();
      authorizePlatformRequest();
      Company.findById.mockReturnValue(queryFor({ ...pendingCompany, status }));
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const response = await request(app).post(activationPath)
          .set('Authorization', `Bearer ${tokenFor(platformId, 'super_admin')}`)
          .send({ reason: 'Reviewed' });
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('COMPANY_STATUS_CONFLICT');
        expect(Company.findOneAndUpdate).not.toHaveBeenCalled();
        expect(AuditLog.create).not.toHaveBeenCalled();
      } finally { startSession.mockRestore(); errorLog.mockRestore(); }
    });

    test('does not report success or retain an audit event when audit insertion fails', async () => {
      const session = transactionSession();
      let transactionAborted = false;
      let committed = false;
      session.withTransaction.mockImplementation(async callback => {
        try {
          const result = await callback();
          committed = true;
          return result;
        } catch (error) {
          transactionAborted = true;
          throw error;
        }
      });
      authorizePlatformRequest();
      Company.findById.mockReturnValue(queryFor(pendingCompany));
      Company.findOneAndUpdate.mockReturnValue(queryFor(activeCompany));
      AuditLog.create.mockRejectedValue(new Error('audit store unavailable'));
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const response = await request(app).post(activationPath)
          .set('Authorization', `Bearer ${tokenFor(platformId, 'super_admin')}`)
          .send({ reason: 'Reviewed' });
        expect(response.status).toBe(500);
        expect(transactionAborted).toBe(true);
        expect(committed).toBe(false);
        expect(AuditLog.create).toHaveBeenCalledTimes(1);
        expect(session.endSession).toHaveBeenCalled();
      } finally { startSession.mockRestore(); errorLog.mockRestore(); }
    });

    test('activation does not grant Super Admin access to company operational APIs', async () => {
      const session = transactionSession();
      authorizePlatformRequest('superadmin');
      Company.findById.mockReturnValue(queryFor(pendingCompany));
      Company.findOneAndUpdate.mockReturnValue(queryFor(activeCompany));
      AuditLog.create.mockResolvedValue([{}]);
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      try {
        const activation = await request(app).post(activationPath)
          .set('Authorization', `Bearer ${tokenFor(platformId, 'superadmin')}`)
          .send({ reason: 'Reviewed' });
        expect(activation.status).toBe(200);
        User.findById.mockResolvedValue({ _id: platformId, role: 'superadmin', accountStatus: 'active' });
        const operational = await request(app).get('/api/products')
          .set('Authorization', `Bearer ${tokenFor(platformId, 'superadmin')}`);
        expect(operational.status).toBe(403);
      } finally { startSession.mockRestore(); }
    });

    test('authorized Company Admin can select a company after activation', async () => {
      User.findById.mockResolvedValue({ _id: staffId, role: 'staff', accountStatus: 'active' });
      CompanyMembership.findOne.mockReturnValue(queryFor({ _id: '64b000000000000000000021', role: 'company_admin', status: 'active' }));
      Company.findById.mockReturnValue({ select: () => queryFor(activeCompany) });
      const response = await request(app).post(`/api/companies/${companyId}/select`)
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe('active');
      expect(response.body.data.role).toBe('company_admin');
    });
  });

  test('registration status returns only safe details for the authenticated applicant', async () => {
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    Company.find.mockReturnValue({
      select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: '64b000000000000000000020', name: 'Northwind', status: 'pending',
        registration: { applicantUserId: staffId, reference: 'WF-12345678', status: 'under_review', submittedAt: new Date(), reviewedAt: new Date(), reviewReason: 'Please clarify address', emailVerificationStatus: 'pending', gstin: 'SENSITIVE', administrator: { email: 'secret@example.com' } }
      }])
    });
    const response = await request(app).get('/api/companies/registration/status')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ reference: 'WF-12345678', status: 'under_review', feedback: 'Please clarify address' });
    expect(Company.find).toHaveBeenCalledWith({ 'registration.applicantUserId': staffId });
    expect(JSON.stringify(response.body)).not.toContain('SENSITIVE');
    expect(JSON.stringify(response.body)).not.toContain('secret@example.com');
  });

  test('warehouse staff cannot change Company Admin onboarding or company preferences', async () => {
    setMembership('warehouse_staff');
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff', accountStatus: 'active' });
    const token = `Bearer ${tokenFor(staffId, 'staff')}`;
    const onboarding = await request(app).patch(`/api/companies/${activeCompanyId}/onboarding`)
      .set('Authorization', token).set('X-Company-Id', activeCompanyId)
      .send({ step: 'roles', action: 'complete' });
    const settings = await request(app).patch(`/api/companies/${activeCompanyId}/settings`)
      .set('Authorization', token).set('X-Company-Id', activeCompanyId)
      .send({ currency: 'USD', timeZone: 'UTC', measurementUnits: 'imperial' });
    expect(onboarding.status).toBe(403);
    expect(settings.status).toBe(403);
    expect(Company.updateOne).not.toHaveBeenCalled();
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  test('Company Admin can add an existing user with a tenant role', async () => {
    const mongoose = require('mongoose');
    const companyId = '64b000000000000000000022';
    const warehouseId = '64b000000000000000000030';
    const secondWarehouseId = '64b000000000000000000031';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'staff' });
    mockActiveActorTransaction(adminId, 'admin');
    User.findOne.mockImplementation(() => ({
      select: () => ({
        session: () => ({ lean: async () => ({ _id: staffId }) }),
        lean: async () => ({ _id: staffId, name: 'Warehouse Staff', email: 'staff@example.com', accountStatus: 'active' })
      })
    }));
    Company.updateOne.mockResolvedValue({ matchedCount: 1 });
    CompanyMembership.findOne.mockReturnValue({
      lean: async () => ({ role: 'company_admin', status: 'active' }),
      session: () => ({ lean: async () => ({ role: 'company_admin', status: 'active' }) })
    });
    CompanyMembership.create.mockResolvedValue([{ _id: '64b000000000000000000023', role: 'warehouse_manager', status: 'active', assignedWarehouseIds: [] }]);
    Warehouse.countDocuments.mockReturnValue({ session: () => ({ exec: async () => 2 }), exec: async () => 2 });
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const response = await request(app).post(`/api/companies/${companyId}/members`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
        .set('X-Company-Id', companyId)
        .send({ email: 'staff@example.com', role: 'warehouse_manager', assignedWarehouseIds: [warehouseId, secondWarehouseId], reason: 'Initial warehouse access' });
      expect(response.status).toBe(201);
      expect(response.body.data.role).toBe('warehouse_manager');
      expect(CompanyMembership.create.mock.calls[0][0][0]).toMatchObject({
        companyId, userId: staffId, role: 'warehouse_manager', assignedWarehouseIds: [warehouseId, secondWarehouseId]
      });
      expect(AuditLog.create).toHaveBeenCalledWith([expect.objectContaining({
        action: 'company.membership.created', actor: adminId, targetUser: staffId, companyId,
        details: expect.objectContaining({ actorUserId: adminId, targetUserId: staffId, reason: 'Initial warehouse access', newRole: 'warehouse_manager', newStatus: 'active' })
      })], { session });
    } finally { startSession.mockRestore(); }
  });

  test('Company Admin permission overrides update memberships transactionally and create an audit entry', async () => {
    const mongoose = require('mongoose');
    const companyId = activeCompanyId;
    const targetId = '64b000000000000000000099';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    mockActiveActorTransaction(adminId, 'admin');
    Company.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const currentTarget = {
      _id: '64b000000000000000000098', userId: targetId, companyId,
      role: 'warehouse_staff', status: 'active', assignedWarehouseIds: [], permissionOverrides: [], revision: 0
    };
    let membershipReads = 0;
    CompanyMembership.findOne.mockImplementation(() => {
      membershipReads += 1;
      const row = membershipReads === 1
        ? { role: 'company_admin', status: 'active', revision: 0 }
        : membershipReads === 2
          ? currentTarget
          : { ...currentTarget, permissionOverrides: [{ permission: 'inventory.adjust', effect: 'allow' }], revision: 1 };
      const query = { session: () => query, lean: async () => row, then: (resolve, reject) => Promise.resolve(row).then(resolve, reject) };
      return query;
    });
    CompanyMembership.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const response = await request(app).patch(`/api/companies/${companyId}/members/${targetId}/permissions`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
        .set('X-Company-Id', companyId)
        .send({
          expectedRevision: 0,
          reason: 'Authorize approved cycle-count adjustments',
          permissionOverrides: [{ permission: 'inventory.adjust', effect: 'allow' }]
        });
      expect(response.status).toBe(200);
      expect(CompanyMembership.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ companyId, userId: targetId, status: 'active' }),
        { $set: { permissionOverrides: [{ permission: 'inventory.adjust', effect: 'allow' }] }, $inc: { revision: 1 } },
        expect.objectContaining({ session, runValidators: true })
      );
      expect(AuditLog.create).toHaveBeenCalledWith([expect.objectContaining({
        action: 'company.membership.permissions-updated', actor: adminId, targetUser: targetId,
        details: expect.objectContaining({ reason: 'Authorize approved cycle-count adjustments' })
      })], { session });
    } finally { startSession.mockRestore(); }
  });

  test('role permission overrides allow grants and make explicit deny win over role defaults', async () => {
    const companyId = activeCompanyId;
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    CompanyMembership.find.mockReturnValue({ select: () => ({ lean: async () => [{
      _id: '64b000000000000000000023', companyId, role: 'warehouse_staff', status: 'active',
      assignedWarehouseIds: [], permissionOverrides: [{ permission: 'inventory.adjust', effect: 'allow' }]
    }] }) });
    const granted = await request(app).post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`).send({});
    expect(granted.status).toBe(400); // Passed permission middleware; request body then failed inventory validation.

    CompanyMembership.find.mockReturnValue({ select: () => ({ lean: async () => [{
      _id: '64b000000000000000000023', companyId, role: 'company_admin', status: 'active',
      assignedWarehouseIds: [], permissionOverrides: [{ permission: 'inventory.adjust', effect: 'deny' }]
    }] }) });
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    const denied = await request(app).post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).send({});
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('PERMISSION_REQUIRED');
  });

  test('warehouse staff cannot create catalog products without the product permission', async () => {
    setMembership('warehouse_staff');
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const response = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
      .set('X-Company-Id', activeCompanyId)
      .send({ name: 'Restricted product', skuNumber: 'RESTRICTED-1', department: 'Test', size: 1 });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PERMISSION_REQUIRED');
    expect(Product.create).not.toHaveBeenCalled();
  });

  test('permission override endpoint rejects unknown IDs and wildcard grants', async () => {
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    const response = await request(app).patch(`/api/companies/${activeCompanyId}/members/${staffId}/permissions`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
      .set('X-Company-Id', activeCompanyId)
      .send({ expectedRevision: 0, reason: 'Test input validation', permissionOverrides: [{ permission: '*', effect: 'allow' }] });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/known permission ID/i);
    expect(CompanyMembership.updateOne).not.toHaveBeenCalled();
  });

  test('membership creation rejects unsupported roles and unavailable accounts before transaction', async () => {
    const companyId = activeCompanyId;
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    const startSession = jest.spyOn(mongoose, 'startSession');
    const invalidRole = await request(app).post(`/api/companies/${companyId}/members`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
      .send({ email: 'user@example.com', role: 'super_admin', reason: 'Attempt privileged grant' });
    expect(invalidRole.status).toBe(400);
    expect(User.findOne).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();

    User.findOne.mockReturnValue(queryFor(null));
    const missingAccount = await request(app).post(`/api/companies/${companyId}/members`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
      .send({ email: 'missing@example.com', role: 'staff', assignedWarehouseIds: ['64b000000000000000000030'], reason: 'Grant staff access' });
    expect(missingAccount.status).toBe(404);
    expect(CompanyMembership.create).not.toHaveBeenCalled();
    startSession.mockRestore();
  });

  test('Company Admin can retrieve a company-scoped membership detail and list', async () => {
    const companyId = activeCompanyId;
    const targetId = '64b000000000000000000024';
    setMembership('company_admin');
    CompanyMembership.findOne.mockReset();
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    const row = {
      _id: '64b000000000000000000025', companyId, userId: {
        _id: targetId, name: 'Warehouse Staff', email: 'staff@example.com', accountStatus: 'active', deletedAt: null
      }, role: 'warehouse_staff', status: 'active', revision: 2,
      assignedWarehouseIds: ['64b000000000000000000030']
    };
    CompanyMembership.findOne.mockReturnValue(queryFor(row));
    const detail = await request(app).get(`/api/companies/${companyId}/members/${targetId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId);
    expect(detail.status).toBe(200);
    expect(detail.body.data.user.email).toBe('staff@example.com');
    expect(detail.body.data.revision).toBe(2);
    expect(CompanyMembership.findOne).toHaveBeenCalledWith({ companyId, userId: targetId });

    CompanyMembership.find.mockReturnValueOnce(queryFor([{
      _id: '64b000000000000000000023', companyId, role: 'company_admin', status: 'active', assignedWarehouseIds: []
    }])).mockReturnValueOnce(queryFor([row]));
    const list = await request(app).get(`/api/companies/${companyId}/members`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].user.id).toBe(targetId);
  });

  test.each([undefined, null, '', '   ', 'x'.repeat(501)])(
    'membership creation rejects invalid audit reason %p before starting a transaction', async reason => {
      const companyId = activeCompanyId;
      setMembership('company_admin');
      User.findById.mockResolvedValue({ _id: adminId, role: 'staff' });
      const startSession = jest.spyOn(mongoose, 'startSession');
      const payload = { email: 'person@example.com', role: 'company_admin' };
      if (reason !== undefined) payload.reason = reason;
      const response = await request(app).post(`/api/companies/${companyId}/members`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'staff')}`)
        .set('X-Company-Id', companyId).send(payload);
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/audit reason/i);
      expect(startSession).not.toHaveBeenCalled();
      startSession.mockRestore();
    }
  );

  test.each(['update', 'revoke'])(
    '%s requires an audit reason and expected membership revision before opening a transaction', async operation => {
      const companyId = activeCompanyId;
      const targetId = '64b000000000000000000024';
      setMembership('company_admin');
      User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
      const startSession = jest.spyOn(mongoose, 'startSession');
      const response = operation === 'update'
        ? await request(app).patch(`/api/companies/${companyId}/members/${targetId}`)
          .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
          .send({ role: 'company_admin', expectedRevision: 0 })
        : await request(app).delete(`/api/companies/${companyId}/members/${targetId}`)
          .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
          .send({ expectedRevision: 0 });
      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/audit reason/i);
      expect(startSession).not.toHaveBeenCalled();
      startSession.mockRestore();
    }
  );

  test.each(['warehouse_manager', 'warehouse_staff', 'auditor', 'staff'])(
    '%s cannot manage company memberships', async role => {
      const companyId = activeCompanyId;
      setMembership(role);
      User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
      const response = await request(app).post(`/api/companies/${companyId}/members`)
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
        .set('X-Company-Id', companyId)
        .send({ email: 'target@example.com', role: 'company_admin', reason: 'Attempt unauthorized membership change' });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('COMPANY_ADMIN_REQUIRED');
      expect(User.findOne).not.toHaveBeenCalled();
    }
  );

  test('membership creation rejects duplicate and cross-company warehouse assignments', async () => {
    const companyId = activeCompanyId;
    const warehouseId = '64b000000000000000000030';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    User.findOne.mockReturnValue(queryFor({ _id: staffId, name: 'Warehouse Staff', email: 'staff@example.com', accountStatus: 'active' }));
    const duplicate = await request(app).post(`/api/companies/${companyId}/members`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
      .send({ email: 'staff@example.com', role: 'warehouse_manager', assignedWarehouseIds: [warehouseId, warehouseId], reason: 'Assign work' });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.message).toMatch(/duplicates/i);

    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    Company.updateOne.mockResolvedValue({ matchedCount: 1 });
    CompanyMembership.findOne.mockReturnValue({ session: () => ({ lean: async () => ({ role: 'company_admin', status: 'active' }) }) });
    Warehouse.countDocuments.mockReturnValue(queryFor(0));
    mockActiveActorTransaction(adminId, 'admin');
    try {
      const foreign = await request(app).post(`/api/companies/${companyId}/members`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
        .send({ email: 'staff@example.com', role: 'warehouse_manager', assignedWarehouseIds: [warehouseId], reason: 'Assign work' });
      expect(foreign.status).toBe(400);
      expect(foreign.body.message).toMatch(/active and belong to this company/i);
      expect(CompanyMembership.create).not.toHaveBeenCalled();
      expect(AuditLog.create).not.toHaveBeenCalled();
    } finally { startSession.mockRestore(); }
  });

  test('membership role update uses optimistic revision and audits actual before and after values', async () => {
    const companyId = activeCompanyId;
    const targetId = '64b000000000000000000024';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    const actorRevalidation = mockActiveActorTransaction(adminId, 'admin');
    const actorQuery = { session: () => ({ lean: async () => ({ role: 'company_admin', status: 'active' }) }) };
    const warehouseId = '64b000000000000000000030';
    const current = { _id: '64b000000000000000000025', companyId, userId: targetId, role: 'warehouse_manager', status: 'active', revision: 4, assignedWarehouseIds: [warehouseId] };
    const updated = { ...current, role: 'auditor', revision: 5 };
    CompanyMembership.findOne
      .mockReturnValueOnce(actorQuery)
      .mockReturnValueOnce(queryFor(current))
      .mockReturnValueOnce(queryFor(updated));
    User.findOne.mockReturnValue(queryFor({ _id: targetId, accountStatus: 'active' }));
    Company.updateOne.mockResolvedValue({ matchedCount: 1 });
    CompanyMembership.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    Warehouse.countDocuments.mockReturnValue(queryFor(1));
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const response = await request(app).patch(`/api/companies/${companyId}/members/${targetId}`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
        .send({ role: 'auditor', expectedRevision: 4, reason: 'Grant read-only audit access' });
      expect(response.status).toBe(200);
      expect(response.body.data.revision).toBe(5);
      expect(actorRevalidation.session).toHaveBeenCalledWith(session);
      expect(CompanyMembership.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: current._id, companyId, userId: targetId, revision: 4 }),
        { $set: { role: 'auditor', status: 'active', assignedWarehouseIds: ['64b000000000000000000030'] }, $inc: { revision: 1 } },
        { session, runValidators: true }
      );
      expect(AuditLog.create).toHaveBeenCalledWith([expect.objectContaining({
        details: expect.objectContaining({
          actorUserId: adminId, targetUserId: targetId, reason: 'Grant read-only audit access',
          previousRole: 'warehouse_manager', newRole: 'auditor', previousStatus: 'active', newStatus: 'active'
        })
      })], { session });
    } finally { startSession.mockRestore(); }
  });

  test.each([
    ['inactive actor account', { _id: adminId, role: 'staff', accountStatus: 'inactive', deletedAt: null }, { role: 'company_admin', status: 'active', revision: 0 }],
    ['deleted actor account', { _id: adminId, role: 'staff', accountStatus: 'active', deletedAt: new Date() }, { role: 'company_admin', status: 'active', revision: 0 }],
    ['missing actor account', null, { role: 'company_admin', status: 'active', revision: 0 }],
    ['revoked actor membership', { _id: adminId, role: 'staff', accountStatus: 'active', deletedAt: null }, null],
    ['demoted actor membership', { _id: adminId, role: 'staff', accountStatus: 'active', deletedAt: null }, { role: 'warehouse_manager', status: 'active', revision: 0 }],
    ['stale actor membership revision', { _id: adminId, role: 'staff', accountStatus: 'active', deletedAt: null }, { role: 'company_admin', status: 'active', revision: 1 }]
  ])('%s prevents a membership mutation and successful audit', async (label, transactionActor, actorMembership) => {
    const companyId = activeCompanyId;
    const targetId = '64b000000000000000000024';
    setMembership('company_admin');
    const initiallyAuthenticatedActor = { _id: adminId, role: 'admin', accountStatus: 'active', deletedAt: null };
    const userQuery = {
      select: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(transactionActor)
    };
    User.findById.mockImplementationOnce(async () => initiallyAuthenticatedActor)
      .mockImplementationOnce(() => userQuery);
    const actorMembershipQuery = {
      select: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(actorMembership && {
        _id: '64b000000000000000000023', ...actorMembership
      })
    };
    if (transactionActor?.accountStatus === 'active' && !transactionActor.deletedAt) {
      CompanyMembership.findOne.mockReturnValueOnce(actorMembershipQuery);
    }
    Company.updateOne.mockResolvedValue({ matchedCount: 1 });
    let transactionState = 'not-started';
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
      const response = await request(app).patch(`/api/companies/${companyId}/members/${targetId}`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
        .send({ role: 'auditor', expectedRevision: 0, reason: 'Revalidate acting administrator' });
      expect(response.status).toBe(403);
      expect(['ACTOR_ACCOUNT_UNAVAILABLE', 'COMPANY_ADMIN_REQUIRED', 'COMPANY_ADMIN_AUTHORIZATION_STALE'])
        .toContain(response.body.code);
      expect(userQuery.session).toHaveBeenCalledWith(session);
      if (transactionActor?.accountStatus === 'active' && !transactionActor.deletedAt) {
        expect(actorMembershipQuery.session).toHaveBeenCalledWith(session);
      }
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(transactionState).toBe('aborted');
      expect(transactionState).not.toBe('committed');
      expect(CompanyMembership.updateOne).not.toHaveBeenCalled();
      expect(CompanyMembership.create).not.toHaveBeenCalled();
      expect(AuditLog.create).not.toHaveBeenCalled();
    } finally { startSession.mockRestore(); }
  });

  test('warehouse assignment update validates and audits the complete assignment transition', async () => {
    const companyId = activeCompanyId;
    const targetId = '64b000000000000000000024';
    const oldWarehouseId = '64b000000000000000000030';
    const newWarehouseId = '64b000000000000000000031';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    mockActiveActorTransaction(adminId, 'admin');
    const current = { _id: '64b000000000000000000025', companyId, userId: targetId, role: 'warehouse_manager', status: 'active', revision: 3, assignedWarehouseIds: [oldWarehouseId] };
    const updated = { ...current, revision: 4, assignedWarehouseIds: [newWarehouseId] };
    CompanyMembership.findOne.mockReturnValueOnce(queryFor({ role: 'company_admin', status: 'active' }))
      .mockReturnValueOnce(queryFor(current)).mockReturnValueOnce(queryFor(updated));
    User.findOne.mockReturnValue(queryFor({ _id: targetId, accountStatus: 'active' }));
    Warehouse.countDocuments.mockReturnValue(queryFor(1));
    Company.updateOne.mockResolvedValue({ matchedCount: 1 });
    CompanyMembership.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const response = await request(app).patch(`/api/companies/${companyId}/members/${targetId}`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
        .send({ assignedWarehouseIds: [newWarehouseId], expectedRevision: 3, reason: 'Move staff to second warehouse' });
      expect(response.status).toBe(200);
      expect(CompanyMembership.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: current._id, companyId, userId: targetId, revision: 3 }),
        { $set: { role: 'warehouse_manager', status: 'active', assignedWarehouseIds: [newWarehouseId] }, $inc: { revision: 1 } },
        { session, runValidators: true }
      );
      expect(AuditLog.create).toHaveBeenCalledWith([expect.objectContaining({
        action: 'company.membership.updated',
        details: expect.objectContaining({
          reason: 'Move staff to second warehouse', previousWarehouseAssignments: [oldWarehouseId],
          newWarehouseAssignments: [newWarehouseId]
        })
      })], { session });
    } finally { startSession.mockRestore(); }
  });

  test('stale membership revision is rejected without mutation or audit', async () => {
    const companyId = activeCompanyId;
    const targetId = '64b000000000000000000024';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    mockActiveActorTransaction(adminId, 'admin');
    Company.updateOne.mockResolvedValue({ matchedCount: 1 });
    CompanyMembership.findOne.mockReturnValueOnce(queryFor({ role: 'company_admin', status: 'active' }))
      .mockReturnValueOnce(queryFor({ _id: '64b000000000000000000025', role: 'warehouse_manager', status: 'active', revision: 5, assignedWarehouseIds: ['64b000000000000000000030'] }));
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const response = await request(app).patch(`/api/companies/${companyId}/members/${targetId}`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
        .send({ role: 'auditor', expectedRevision: 4, reason: 'Stale update' });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('MEMBERSHIP_REVISION_CONFLICT');
      expect(CompanyMembership.updateOne).not.toHaveBeenCalled();
      expect(AuditLog.create).not.toHaveBeenCalled();
    } finally { startSession.mockRestore(); }
  });

  test('last active Company Admin cannot be downgraded or revoked', async () => {
    const companyId = activeCompanyId;
    const targetId = adminId;
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const actorQuery = { session: () => ({ lean: async () => ({ role: 'company_admin', status: 'active' }) }) };
    const current = { _id: '64b000000000000000000025', companyId, userId: targetId, role: 'company_admin', status: 'active', revision: 0, assignedWarehouseIds: ['64b000000000000000000030'] };
    try {
      Company.updateOne.mockResolvedValue({ matchedCount: 1 });
      CompanyMembership.countDocuments.mockReturnValue(queryFor(1));
      Warehouse.countDocuments.mockReturnValue(queryFor(1));
      CompanyMembership.findOne.mockReturnValueOnce(actorQuery).mockReturnValueOnce({ session: () => ({ then: resolve => resolve(current) }) });
      mockActiveActorTransaction(adminId, 'admin');
      const downgrade = await request(app).patch(`/api/companies/${companyId}/members/${targetId}`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
        .send({ role: 'auditor', expectedRevision: 0, reason: 'Change access' });
      expect(downgrade.status).toBe(409);
      expect(downgrade.body.message).toMatch(/last active Company Admin/i);
      expect(CompanyMembership.updateOne).not.toHaveBeenCalled();

      CompanyMembership.findOne.mockReturnValueOnce(actorQuery).mockReturnValueOnce(queryFor(current));
      User.findOne.mockReturnValue(queryFor({ _id: targetId }));
      mockActiveActorTransaction(adminId, 'admin');
      const revoke = await request(app).delete(`/api/companies/${companyId}/members/${targetId}`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
        .send({ expectedRevision: 0, reason: 'Remove access' });
      expect(revoke.status).toBe(409);
      expect(revoke.body.message).toMatch(/last active Company Admin/i);
      expect(CompanyMembership.updateOne).not.toHaveBeenCalled();
      expect(AuditLog.create).not.toHaveBeenCalled();
    } finally { startSession.mockRestore(); }
  });

  test('inactive membership is reactivated explicitly with a reason and a new audit revision', async () => {
    const companyId = activeCompanyId;
    const targetId = '64b000000000000000000024';
    const warehouseId = '64b000000000000000000030';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    mockActiveActorTransaction(adminId, 'admin');
    const current = { _id: '64b000000000000000000025', companyId, userId: targetId, role: 'warehouse_staff', status: 'inactive', revision: 2, assignedWarehouseIds: [warehouseId] };
    const updated = { ...current, status: 'active', revision: 3 };
    const actorQuery = { session: () => ({ lean: async () => ({ role: 'company_admin', status: 'active' }) }) };
    CompanyMembership.findOne.mockReturnValueOnce(actorQuery)
      .mockReturnValueOnce(queryFor(current))
      .mockReturnValueOnce(queryFor(updated));
    User.findOne.mockReturnValue(queryFor({ _id: targetId, accountStatus: 'active' }));
    Warehouse.countDocuments.mockReturnValue(queryFor(1));
    Company.updateOne.mockResolvedValue({ matchedCount: 1 });
    CompanyMembership.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const response = await request(app).patch(`/api/companies/${companyId}/members/${targetId}`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
        .send({ status: 'active', expectedRevision: 2, reason: 'Return to warehouse duties' });
      expect(response.status).toBe(200);
      expect(response.body.action).toBe('company.membership.reactivated');
      expect(response.body.data.status).toBe('active');
      expect(CompanyMembership.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ revision: 2 }),
        { $set: { role: 'warehouse_staff', status: 'active', assignedWarehouseIds: [warehouseId] }, $inc: { revision: 1 } },
        { session, runValidators: true }
      );
      expect(AuditLog.create).toHaveBeenCalledWith([expect.objectContaining({
        action: 'company.membership.reactivated',
        details: expect.objectContaining({ reason: 'Return to warehouse duties', previousStatus: 'inactive', newStatus: 'active' })
      })], { session });
    } finally { startSession.mockRestore(); }
  });

  test('membership audit failure fails the request and shares the mutation transaction session', async () => {
    const companyId = activeCompanyId;
    const targetId = '64b000000000000000000024';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    mockActiveActorTransaction(adminId, 'admin');
    const current = { _id: '64b000000000000000000025', companyId, userId: targetId, role: 'warehouse_manager', status: 'active', revision: 0, assignedWarehouseIds: ['64b000000000000000000030'] };
    const updated = { ...current, role: 'auditor', revision: 1 };
    CompanyMembership.findOne.mockReturnValueOnce(queryFor({ role: 'company_admin', status: 'active' }))
      .mockReturnValueOnce(queryFor(current))
      .mockReturnValueOnce(queryFor(updated));
    User.findOne.mockReturnValue(queryFor({ _id: targetId, accountStatus: 'active' }));
    Company.updateOne.mockResolvedValue({ matchedCount: 1 });
    CompanyMembership.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    Warehouse.countDocuments.mockReturnValue(queryFor(1));
    AuditLog.create.mockRejectedValue(new Error('audit unavailable'));
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app).patch(`/api/companies/${companyId}/members/${targetId}`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).set('X-Company-Id', companyId)
        .send({ role: 'auditor', expectedRevision: 0, reason: 'Audit failure test' });
      expect(response.status).toBe(500);
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(CompanyMembership.updateOne.mock.invocationCallOrder[0]).toBeLessThan(AuditLog.create.mock.invocationCallOrder[0]);
      expect(AuditLog.create.mock.calls[0][1]).toEqual({ session });
    } finally { startSession.mockRestore(); errorLog.mockRestore(); AuditLog.create.mockReset(); }
  });

  test('Company Admin revocation is audited and blocks the member on the next operational request', async () => {
    const mongoose = require('mongoose');
    const companyId = activeCompanyId;
    const targetId = '64b000000000000000000024';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    mockActiveActorTransaction(adminId, 'admin');
    User.findOne.mockReturnValue(queryFor({ _id: targetId }));
    Company.updateOne.mockResolvedValue({ matchedCount: 1 });
    const adminMembershipQuery = {
      lean: async () => ({ role: 'company_admin', status: 'active' }),
      session: () => ({ lean: async () => ({ role: 'company_admin', status: 'active' }) })
    };
    const targetMembership = { _id: '64b000000000000000000023', role: 'warehouse_staff', status: 'active', revision: 0, assignedWarehouseIds: [] };
    CompanyMembership.findOne.mockReturnValueOnce(adminMembershipQuery)
      .mockReturnValueOnce(queryFor(targetMembership));
    CompanyMembership.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const session = { withTransaction: async callback => callback(), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const revoked = await request(app).delete(`/api/companies/${companyId}/members/${targetId}`)
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
        .set('X-Company-Id', companyId)
        .send({ expectedRevision: 0, reason: 'Employment ended' });
      expect(revoked.status).toBe(200);
      expect(CompanyMembership.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: targetMembership._id, companyId, userId: targetId, status: 'active', revision: { $in: [0, null] } }),
        { $set: { status: 'inactive', assignedWarehouseIds: [] }, $inc: { revision: 1 } },
        { session, runValidators: true }
      );
      expect(AuditLog.create).toHaveBeenCalledWith([expect.objectContaining({
        action: 'company.membership.revoked', actor: adminId, targetUser: targetId, companyId,
        details: expect.objectContaining({ reason: 'Employment ended', previousStatus: 'active', newStatus: 'inactive' })
      })], { session });
      setMembership('warehouse_staff', 'inactive');
      User.findById.mockResolvedValue({ _id: targetId, role: 'staff' });
      const denied = await request(app).get('/api/products').set('Authorization', `Bearer ${tokenFor(targetId, 'staff')}`);
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('COMPANY_MEMBERSHIP_INACTIVE');
      const warehouseDenied = await request(app).get('/api/inventory').set('Authorization', `Bearer ${tokenFor(targetId, 'staff')}`);
      expect(warehouseDenied.status).toBe(403);
      expect(warehouseDenied.body.code).toBe('COMPANY_MEMBERSHIP_INACTIVE');
    } finally { startSession.mockRestore(); }
  });

  test.each(['create', 'update', 'revoke'])(
    'membership %s aborts when the acting Company Admin was demoted after the initial check',
    async action => {
      const mongoose = require('mongoose');
      const companyId = activeCompanyId;
      const targetId = '64b000000000000000000024';
      setMembership('company_admin');
      User.findById.mockImplementation(id => {
        const record = String(id) === adminId
          ? { _id: adminId, role: 'admin', accountStatus: 'active', deletedAt: null }
          : { _id: targetId, role: 'staff', accountStatus: 'active', deletedAt: null };
        const actorQuery = {
          session: jest.fn().mockReturnThis(),
          lean: async () => record
        };
        return {
          select: () => actorQuery,
          then: (resolve, reject) => Promise.resolve(record).then(resolve, reject)
        };
      });
      User.findOne.mockReturnValue(queryFor({
        _id: targetId, name: 'Target', email: 'target@example.com', role: 'staff', accountStatus: 'active', deletedAt: null
      }));
      Company.updateOne.mockResolvedValue({ matchedCount: 1 });
      CompanyMembership.findOne.mockImplementation(filter => {
        if (String(filter.userId) !== adminId) throw new Error('Target membership must not be reached after actor denial');
        return {
          lean: async () => ({ role: 'company_admin', status: 'active' }),
          session: () => ({ lean: async () => ({ role: 'warehouse_manager', status: 'active' }) })
        };
      });
      const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
      const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
      try {
        let response;
        const token = `Bearer ${tokenFor(adminId, 'admin')}`;
        if (action === 'create') {
          response = await request(app).post(`/api/companies/${companyId}/members`)
            .set('Authorization', token).set('X-Company-Id', companyId)
            .send({ email: 'target@example.com', role: 'company_admin', reason: 'Add company administrator' });
          expect(CompanyMembership.create).not.toHaveBeenCalled();
        } else if (action === 'update') {
          response = await request(app).patch(`/api/companies/${companyId}/members/${targetId}`)
            .set('Authorization', token).set('X-Company-Id', companyId)
            .send({ role: 'company_admin', expectedRevision: 0, reason: 'Correct access role' });
        } else {
          response = await request(app).delete(`/api/companies/${companyId}/members/${targetId}`)
            .set('Authorization', token).set('X-Company-Id', companyId)
            .send({ expectedRevision: 0, reason: 'Remove access' });
        }
        expect(response.status).toBe(403);
        expect(response.body.message).toMatch(/active Company Admin membership is required/i);
        expect(session.withTransaction).toHaveBeenCalledTimes(1);
        expect(AuditLog.create).not.toHaveBeenCalled();
      } finally { startSession.mockRestore(); }
    }
  );

  test('rejects an invalid token', async () => {
    const response = await request(app).get('/api/categories').set('Authorization', 'Bearer invalid');
    expect(response.status).toBe(401);
  });

  test('registers a staff account and never returns its password hash', async () => {
    User.create.mockImplementation(async value => ({ ...value, _id: staffId }));
    const response = await request(app).post('/api/auth/register').send({
      name: 'Warehouse Staff', email: 'STAFF@example.com', password: 'correct-horse-battery'
    });
    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe('staff');
    expect(response.body.user.email).toBe('staff@example.com');
    expect(response.body.user.password).toBeUndefined();
    expect(jwt.verify(response.body.token, process.env.SECRET_OR_KEY).id).toBe(staffId);
    expect(User.create.mock.calls[0][0].password).not.toBe('correct-horse-battery');
  });

  test('public registration cannot assign the Super Admin role', async () => {
    User.create.mockImplementation(async value => ({ ...value, _id: staffId }));
    const response = await request(app).post('/api/auth/register').send({
      name: 'New Account', email: 'new@example.com', password: 'correct-horse-battery', role: 'superadmin', clearance: ['superadmin']
    });
    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe('staff');
    expect(User.create.mock.calls[0][0].role).toBe('staff');
  });

  test('validates registration fields before writing', async () => {
    const response = await request(app).post('/api/auth/register').send({ email: 'bad', password: 'short' });
    expect(response.status).toBe(400);
    expect(User.create).not.toHaveBeenCalled();
  });

  test('logs in and returns a signed bearer token without password data', async () => {
    const stored = {
      _id: staffId,
      name: 'Warehouse Staff',
      email: 'staff@example.com',
      role: 'staff',
      clearance: ['staff'],
      password: await bcrypt.hash('correct-horse-battery', 4)
    };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(stored) });
    const response = await request(app).post('/api/auth/login').send({
      email: 'STAFF@example.com', password: 'correct-horse-battery'
    });
    expect(response.status).toBe(200);
    expect(response.body.user.password).toBeUndefined();
    expect(jwt.verify(response.body.token, process.env.SECRET_OR_KEY).id).toBe(staffId);
  });

  test('returns a sanitized authenticated profile', async () => {
    User.findById.mockResolvedValue({
      _id: staffId, name: 'Warehouse Staff', email: 'staff@example.com', role: 'staff',
      clearance: ['staff'], password: 'must-never-appear'
    });
    const response = await request(app).get('/api/auth/user')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
    expect(response.status).toBe(200);
    expect(response.body.user.password).toBeUndefined();
  });

  test('temporary-password accounts are blocked from application APIs', async () => {
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff', mustChangePassword: true });
    const response = await request(app).get('/api/categories')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  test('creates a category and maps duplicate unique values to 409', async () => {
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    Category.create.mockResolvedValue({ _id: '64b000000000000000000003', name: 'Electronics' });
    const created = await request(app).post('/api/categories')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
      .send({ name: 'Electronics' });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('Electronics');

    Category.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }));
    const duplicate = await request(app).post('/api/categories')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
      .send({ name: 'Electronics' });
    expect(duplicate.status).toBe(409);
  });

  test('supports category list, retrieve, update, and safe admin deletion', async () => {
    const categoryId = '64b000000000000000000003';
    const categoryRecord = { _id: categoryId, name: 'Electronics' };
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    Category.find.mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [categoryRecord] }) })
    });
    const list = await request(app).get('/api/categories').set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`);
    expect(list.status).toBe(200);
    expect(list.body.data[0].name).toBe('Electronics');

    const deleteOne = jest.fn().mockResolvedValue({});
    Category.findById
      .mockReturnValueOnce({ lean: async () => categoryRecord })
      .mockResolvedValueOnce({ ...categoryRecord, deleteOne });
    const read = await request(app).get(`/api/categories/${categoryId}`).set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`);
    expect(read.status).toBe(200);
    expect(read.body.data.name).toBe('Electronics');

    Category.findByIdAndUpdate.mockResolvedValue({ ...categoryRecord, name: 'Devices' });
    const updated = await request(app).put(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).send({ name: 'Devices' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Devices');

    Item.exists.mockResolvedValue(false);
    const deleted = await request(app).delete(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`);
    expect(deleted.status).toBe(200);
    expect(deleteOne).toHaveBeenCalled();
  });

  test('rejects category deletion while products still reference it', async () => {
    const categoryId = '64b000000000000000000003';
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    Category.findById.mockResolvedValue({ _id: categoryId });
    Item.exists.mockResolvedValue(true);
    const response = await request(app).delete(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`);
    expect(response.status).toBe(409);
  });

  test('creates, updates, and safely deletes a catalog product; duplicate SKU returns 409', async () => {
    const productId = '64b000000000000000000004';
    const product = { _id: productId, name: 'Laptop', skuNumber: 'LAP-TEST', size: 1, department: 'IT' };
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    Item.create.mockResolvedValue(product);
    const created = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
      .send({ name: 'Laptop', skuNumber: 'LAP-TEST', size: 1, department: 'IT' });
    expect(created.status).toBe(201);

    Item.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }));
    const duplicate = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
      .send({ name: 'Laptop', skuNumber: 'LAP-TEST', size: 1, department: 'IT' });
    expect(duplicate.status).toBe(409);

    Item.findByIdAndUpdate.mockResolvedValue({ ...product, description: 'Updated' });
    const updated = await request(app).put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).send({ description: 'Updated' });
    expect(updated.status).toBe(200);

    const deleteOne = jest.fn().mockResolvedValue({});
    Item.findById.mockResolvedValue({ ...product, deleteOne });
    Pallet.exists.mockResolvedValue(false);
    const deleted = await request(app).delete(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`);
    expect(deleted.status).toBe(200);
    expect(deleteOne).toHaveBeenCalled();
  });

  test('rejects invalid identifiers and requires admin role for deletes', async () => {
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const invalidId = await request(app).get('/api/categories/not-an-id')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
    expect(invalidId.status).toBe(400);

    const denied = await request(app).delete('/api/categories/64b000000000000000000003')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
    expect(denied.status).toBe(403);
  });

  test('staff and legacy admins cannot access Super Admin APIs', async () => {
    User.findById.mockImplementation(async id => ({ _id: id, role: id === adminId ? 'admin' : 'staff' }));
    for (const id of [staffId, adminId]) {
      const response = await request(app).get('/api/admin/users')
        .set('Authorization', `Bearer ${tokenFor(id, id === adminId ? 'admin' : 'staff')}`);
      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/insufficient permissions/i);
    }
    const forgedRole = await request(app).get('/api/admin/users')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'superadmin')}`);
    expect(forgedRole.status).toBe(403);
  });

  test('Super Admin user list aggregates distinct active company memberships plus only that users legacy records', async () => {
    const platformId = '64b000000000000000000098';
    const userA = new mongoose.Types.ObjectId(staffId);
    const userB = new mongoose.Types.ObjectId(adminId);
    const companyA = new mongoose.Types.ObjectId('64b000000000000000000010');
    const companyB = new mongoose.Types.ObjectId('64b000000000000000000011');
    const pendingCompany = new mongoose.Types.ObjectId('64b000000000000000000012');
    User.findById.mockResolvedValue({ _id: platformId, role: 'super_admin', accountStatus: 'active', deletedAt: null });
    User.find.mockReturnValue({
      sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [{ _id: userA, name: 'User A', email: 'a@example.test', role: 'staff', accountStatus: 'active', date: new Date() }] }) }) })
    });
    User.countDocuments.mockResolvedValue(1);
    CompanyMembership.find.mockReturnValue({ select: () => ({ lean: async () => [
      { userId: userA, companyId: companyA, status: 'active' },
      { userId: userA, companyId: companyA, status: 'active' }, // corrupt duplicate cannot double-count
      { userId: userA, companyId: companyB, status: 'active' },
      { userId: userA, companyId: pendingCompany, status: 'active' },
      { userId: userA, companyId: new mongoose.Types.ObjectId('64b000000000000000000013'), status: 'inactive' },
      { userId: userA, companyId: new mongoose.Types.ObjectId('64b000000000000000000014'), status: 'revoked' }
    ] }) });
    Company.find.mockReturnValue({ select: () => ({ lean: async () => [
      { _id: companyA, name: 'Company A', slug: 'company-a', status: 'active' },
      { _id: companyB, name: 'Company B', slug: 'company-b', status: 'active' }
      // Pending companies are not returned by the status: active query.
    ] }) });
    const creatorGroupedRows = [
      { _id: { companyId: companyA, ownerId: userA }, products: 4 },
      { _id: { companyId: companyA, ownerId: userB }, products: 3 },
      { _id: { companyId: companyB, ownerId: userB }, products: 2 },
      { _id: { companyId: null, ownerId: userA }, products: 1 }
    ];
    Item.aggregate.mockResolvedValue(creatorGroupedRows);
    for (const Model of [Pallet, Order, Warehouse, Supplier, Category, Location]) Model.aggregate.mockResolvedValue([]);

    const response = await request(app).get('/api/admin/users')
      .set('Authorization', `Bearer ${tokenFor(platformId, 'super_admin')}`);

    expect(response.status).toBe(200);
    expect(response.body.data[0].stats).toMatchObject({ products: 10, companyCount: 2 });
    const membershipQuery = CompanyMembership.find.mock.calls[0][0];
    expect(membershipQuery).toMatchObject({ userId: { $in: [userA] }, status: 'active' });
    const companyQuery = Company.find.mock.calls[0][0];
    expect(companyQuery.status).toBe('active');
    expect(new Set(companyQuery._id.$in.map(String))).toEqual(new Set([String(companyA), String(companyB), String(pendingCompany)]));
    const statsMatch = Item.aggregate.mock.calls[0][0][0].$match.$or;
    expect(statsMatch).toContainEqual({ companyId: { $in: [companyA, companyB] } });
    expect(statsMatch).toContainEqual({ companyId: null, ownerId: { $in: [userA] } });
  });

  test('route-level permission gates reject Auditor on real operational mutation routes', async () => {
    setMembership('auditor');
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const mutations = [
      ['post', '/api/categories'], ['post', '/api/suppliers'], ['post', '/api/warehouses'],
      ['post', '/api/locations'], ['post', '/api/products'], ['post', '/api/inventory/stock-in'],
      ['post', '/api/inventory/stock-out'], ['post', '/api/inventory/stock-out/batch'], ['post', '/api/inventory/adjust'],
      ['post', '/api/pallets'], ['put', '/api/pallets/64b000000000000000000040'],
      ['post', '/api/item/create'], ['post', '/api/item/update'], ['post', '/api/location/create'],
      ['post', '/api/location/update'], ['post', '/api/pallet/create'], ['post', '/api/pallet/update'],
      ['post', '/api/receiving/create'], ['post', '/api/receiving/send'], ['post', '/api/receiving/valedation'],
      ['post', '/api/order/create'], ['put', '/api/order/64b000000000000000000040/status'],
      ['post', '/api/order'], ['post', '/api/order/64b000000000000000000040/submit'],
      ['post', '/api/order/64b000000000000000000040/reserve'],
      ['post', '/api/order/64b000000000000000000040/picking/assign'],
      ['post', '/api/order/64b000000000000000000040/picking/confirm'],
      ['post', '/api/order/64b000000000000000000040/packing'],
      ['post', '/api/order/64b000000000000000000040/dispatch'],
      ['post', '/api/order/64b000000000000000000040/delivery'],
      ['post', '/api/order/64b000000000000000000040/cancel'],
      ['post', '/api/customers'], ['put', '/api/customers/64b000000000000000000040'],
      ['post', '/api/ticket/create'], ['post', '/api/picker/start_picker'], ['post', '/api/picker/pick'], ['post', '/api/picker/done'],
      ['delete', '/api/categories/64b000000000000000000040'], ['delete', '/api/suppliers/64b000000000000000000040'],
      ['delete', '/api/warehouses/64b000000000000000000040'], ['delete', '/api/locations/64b000000000000000000040'],
      ['delete', '/api/products/64b000000000000000000040'], ['delete', '/api/pallets/64b000000000000000000040'],
      ['post', '/api/item/delete'], ['delete', '/api/location/delete/A-1'], ['post', '/api/pallet/delete'], ['delete', '/api/ticket/delete']
    ];
    for (const [method, path] of mutations) {
      const response = await request(app)[method](path)
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`).send({});
      const expectedCode = path === '/api/order/64b000000000000000000040/status' ? 'PERMISSION_NOT_CONFIGURED' : 'PERMISSION_REQUIRED';
      expect({ path, status: response.status, code: response.body.code }).toEqual({ path, status: 403, code: expectedCode });
      expect(response.body.code).toBe(expectedCode);
    }
  });

  test('warehouse staff cannot directly change stock-out balances or override order status', async () => {
    setMembership('warehouse_staff');
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const stockOut = await request(app).post('/api/inventory/stock-out')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`).send({ palletId: '64b000000000000000000043', quantity: 1, reason: 'test' });
    const statusOverride = await request(app).put('/api/order/64b000000000000000000044/status')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`).send({ status: 'Delivered' });
    expect(stockOut.status).toBe(403);
    expect(stockOut.body.code).toBe('PERMISSION_REQUIRED');
    expect(statusOverride.status).toBe(403);
    expect(statusOverride.body.code).toBe('PERMISSION_NOT_CONFIGURED');
  });

  test('warehouse staff cannot use legacy or current generic stock-in routes', async () => {
    setMembership('warehouse_staff');
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const token = `Bearer ${tokenFor(staffId, 'staff')}`;
    const attempts = [
      request(app).post('/api/inventory/stock-in').set('Authorization', token).send({ skuNumber: 'SKU1', quantity: 1, reason: 'manual count' }),
      request(app).post('/api/pallets').set('Authorization', token).send({ skuNumber: 'SKU1', cont: 1, reason: 'manual count' }),
      request(app).post('/api/pallet/create').set('Authorization', token).send({ skuNumber: 'SKU1', cont: 1, reason: 'manual count' }),
      request(app).post('/api/receiving/create').set('Authorization', token).send({ skuNumber: 'SKU1', cont: 1, reason: 'manual count' })
    ];
    const responses = await Promise.all(attempts);
    expect(responses.map(response => response.status)).toEqual([403, 403, 403, 403]);
    expect(inventoryService.receiveNewPallet).not.toHaveBeenCalled();
  });

  test('authorized manual stock-in forwards its idempotency key to the transactional service', async () => {
    const warehouseId = '64b000000000000000000030';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    Warehouse.findOne.mockReturnValue(queryWithExec({ _id: warehouseId, companyId: activeCompanyId, active: true }));
    inventoryService.receiveNewPallet.mockResolvedValue({ idempotentReplay: false, pallet: { _id: '64b000000000000000000045' } });
    const response = await request(app).post('/api/inventory/stock-in')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
      .set('X-Company-Id', activeCompanyId)
      .set('X-Warehouse-Id', warehouseId)
      .set('Idempotency-Key', 'manual-stock-in-route-01')
      .send({ skuNumber: 'SKU1', quantity: 2, warehouseId, reason: 'Cycle count correction' });
    expect(response.status).toBe(201);
    expect(inventoryService.receiveNewPallet).toHaveBeenCalledWith(expect.objectContaining({
      skuNumber: 'SKU1', quantity: 2, warehouseId, requestKey: 'manual-stock-in-route-01', userId: adminId
    }));
  });

  test('authorized batch stock-out route forwards only validated input and idempotency key', async () => {
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    inventoryService.deductPalletStockBatch.mockResolvedValue({ skuNumber: 'SKU-1', quantity: 4, movements: [] });
    const response = await request(app).post('/api/inventory/stock-out/batch')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
      .set('X-Company-Id', activeCompanyId)
      .set('Idempotency-Key', 'test-request-key-001')
      .send({
        skuNumber: 'SKU-1',
        items: [{ palletId: '64b000000000000000000043', quantity: 4 }],
        reason: 'Approved cycle count', companyId: '64b000000000000000000099', ownerId: '64b000000000000000000099'
      });
    expect(response.status).toBe(200);
    expect(inventoryService.deductPalletStockBatch).toHaveBeenCalledWith({
      skuNumber: 'SKU-1', items: [{ palletId: '64b000000000000000000043', quantity: 4 }],
      reason: 'Approved cycle count', requestKey: 'test-request-key-001', userId: adminId
    });
  });

  test('warehouse staff cannot use pallet putaway routes to forge pallet statuses', async () => {
    setMembership('warehouse_staff');
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const token = `Bearer ${tokenFor(staffId, 'staff')}`;
    const modern = await request(app).put('/api/pallets/64b000000000000000000045')
      .set('Authorization', token).send({ status: 'damaged' });
    const legacy = await request(app).post('/api/pallet/update')
      .set('Authorization', token).send({ id: '64b000000000000000000045', status: 'store' });
    expect(modern.status).toBe(403);
    expect(modern.body.code).toBe('PERMISSION_REQUIRED');
    expect(legacy.status).toBe(403);
    expect(legacy.body.code).toBe('PERMISSION_REQUIRED');
    expect(Pallet.findById).not.toHaveBeenCalled();
    expect(Pallet.findOne).not.toHaveBeenCalled();
  });

  test.each(['warehouse_manager', 'company_admin'])(
    '%s can change pallet status through both authorized pallet routes',
    async role => {
      const palletId = '64b000000000000000000045';
      setMembership(role);
      User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
      Pallet.findById.mockReturnValue({ lean: async () => ({ _id: palletId, status: 'received', warehouseId: null }) });
      Pallet.findByIdAndUpdate.mockResolvedValue({ _id: palletId, status: 'damaged' });
      const legacyPallet = { _id: palletId, status: 'received', save: jest.fn().mockResolvedValue(true) };
      Pallet.findOne.mockResolvedValue(legacyPallet);

      const token = `Bearer ${tokenFor(adminId, 'admin')}`;
      const modern = await request(app).put(`/api/pallets/${palletId}`)
        .set('Authorization', token).send({ status: 'damaged' });
      const legacy = await request(app).post('/api/pallet/update')
        .set('Authorization', token).send({ id: palletId, status: 'store' });

      expect(modern.status).toBe(200);
      expect(legacy.status).toBe(200);
      expect(Pallet.findByIdAndUpdate).toHaveBeenCalledWith(palletId, { status: 'damaged' }, { new: true, runValidators: true });
      expect(legacyPallet.status).toBe('store');
      expect(legacyPallet.save).toHaveBeenCalled();
    }
  );

  test('rejects invalid pallet statuses on both route families without changing authorization', async () => {
    setMembership('warehouse_manager');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    const token = `Bearer ${tokenFor(adminId, 'admin')}`;
    const plural = await request(app).put('/api/pallets/64b000000000000000000045')
      .set('Authorization', token).send({ status: 'made-up-state' });
    const singular = await request(app).post('/api/pallet/update')
      .set('Authorization', token).send({ id: '64b000000000000000000045', status: 'made-up-state' });
    expect(plural.status).toBe(400);
    expect(singular.status).toBe(400);
    expect(Pallet.findById).not.toHaveBeenCalled();
    expect(Pallet.findOne).not.toHaveBeenCalled();
  });

  test('shared migration write freeze blocks actual API mutations', async () => {
    const db = mongoose.connection.db;
    const lockToken = 'test-migration-lock';
    await acquireMigrationWriteFreeze(db, lockToken);
    const response = await request(app).post('/api/auth/register')
      .send({ name: 'Blocked', email: 'blocked@example.com', password: 'correct-horse-battery' });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe('MAINTENANCE_WRITE_FREEZE');
    expect(User.create).not.toHaveBeenCalled();
    await releaseMigrationWriteFreeze(db, lockToken);
  });

  test('ticket workflow rejects unverified customer references at the route', async () => {
    setMembership('warehouse_staff');
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const response = await request(app).post('/api/ticket/create')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
      .send({ order_id: '64b000000000000000000047', customerId: '64b000000000000000000099' });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/customerId cannot be set/i);
  });

  test.each(['superadmin', 'super_admin'])(
    'Super Admin role %s is rejected at every mounted operational API boundary', async storedRole => {
    const platformId = '64b000000000000000000088';
    User.findById.mockResolvedValue({ _id: platformId, role: storedRole });
    const paths = [
      '/api/categories', '/api/suppliers', '/api/warehouses', '/api/locations', '/api/products',
      '/api/items', '/api/inventory', '/api/pallets', '/api/reports', '/api/purchase-orders', '/api/grns', '/api/location', '/api/item',
      '/api/pallet', '/api/receiving', '/api/order', '/api/ticket', '/api/picker'
    ];
    for (const path of paths) {
      const response = await request(app).get(path).set('Authorization', `Bearer ${tokenFor(platformId, storedRole)}`);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('PLATFORM_ROUTE_REQUIRED');
    }
    }
  );

  test.each(['superadmin', 'super_admin'])(
    'stored Super Admin role %s is normalized for platform access and denied company operations',
    async storedRole => {
      const platformId = '64b000000000000000000088';
      User.findById.mockResolvedValue({ _id: platformId, role: storedRole });
      const platformRoute = await request(app).get('/api/admin/not-a-real-route')
        .set('Authorization', `Bearer ${tokenFor(platformId, storedRole)}`);
      expect(platformRoute.status).toBe(404); // Passed the platform-role guard; route itself is intentionally absent.

      const operationalRoute = await request(app).get('/api/products')
        .set('Authorization', `Bearer ${tokenFor(platformId, storedRole)}`);
      expect(operationalRoute.status).toBe(403);
      expect(operationalRoute.body.code).toBe('PLATFORM_ROUTE_REQUIRED');

      const companyRoute = await request(app).get('/api/companies/mine')
        .set('Authorization', `Bearer ${tokenFor(platformId, storedRole)}`);
      expect(companyRoute.status).toBe(403);
      expect(companyRoute.body.code).toBe('PLATFORM_ROUTE_REQUIRED');

      const profile = await request(app).get('/api/auth/user')
        .set('Authorization', `Bearer ${tokenFor(platformId, storedRole)}`);
      expect(profile.status).toBe(200);
      expect(profile.body.user.role).toBe('super_admin');
    }
  );

  test.each(['warehouse_manager', 'warehouse_staff'])(
    '%s can read active-company catalog reference data but cannot mutate it',
    async role => {
      setMembership(role);
      User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
      const catalogQuery = {
        sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: '64b000000000000000000060', name: 'Pallet' }])
      };
      Item.find.mockReturnValue(catalogQuery);
      Item.countDocuments.mockResolvedValue(1);
      const readResponse = await request(app).get('/api/products')
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
      expect(readResponse.status).toBe(200);
      expect(readResponse.body.data).toHaveLength(1);

      const deniedMutation = await request(app).post('/api/products')
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
        .send({ name: 'New', skuNumber: 'NEW-1', department: 'General', size: 1 });
      expect(deniedMutation.status).toBe(403);
      expect(deniedMutation.body.code).toBe('PERMISSION_REQUIRED');
      expect(Item.create).not.toHaveBeenCalled();
    }
  );

  test('Company Admin catalog mutation is explicitly granted within its company', async () => {
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'staff' });
    Item.create.mockResolvedValue({ _id: '64b000000000000000000063', name: 'New', skuNumber: 'NEW-1' });
    const response = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'staff')}`)
      .send({ name: 'New', skuNumber: 'NEW-1', department: 'General', size: 1 });
    expect(response.status).toBe(201);
    expect(Item.create).toHaveBeenCalledWith({ name: 'New', skuNumber: 'NEW-1', department: 'General', size: 1 });
  });

  test('warehouse catalog read cannot switch to a company without active membership', async () => {
    setMembership('warehouse_manager');
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const response = await request(app).get('/api/products')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
      .set('X-Company-Id', '64b000000000000000000099');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('COMPANY_MEMBERSHIP_REQUIRED');
    expect(Item.find).not.toHaveBeenCalled();
  });

  test('order creation is permission mapped while arbitrary status updates fail closed', async () => {
    const orderId = '64b000000000000000000061';
    setMembership('warehouse_manager');
    User.findById.mockResolvedValue({ _id: adminId, role: 'staff' });
    Order.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: () => ({ exec: async () => [{ _id: orderId, status: 'processing' }] }) }) }) });
    const listed = await request(app).get('/api/order')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'staff')}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);

    setMembership('company_admin');
    const created = await request(app).post('/api/order/create')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'staff')}`).send({ items: [] });
    expect(created.status).toBe(200);
    expect(Order.mock.instances[Order.mock.instances.length - 1].save).toHaveBeenCalled();

    setMembership('warehouse_manager');
    const changed = await request(app).put(`/api/order/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'staff')}`).send({ status: 'Processing' });
    expect(changed.status).toBe(403);
    expect(changed.body.code).toBe('PERMISSION_NOT_CONFIGURED');
    expect(Order.findByIdAndUpdate).not.toHaveBeenCalled();

    setMembership('warehouse_staff');
    const deniedStatus = await request(app).put(`/api/order/${orderId}/status`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'staff')}`).send({ status: 'Shipped' });
    expect(deniedStatus.status).toBe(403);
    expect(deniedStatus.body.code).toBe('PERMISSION_NOT_CONFIGURED');
  });

  test.each(['warehouse_manager', 'warehouse_staff'])(
    "%s can read assigned-warehouse inventory without receiving another company's data",
    async role => {
      const warehouseA = '64b000000000000000000030';
      setMembership(role);
      CompanyMembership.find.mockReturnValue({ select: () => ({ lean: async () => [{
        _id: '64b000000000000000000023', companyId: activeCompanyId, role, status: 'active',
        assignedWarehouseIds: [warehouseA]
      }] }) });
      User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
      const palletQuery = {
        sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: '64b000000000000000000062', warehouseId: warehouseA }])
      };
      Pallet.find.mockReturnValue(palletQuery);
      const response = await request(app).get('/api/pallets')
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
      expect(response.status).toBe(200);
      expect(response.body.data[0].warehouseId).toBe(warehouseA);
      expect(palletQuery.lean).toHaveBeenCalled();
    }
  );

  test.each(['company_admin', 'warehouse_manager', 'warehouse_staff', 'auditor'])(
    'ambiguous order submit stays fail-closed for %s', async role => {
      setMembership(role);
      User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
      const response = await request(app).post('/api/order/submit')
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`).send({ id: '64b000000000000000000061' });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('PERMISSION_NOT_CONFIGURED');
      expect(Order.findOne).not.toHaveBeenCalled();
    }
  );

  test('unmapped order operations fail closed even for Company Admin', async () => {
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    const response = await request(app).post('/api/order/unknown')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).send({});
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PERMISSION_NOT_CONFIGURED');
  });

  test.each(['pending', 'suspended', 'deactivated'])('company status %s cannot access operational APIs', async status => {
    setMembership('company_admin');
    Company.findById.mockReturnValue({ select: () => ({ lean: async () => ({ _id: activeCompanyId, status }) }) });
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const response = await request(app).get('/api/products').set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe(status === 'pending' ? 'COMPANY_PENDING' : 'COMPANY_UNAVAILABLE');
  });

  test('inactive membership cannot fall back to legacy ownerId endpoints', async () => {
    setMembership('company_admin', 'inactive');
    User.findById.mockResolvedValue({ _id: staffId, role: 'admin' });
    const response = await request(app).get('/api/item').set('Authorization', `Bearer ${tokenFor(staffId, 'admin')}`);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('COMPANY_MEMBERSHIP_INACTIVE');
  });

  test('legacy create route discards caller-supplied tenant and owner IDs', async () => {
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    Item.findOne.mockResolvedValue(null);
    const response = await request(app).post('/api/item/create')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
      .send({ name: 'Legacy item', skuNumber: 'LEGACY-1', companyId: '64b000000000000000000099', ownerId: staffId });
    expect(response.status).toBe(200);
    const createdRecord = Item.mock.instances[Item.mock.instances.length - 1];
    expect(createdRecord.companyId).toBeUndefined();
    expect(createdRecord.ownerId).toBeUndefined();
    expect(createdRecord.save).toHaveBeenCalled();
  });

  test('pallet relocation route rejects a location in a different warehouse', async () => {
    const palletId = '64b000000000000000000045';
    const warehouseA = '64b000000000000000000030';
    const warehouseB = '64b000000000000000000031';
    setMembership('warehouse_manager');
    CompanyMembership.find.mockReturnValue({ select: () => ({ lean: async () => [{
      _id: '64b000000000000000000023', companyId: activeCompanyId, role: 'warehouse_manager', status: 'active',
      assignedWarehouseIds: [warehouseA]
    }] }) });
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    Pallet.findById.mockReturnValue({ lean: async () => ({ _id: palletId, warehouseId: warehouseA, location: 'A-1', skuNumber: 'SKU1' }) });
    Warehouse.findOne.mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => ({ _id: warehouseA }) }) }) });
    const Location = require('../model/Location');
    Location.findOne.mockReturnValue({ select: () => ({ lean: async () => ({ _id: '64b000000000000000000046', warehouse: warehouseB, status: 'empty' }) }) });
    const response = await request(app).put(`/api/pallets/${palletId}`)
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`).send({ location: 'B-1' });
    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/same warehouse|pallet warehouse|relocated within/i);
    expect(Pallet.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('legacy location update cannot directly modify occupied size or SKU', async () => {
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    const save = jest.fn();
    const Location = require('../model/Location');
    Location.findOne.mockResolvedValue({ size: 0, maxSize: 50, palletId: [], save });
    const response = await request(app).post('/api/location/update')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
      .send({ location: 'A-1', size: 5, skuNumber: 'FOREIGN-SKU' });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('LOCATION_OCCUPANCY_REQUIRES_MOVEMENT');
    expect(save).not.toHaveBeenCalled();
  });

  test('location CRUD cannot fake an occupied or empty state outside pallet movement', async () => {
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    const Location = require('../model/Location');
    Location.findById.mockResolvedValue({ status: 'occupied', size: 4, palletId: ['64b000000000000000000045'] });
    const response = await request(app).put('/api/locations/64b000000000000000000046')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
      .send({ zone: 'A', fullName: 'A-1', row: 1, location: 1, level: 1, status: 'empty' });
    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/occupancy status is maintained by pallet movement/i);
    expect(Location.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('receiving putaway updates pallet and location in the same transaction', async () => {
    const mongoose = require('mongoose');
    const warehouseId = '64b000000000000000000030';
    const palletId = '64b000000000000000000045';
    setMembership('company_admin');
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    Warehouse.findOne.mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => ({ _id: warehouseId, active: true }) }) }) });
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const pallet = { _id: palletId, warehouseId, status: 'received', size: 2, skuNumber: 'SKU1', department: 'General', location: null, save: jest.fn().mockResolvedValue(true) };
    const destination = { _id: '64b000000000000000000046', warehouse: warehouseId, fullName: 'A-1', size: 0, maxSize: 10, skuNumber: null, palletId: [], save: jest.fn().mockResolvedValue(true) };
    Pallet.findOne.mockReturnValue({ session: jest.fn().mockResolvedValue(pallet) });
    const Location = require('../model/Location');
    Location.findOne.mockReturnValue({ session: jest.fn().mockResolvedValue(destination) });
    try {
      const response = await request(app).post('/api/receiving/send')
        .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).send({ id: palletId, location: 'A-1' });
      expect(response.status).toBe(200);
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(destination.palletId.map(String)).toContain(palletId);
      expect(pallet.location).toBe('A-1');
      expect(pallet.status).toBe('r/p');
      expect(destination.save).toHaveBeenCalledWith({ session });
      expect(pallet.save).toHaveBeenCalledWith({ session });
    } finally { startSession.mockRestore(); }
  });

  test('operational route rejects an unassigned warehouse ID before stock write', async () => {
    const warehouseA = '64b000000000000000000030';
    const warehouseB = '64b000000000000000000031';
    setMembership('warehouse_manager');
    CompanyMembership.find.mockReturnValue({ select: () => ({ lean: async () => [{
      _id: '64b000000000000000000023', companyId: activeCompanyId, role: 'warehouse_manager', status: 'active',
      assignedWarehouseIds: [warehouseA]
    }] }) });
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    Warehouse.findOne.mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => null }) }) });
    const response = await request(app).post('/api/inventory/stock-in')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
      .send({ warehouseId: warehouseB, skuNumber: 'SKU1', quantity: 5 });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('WAREHOUSE_ACCESS_DENIED');
  });

  test('ticket fulfillment uses one transaction session and rejects a repeated order', async () => {
    const warehouseId = '64b000000000000000000030';
    const orderId = '64b000000000000000000050';
    const palletId = '64b000000000000000000045';
    const membership = {
      _id: '64b000000000000000000023', companyId: activeCompanyId, userId: staffId,
      role: 'warehouse_manager', status: 'active', assignedWarehouseIds: [warehouseId]
    };
    setMembership('warehouse_manager');
    CompanyMembership.find.mockReturnValue({ select: () => ({ lean: async () => [membership] }) });
    CompanyMembership.findOne.mockReturnValue(queryWithExec(membership));
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    Company.findOne.mockReturnValue(queryWithExec({ _id: activeCompanyId }));
    Warehouse.findOne.mockReturnValue(queryWithExec({ _id: warehouseId }));
    const order = {
      _id: orderId, warehouseId, status: 'create', items: [{ skuNumber: 'SKU1', cont: 3 }],
      save: jest.fn().mockResolvedValue(true)
    };
    Order.findOne.mockReturnValue(queryWithExec(order));
    Pallet.find.mockReturnValue(queryWithExec([{
      _id: palletId, skuNumber: 'SKU1', warehouseId, location: 'A-1', cont: 5, contAvailable: 5
    }]));
    inventoryService.changePalletStock.mockResolvedValue({ pallet: { _id: palletId } });
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      const first = await request(app).post('/api/ticket/create')
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
        .set('X-Company-Id', activeCompanyId).set('X-Warehouse-Id', warehouseId)
        .send({ order_id: orderId });
      expect(first.status).toBe(200);
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(inventoryService.changePalletStock).toHaveBeenCalledWith(expect.objectContaining({
        palletId, type: 'stock-out', quantity: 3, session
      }));
      expect(Product.mock.calls[0][0]).toMatchObject({ ownerId: staffId, companyId: activeCompanyId });
      expect(Ticket.mock.calls[0][0]).toMatchObject({ ownerId: staffId, companyId: activeCompanyId });
      expect(Product.mock.instances[0].save).toHaveBeenCalledWith({ session });
      expect(Ticket.mock.instances[0].save).toHaveBeenCalledWith({ session });
      expect(order.save).toHaveBeenCalledWith({ session });

      const second = await request(app).post('/api/ticket/create')
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
        .set('X-Company-Id', activeCompanyId).set('X-Warehouse-Id', warehouseId)
        .send({ order_id: orderId });
      expect(second.status).toBe(409);
      expect(inventoryService.changePalletStock).toHaveBeenCalledTimes(1);
    } finally { startSession.mockRestore(); }
  });

  test('ticket-save failure propagates through the transaction after the stock update', async () => {
    const warehouseId = '64b000000000000000000030';
    const orderId = '64b000000000000000000050';
    const membership = {
      _id: '64b000000000000000000023', companyId: activeCompanyId, userId: staffId,
      role: 'warehouse_manager', status: 'active', assignedWarehouseIds: [warehouseId]
    };
    setMembership('warehouse_manager');
    CompanyMembership.find.mockReturnValue({ select: () => ({ lean: async () => [membership] }) });
    CompanyMembership.findOne.mockReturnValue(queryWithExec(membership));
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    Company.findOne.mockReturnValue(queryWithExec({ _id: activeCompanyId }));
    Warehouse.findOne.mockReturnValue(queryWithExec({ _id: warehouseId }));
    const order = {
      _id: orderId, warehouseId, status: 'create', items: [{ skuNumber: 'SKU1', cont: 1 }],
      save: jest.fn().mockResolvedValue(true)
    };
    Order.findOne.mockReturnValue(queryWithExec(order));
    Pallet.find.mockReturnValue(queryWithExec([{
      _id: '64b000000000000000000045', skuNumber: 'SKU1', warehouseId, location: 'A-1', cont: 5, contAvailable: 5
    }]));
    inventoryService.changePalletStock.mockResolvedValue({});
    const session = { withTransaction: jest.fn(async callback => callback()), endSession: jest.fn() };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    try {
      Ticket.mockImplementationOnce(function failTicketSave(data) {
        Object.assign(this, data);
        this._id = new mongoose.Types.ObjectId();
        this.save = jest.fn().mockRejectedValue(new Error('injected ticket-save failure'));
      });
      const response = await request(app).post('/api/ticket/create')
        .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
        .set('X-Company-Id', activeCompanyId).set('X-Warehouse-Id', warehouseId)
        .send({ order_id: orderId });
      expect(response.status).toBe(500);
      expect(inventoryService.changePalletStock).toHaveBeenCalledTimes(1);
      expect(session.withTransaction).toHaveBeenCalledTimes(1);
      expect(order.save).not.toHaveBeenCalled();
    } finally { startSession.mockRestore(); }
  });
});

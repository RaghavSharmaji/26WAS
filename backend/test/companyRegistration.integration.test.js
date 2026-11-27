const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');

const integrationUri = process.env.WAREFLOW_COMPANY_REGISTRATION_TEST_URI;
const describeIfLocalReplica = integrationUri ? describe : describe.skip;
if (integrationUri) {
  const parsedUri = new URL(integrationUri);
  if (parsedUri.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '::1'].includes(parsedUri.hostname)) {
    throw new Error('WAREFLOW_COMPANY_REGISTRATION_TEST_URI must connect to a local loopback MongoDB only.');
  }
  if (!parsedUri.pathname.includes('wareflow_company_registration_test')) {
    throw new Error('WAREFLOW_COMPANY_REGISTRATION_TEST_URI database name must include wareflow_company_registration_test.');
  }
}

const app = require('../server');
const User = require('../model/User');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const AuditLog = require('../model/AuditLog');

describeIfLocalReplica('company registration transactions on disposable local replica set', () => {
  const fixtureEmails = new Set();
  const fixtureCompanyIds = new Set();
  let originalAuditCreate;

  beforeAll(async () => {
    await mongoose.connect(integrationUri, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Company.createIndexes(), CompanyMembership.init(), AuditLog.init()]);
  });
  afterAll(async () => mongoose.disconnect());
  beforeEach(() => { originalAuditCreate = AuditLog.create; });
  afterEach(async () => {
    AuditLog.create = originalAuditCreate;
    const companyIds = [...fixtureCompanyIds].map(id => new mongoose.Types.ObjectId(id));
    const emails = [...fixtureEmails];
    if (companyIds.length) {
      await Promise.all([
        AuditLog.deleteMany({ companyId: { $in: companyIds } }),
        CompanyMembership.deleteMany({ companyId: { $in: companyIds } }),
        Company.deleteMany({ _id: { $in: companyIds } })
      ]);
    }
    if (emails.length) await User.deleteMany({ email: { $in: emails } });
    fixtureCompanyIds.clear(); fixtureEmails.clear();
  });

  function payload(suffix, overrides = {}) {
    const email = `admin-${suffix}@example.test`;
    fixtureEmails.add(email);
    return {
      company: {
        legalName: `Registration Test ${suffix} Private Limited`, displayName: `Registration Test ${suffix}`,
        businessType: 'private_limited', industry: 'wholesale', email: `company-${suffix}@example.test`,
        phone: '+919876543210', country: 'India', state: 'Maharashtra', city: 'Mumbai',
        address: '100 Disposable Test Road', postalCode: '400001', pan: 'ABCDE1234F', gstin: '27ABCDE1234F1Z5'
      },
      administrator: { name: 'Test Admin', designation: 'Director', email, phone: '9876543210', password: 'ReplicaTest123!', confirmPassword: 'ReplicaTest123!' },
      warehouseRequirements: { expectedWarehouses: 1, approximateSkus: 20, monthlyOrders: 100, employees: 2, primaryWarehouseName: 'Test Warehouse', primaryWarehouseType: 'distribution', primaryWarehouseAddress: '100 Disposable Test Road' },
      acceptance: { terms: true, privacy: true, accuracy: true },
      ...overrides
    };
  }

  test('registration commits user, pending company, admin membership and submission audit together', async () => {
    process.env.SECRET_OR_KEY = process.env.SECRET_OR_KEY || 'local-company-registration-test-signing-key';
    const form = payload(crypto.randomBytes(7).toString('hex'));
    const response = await request(app).post('/api/companies/register').send(form);
    expect(response.status).toBe(201);
    const company = await Company.findOne({ 'registration.reference': response.body.data.reference }).lean();
    expect(company).toMatchObject({ status: 'pending', registration: { status: 'pending', emailVerificationStatus: 'pending' } });
    fixtureCompanyIds.add(String(company._id));
    const user = await User.findOne({ email: form.administrator.email }).select('+password').lean();
    expect(user.password).not.toBe(form.administrator.password);
    expect(user).toMatchObject({ accountStatus: 'active', emailVerificationStatus: 'pending' });
    const membership = await CompanyMembership.findOne({ companyId: company._id, userId: user._id }).lean();
    expect(membership).toMatchObject({ role: 'company_admin', status: 'active' });
    expect(await AuditLog.countDocuments({ companyId: company._id, action: 'company.registration.submitted' })).toBe(1);
  });

  test('audit failure aborts the registration transaction and leaves no account, tenant, or membership', async () => {
    process.env.SECRET_OR_KEY = process.env.SECRET_OR_KEY || 'local-company-registration-test-signing-key';
    const form = payload(crypto.randomBytes(7).toString('hex'));
    AuditLog.create = async () => { throw new Error('injected registration audit failure'); };
    const response = await request(app).post('/api/companies/register').send(form);
    expect(response.status).toBe(500);
    expect(await User.countDocuments({ email: form.administrator.email })).toBe(0);
    expect(await Company.countDocuments({ 'registration.companyEmail': form.company.email })).toBe(0);
    expect(await CompanyMembership.countDocuments({ userId: { $in: await User.find({ email: form.administrator.email }).distinct('_id') } })).toBe(0);
  });

  test('concurrent identical submissions create only one account and company application', async () => {
    process.env.SECRET_OR_KEY = process.env.SECRET_OR_KEY || 'local-company-registration-test-signing-key';
    const form = payload(crypto.randomBytes(7).toString('hex'));
    const responses = await Promise.all([
      request(app).post('/api/companies/register').send(form),
      request(app).post('/api/companies/register').send(form)
    ]);
    expect(responses.filter(response => response.status === 201)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);
    const company = await Company.findOne({ 'registration.companyEmail': form.company.email }).lean();
    expect(company).toBeTruthy(); fixtureCompanyIds.add(String(company._id));
    expect(await User.countDocuments({ email: form.administrator.email })).toBe(1);
    expect(await CompanyMembership.countDocuments({ companyId: company._id })).toBe(1);
  });
});

jest.mock('../model/Company', () => ({ findById: jest.fn() }));
jest.mock('../model/CompanyMembership', () => ({ find: jest.fn() }));
jest.mock('../model/Warehouse', () => ({ findOne: jest.fn() }));

const mongoose = require('mongoose');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const Warehouse = require('../model/Warehouse');
const tenantContext = require('../middleware/tenantContext');
const { getAuthContext } = require('../middleware/requestContext');
const { runWithAuth } = require('../middleware/requestContext');
const { tenantFilter, assignTenantFields } = require('../middleware/ownershipPlugin');
const ItemModel = jest.requireActual('../model/Item');
const PalletModel = jest.requireActual('../model/Pallets');
const WarehouseModel = jest.requireActual('../model/Warehouse');
const LocationModel = jest.requireActual('../model/Location');
const CompanyModel = jest.requireActual('../model/Company');
const MembershipModel = jest.requireActual('../model/CompanyMembership');

const companyA = '64b000000000000000000010';
const companyB = '64b000000000000000000011';
const userA = '64b000000000000000000001';
const userB = '64b000000000000000000002';
const warehouse1 = '64b000000000000000000030';

function membershipQuery(rows) {
  return { select: () => ({ lean: async () => rows }) };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function user(id) {
  return { _id: new mongoose.Types.ObjectId(id), role: 'staff' };
}

function applyFindScope(Model, query, context) {
  const hook = Model.schema.s.hooks._pres.get('find').find(row => row.fn.name === 'scopeQuery').fn;
  return runWithAuth(context, () => new Promise((resolve, reject) => {
    hook.call(query, error => (error ? reject(error) : resolve()));
  }));
}

beforeEach(() => jest.clearAllMocks());

describe('company tenant context', () => {
  test('Company A members share Company A scope and cannot query Company B', () => {
    const scopeAUser1 = tenantFilter({ id: userA, companyId: companyA, role: 'staff' });
    const scopeAUser2 = tenantFilter({ id: userB, companyId: companyA, role: 'staff' });
    const scopeB = tenantFilter({ id: userB, companyId: companyB, role: 'staff' });
    expect(scopeAUser1).toEqual({ companyId: companyA });
    expect(scopeAUser2).toEqual({ companyId: companyA });
    expect(scopeB).toEqual({ companyId: companyB });
  });

  test('Mongoose product query overrides a forged company filter with trusted tenant scope', async () => {
    const query = ItemModel.find({ companyId: companyB, skuNumber: 'SHARED-1' });
    await applyFindScope(ItemModel, query, { id: userA, role: 'staff', companyId: companyA });
    expect(query.getFilter()).toMatchObject({ companyId: companyA, skuNumber: 'SHARED-1' });
  });

  test('Mongoose warehouse and location queries constrain warehouse managers', async () => {
    const warehouseQuery = WarehouseModel.find({ _id: { $ne: warehouse1 } });
    await applyFindScope(WarehouseModel, warehouseQuery, {
      id: userA, role: 'staff', companyId: companyA, warehouseScoped: true, allowedWarehouseIds: [warehouse1]
    });
    expect(warehouseQuery.getFilter()).toMatchObject({ companyId: companyA, _id: { $in: [warehouse1] } });

    const locationQuery = LocationModel.find({ fullName: 'A-01', companyId: companyB });
    await applyFindScope(LocationModel, locationQuery, {
      id: userA, role: 'staff', companyId: companyA, warehouseScoped: true, allowedWarehouseIds: [warehouse1]
    });
    expect(locationQuery.getFilter()).toMatchObject({ companyId: companyA, warehouse: { $in: [warehouse1] } });
  });

  test('Mongoose inventory aggregation inserts tenant and warehouse filters before grouping', async () => {
    const aggregate = PalletModel.aggregate([{ $group: { _id: '$skuNumber', quantity: { $sum: '$cont' } } }]);
    const hook = PalletModel.schema.s.hooks._pres.get('aggregate').find(row => row.fn.name === 'scopeAggregate').fn;
    await runWithAuth({
      id: userA, role: 'staff', companyId: companyA, warehouseScoped: true, allowedWarehouseIds: [warehouse1]
    }, () => new Promise((resolve, reject) => hook.call(aggregate, error => (error ? reject(error) : resolve()))));
    expect(aggregate.pipeline()[0]).toEqual({ $match: { companyId: companyA, warehouseId: { $in: [warehouse1] } } });
    expect(aggregate.pipeline()[1].$group).toBeDefined();
  });

  test('warehouse manager is limited to assigned warehouses only', () => {
    const scope = tenantFilter({
      id: userA, companyId: companyA, role: 'staff', warehouseScoped: true,
      allowedWarehouseIds: [warehouse1]
    }, 'warehouseId');
    expect(scope).toEqual({ companyId: companyA, warehouseId: { $in: [warehouse1] } });
    const noAssignments = tenantFilter({
      id: userA, companyId: companyA, role: 'staff', warehouseScoped: true, allowedWarehouseIds: []
    }, 'warehouseId');
    expect(noAssignments.warehouseId.$in).toEqual([]);
  });

  test('new records cannot forge their company or owner', () => {
    const record = { ownerId: userB, companyId: companyB };
    assignTenantFields(record, { id: userA, role: 'staff', companyId: companyA }, { isNew: true, schema: ItemModel.schema });
    expect(record).toMatchObject({ ownerId: userA, companyId: companyA });
  });

  test('warehouse writes reject IDs outside the membership assignment', () => {
    const record = { warehouseId: '64b000000000000000000031' };
    expect(() => assignTenantFields(record, {
      id: userA, role: 'staff', companyId: companyA, warehouseScoped: true,
      allowedWarehouseIds: [warehouse1]
    }, { isNew: true, schema: PalletModel.schema })).toThrow(/assigned warehouse/i);
  });

  test('legacy routes retain per-owner scope until migration', () => {
    expect(tenantFilter({ id: userA, legacyOwnerId: userA, role: 'staff' })).toEqual({ ownerId: userA });
  });

  test('rejects an attempted switch to a company without active membership', async () => {
    CompanyMembership.find.mockReturnValue(membershipQuery([{ companyId: new mongoose.Types.ObjectId(companyA), role: 'staff', assignedWarehouseIds: [] }]));
    const req = { user: user(userA), auth: { id: userA, role: 'staff' }, get: () => companyB };
    const res = response();
    const next = jest.fn();
    await tenantContext()(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('COMPANY_MEMBERSHIP_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  test('resolves a valid active company membership into trusted request context', async () => {
    CompanyMembership.find.mockReturnValue(membershipQuery([{
      _id: '64b000000000000000000041', companyId: new mongoose.Types.ObjectId(companyA),
      role: 'company_admin', assignedWarehouseIds: []
    }]));
    Company.findById.mockReturnValue({ select: () => ({ lean: async () => ({ _id: new mongoose.Types.ObjectId(companyA), slug: 'acme', status: 'active' }) }) });
    const req = { user: user(userA), auth: { id: userA, role: 'staff' }, get: () => null };
    const res = response();
    let context;
    const next = jest.fn(() => { context = getAuthContext(); });
    await tenantContext()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(context).toMatchObject({ companyId: companyA, membershipRole: 'company_admin', warehouseScoped: false });
  });

  test('warehouse manager cannot select an unassigned warehouse', async () => {
    CompanyMembership.find.mockReturnValue(membershipQuery([{
      _id: '64b000000000000000000041', companyId: new mongoose.Types.ObjectId(companyA),
      role: 'warehouse_manager', assignedWarehouseIds: [new mongoose.Types.ObjectId(warehouse1)]
    }]));
    Company.findById.mockReturnValue({ select: () => ({ lean: async () => ({ _id: new mongoose.Types.ObjectId(companyA), slug: 'acme', status: 'active' }) }) });
    const req = { user: user(userA), auth: { id: userA, role: 'staff' }, get: name => name === 'x-company-id' ? companyA : '64b000000000000000000031' };
    const res = response();
    const next = jest.fn();
    await tenantContext()(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('WAREHOUSE_ACCESS_DENIED');
    expect(next).not.toHaveBeenCalled();
  });

  test('warehouse manager context validates and carries assigned warehouse selection', async () => {
    CompanyMembership.find.mockReturnValue(membershipQuery([{
      _id: '64b000000000000000000041', companyId: new mongoose.Types.ObjectId(companyA),
      role: 'warehouse_manager', assignedWarehouseIds: [new mongoose.Types.ObjectId(warehouse1)]
    }]));
    Company.findById.mockReturnValue({ select: () => ({ lean: async () => ({ _id: new mongoose.Types.ObjectId(companyA), slug: 'acme', status: 'active' }) }) });
    Warehouse.findOne.mockReturnValue({ select: () => ({ lean: () => ({ exec: async () => ({ _id: new mongoose.Types.ObjectId(warehouse1) }) }) }) });
    const req = { user: user(userA), auth: { id: userA, role: 'staff' }, get: name => name === 'x-company-id' ? companyA : warehouse1 };
    const res = response();
    let context;
    const next = jest.fn(() => { context = getAuthContext(); });
    await tenantContext()(req, res, next);
    expect(context).toMatchObject({ companyId: companyA, activeWarehouseId: warehouse1, allowedWarehouseIds: [warehouse1] });
  });

  test('blocks users whose company is suspended', async () => {
    CompanyMembership.find.mockReturnValue(membershipQuery([{ _id: '64b000000000000000000040', companyId: new mongoose.Types.ObjectId(companyA), role: 'company_admin', assignedWarehouseIds: [] }]));
    Company.findById.mockReturnValue({ select: () => ({ lean: async () => ({ _id: companyA, status: 'suspended' }) }) });
    const req = { user: user(userA), auth: { id: userA, role: 'staff' }, get: () => companyA };
    const res = response();
    const next = jest.fn();
    await tenantContext()(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('COMPANY_UNAVAILABLE');
    expect(next).not.toHaveBeenCalled();
  });

  test('company and membership schemas enforce required fields and roles', async () => {
    const company = new CompanyModel({ name: 'Acme', slug: 'acme' });
    const membership = new MembershipModel({ userId: userA, companyId: companyA, role: 'company_admin' });
    await expect(company.validate()).resolves.toBeUndefined();
    await expect(membership.validate()).resolves.toBeUndefined();
    const invalid = new MembershipModel({ userId: userA, companyId: companyA, role: 'superadmin' });
    await expect(invalid.validate()).rejects.toThrow();
  });
});

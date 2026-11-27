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
const ProductModel = jest.requireActual('../model/Product');
const OrderModel = jest.requireActual('../model/Order');
const PalletModel = jest.requireActual('../model/Pallets');
const CustomerModel = jest.requireActual('../model/Customer');
const ShipmentModel = jest.requireActual('../model/Shipment');
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
  return { select: () => ({ lean: async () => rows.map(row => ({ status: 'active', ...row })) }) };
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

  test('warehouse roles can read company-wide catalog while stock records stay assignment-scoped', async () => {
    const context = {
      id: userA, role: 'staff', companyId: companyA, warehouseScoped: true,
      allowedWarehouseIds: [warehouse1]
    };
    const catalogQuery = ItemModel.find({ companyId: companyB });
    await applyFindScope(ItemModel, catalogQuery, context);
    expect(catalogQuery.getFilter()).toMatchObject({ companyId: companyA });
    expect(catalogQuery.getFilter().warehouseId).toBeUndefined();

    const stockQuery = ProductModel.find({ companyId: companyB, warehouseId: { $ne: warehouse1 } });
    await applyFindScope(ProductModel, stockQuery, context);
    expect(stockQuery.getFilter()).toMatchObject({ companyId: companyA, warehouseId: { $in: [warehouse1] } });

    const palletQuery = PalletModel.find({ companyId: companyB, warehouseId: { $ne: warehouse1 } });
    await applyFindScope(PalletModel, palletQuery, context);
    expect(palletQuery.getFilter()).toMatchObject({ companyId: companyA, warehouseId: { $in: [warehouse1] } });

    const orderQuery = OrderModel.find({ companyId: companyB, warehouseId: { $ne: warehouse1 } });
    await applyFindScope(OrderModel, orderQuery, context);
    expect(orderQuery.getFilter()).toMatchObject({ companyId: companyA, warehouseId: { $in: [warehouse1] } });
  });

  test('customer and shipment queries stay within company and assigned warehouse scope', async () => {
    const context = {
      id: userA, role: 'warehouse_staff', companyId: companyA, warehouseScoped: true,
      allowedWarehouseIds: [warehouse1]
    };
    const customers = CustomerModel.find({ companyId: companyB });
    await applyFindScope(CustomerModel, customers, context);
    expect(customers.getFilter()).toMatchObject({ companyId: companyA });

    const shipments = ShipmentModel.find({ companyId: companyB, warehouseId: { $ne: warehouse1 } });
    await applyFindScope(ShipmentModel, shipments, context);
    expect(shipments.getFilter()).toMatchObject({ companyId: companyA, warehouseId: { $in: [warehouse1] } });
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

  test('warehouse list and ID queries are restricted to assigned warehouse IDs', async () => {
    const context = {
      id: userA, companyId: companyA, role: 'warehouse_manager', warehouseScoped: true,
      allowedWarehouseIds: [warehouse1]
    };
    const listQuery = WarehouseModel.find({});
    await applyFindScope(WarehouseModel, listQuery, context);
    expect(listQuery.getFilter()).toMatchObject({ companyId: companyA, _id: { $in: [warehouse1] } });

    const selectedQuery = WarehouseModel.find({ _id: warehouse1 });
    await applyFindScope(WarehouseModel, selectedQuery, context);
    expect(selectedQuery.getFilter()).toMatchObject({ companyId: companyA, _id: { $in: [warehouse1] } });
  });

  test('new records cannot forge their company or owner', () => {
    const record = { ownerId: userB, companyId: companyB };
    assignTenantFields(record, { id: userA, role: 'staff', companyId: companyA }, { isNew: true, schema: ItemModel.schema });
    expect(record).toMatchObject({ ownerId: userA, companyId: companyA });
  });

  test('legacy records cannot be created under a caller-supplied company', () => {
    const record = { ownerId: userB, companyId: companyB };
    assignTenantFields(record, { id: userA, legacyOwnerId: userA, role: 'staff' }, { isNew: true, schema: ItemModel.schema });
    expect(record).toMatchObject({ ownerId: userA, companyId: null });
  });

  test('warehouse writes reject IDs outside the membership assignment', () => {
    const record = { warehouseId: '64b000000000000000000031' };
    expect(() => assignTenantFields(record, {
      id: userA, role: 'staff', companyId: companyA, warehouseScoped: true,
      allowedWarehouseIds: [warehouse1]
    }, { isNew: true, schema: PalletModel.schema })).toThrow(/assigned warehouse/i);
  });

  test('legacy routes retain per-owner scope until migration', () => {
    expect(tenantFilter({ id: userA, legacyOwnerId: userA, role: 'staff' })).toEqual({ ownerId: userA, companyId: null });
  });

  test('legacy owner context cannot read rows already scoped to any company', () => {
    const query = ItemModel.find({ companyId: companyB });
    return applyFindScope(ItemModel, query, { id: userA, legacyOwnerId: userA, role: 'staff' }).then(() => {
      expect(query.getFilter()).toMatchObject({ ownerId: userA, companyId: null });
    });
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

  test('blocks operational context for pending or deactivated companies by default', async () => {
    for (const status of ['pending', 'deactivated']) {
      CompanyMembership.find.mockReturnValue(membershipQuery([{ _id: '64b000000000000000000040', companyId: new mongoose.Types.ObjectId(companyA), role: 'company_admin', status: 'active', assignedWarehouseIds: [] }]));
      Company.findById.mockReturnValue({ select: () => ({ lean: async () => ({ _id: companyA, status }) }) });
      const req = { user: user(userA), auth: { id: userA, role: 'staff' }, get: () => companyA };
      const res = response();
      const next = jest.fn();
      await tenantContext()(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
      expect(res.body.code).toBe(status === 'pending' ? 'COMPANY_PENDING' : 'COMPANY_UNAVAILABLE');
    }
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

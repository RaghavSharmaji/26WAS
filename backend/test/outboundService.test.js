'use strict';

jest.mock('../model/Customer', () => jest.fn());
jest.mock('../model/Order', () => jest.fn());
jest.mock('../model/Shipment', () => jest.fn());
jest.mock('../model/Item', () => ({ findById: jest.fn() }));
jest.mock('../model/Pallets', () => ({ find: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../model/Warehouse', () => ({ findOne: jest.fn() }));
jest.mock('../model/CompanyMembership', () => ({ findOne: jest.fn(), find: jest.fn() }));
jest.mock('../model/Company', () => ({ findOne: jest.fn() }));
jest.mock('../model/User', () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock('../model/AuditLog', () => ({ create: jest.fn() }));
jest.mock('../model/InventoryOperation', () => ({ findOne: jest.fn(), create: jest.fn() }));

const mongoose = require('mongoose');
const Customer = require('../model/Customer');
const Order = require('../model/Order');
const Shipment = require('../model/Shipment');
const Item = require('../model/Item');
const Pallet = require('../model/Pallets');
const Warehouse = require('../model/Warehouse');
const Membership = require('../model/CompanyMembership');
const Company = require('../model/Company');
const User = require('../model/User');
const AuditLog = require('../model/AuditLog');
const InventoryOperation = require('../model/InventoryOperation');
const { runWithAuth } = require('../middleware/requestContext');
const service = require('../services/outboundService');

const companyA = '64b000000000000000000101';
const companyB = '64b000000000000000000102';
const actor = '64b000000000000000000201';
const worker = '64b000000000000000000202';
const warehouseA = '64b000000000000000000301';
const productA = '64b000000000000000000401';
const customerA = '64b000000000000000000501';
let state;
let gate;

const copy = value => JSON.parse(JSON.stringify(value, (key, item) => item instanceof mongoose.Types.ObjectId ? String(item) : item));
const current = () => require('../middleware/requestContext').getAuthContext();
const allowed = row => !row ? null : (current()?.companyId
  ? String(row.companyId) === String(current().companyId) ? row : null
  : String(row.ownerId) === String(current()?.id) && !row.companyId ? row : null);
function query(resolve) {
  const q = {
    session: () => q, sort: () => q, select: () => q, limit: () => q, lean: () => q,
    exec: async () => resolve(),
    then: (yes, no) => Promise.resolve().then(resolve).then(yes, no)
  };
  return q;
}
function mapFor(model) { return model === Customer ? state.customers : model === Order ? state.orders : model === Shipment ? state.shipments : null; }
function decorate(model, raw) {
  if (!raw) return null;
  const row = raw;
  if (typeof row.save !== 'function') row.save = jest.fn(async ({ session } = {}) => {
    if (session === undefined) throw new Error('Expected write to use a transaction session');
    mapFor(model).set(String(row._id), row);
    return row;
  });
  return row;
}
function ModelMock(model) {
  return function MockDocument(data) {
    Object.assign(this, copy(data));
    this._id ||= new mongoose.Types.ObjectId();
    this.ownerId = current()?.id || actor;
    this.companyId = current()?.companyId || null;
    if (Array.isArray(this.lines)) this.lines = this.lines.map(line => ({ _id: line._id || new mongoose.Types.ObjectId(), ...line, allocations: line.allocations || [] }));
    if (Array.isArray(this.packages)) this.packages = this.packages.map(pkg => ({ _id: pkg._id || new mongoose.Types.ObjectId(), ...pkg }));
    this.save = jest.fn(async ({ session } = {}) => {
      if (session === undefined) throw new Error('Expected write to use a transaction session');
      mapFor(model).set(String(this._id), this);
      return this;
    });
  };
}

function matchesCondition(actual, condition, row) {
  if (condition && typeof condition === 'object' && '$gte' in condition) return Number(actual) >= condition.$gte;
  if (condition && typeof condition === 'object' && '$exists' in condition) return (actual !== undefined) === condition.$exists;
  return String(actual) === String(condition);
}
function matchesFilter(row, filter) {
  if (filter.$and) return filter.$and.every(condition => matchesFilter(row, condition));
  if (filter.$or) return filter.$or.some(condition => matchesFilter(row, condition));
  return Object.entries(filter).every(([field, condition]) => matchesCondition(row[field], condition, row));
}
function makeSession() {
  return {
    withTransaction: jest.fn(async callback => {
      const previous = gate;
      let release;
      gate = new Promise(resolve => { release = resolve; });
      await previous;
      const snapshot = Object.fromEntries(Object.entries(state).map(([key, rows]) => [key, new Map([...rows].map(([id, row]) => [id, copy(row)]))]));
      try { return await callback(); }
      catch (error) { state = snapshot; throw error; }
      finally { release(); }
    }),
    endSession: jest.fn()
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  gate = Promise.resolve();
  state = { customers: new Map(), orders: new Map(), shipments: new Map(), pallets: new Map(), operations: new Map() };
  Customer.find = jest.fn(); Customer.findOne = jest.fn(); Customer.findById = jest.fn();
  Order.find = jest.fn(); Order.findById = jest.fn();
  Shipment.findOne = jest.fn(); Shipment.findById = jest.fn();
  Warehouse.findOne = jest.fn(); Membership.findOne = jest.fn(); Membership.find = jest.fn(); Company.findOne = jest.fn();
  User.findById = jest.fn(); User.find = jest.fn();
  Customer.mockImplementation(ModelMock(Customer));
  Customer.find.mockImplementation(filter => query(() => [...state.customers.values()].filter(row => allowed(row) && (!filter.active || row.active === filter.active))));
  Customer.findOne.mockImplementation(filter => query(() => {
    const row = allowed(state.customers.get(String(filter._id)));
    return row && (!filter.active || row.active === filter.active) ? row : null;
  }));
  Customer.findById.mockImplementation(Customer.findOne.getMockImplementation());
  Order.mockImplementation(ModelMock(Order));
  Order.find.mockImplementation(filter => query(() => [...state.orders.values()].filter(row => allowed(row) && (!filter.status || row.status === filter.status))));
  Order.findById.mockImplementation(id => query(() => decorate(Order, allowed(state.orders.get(String(id))))));
  Shipment.mockImplementation(ModelMock(Shipment));
  Shipment.findOne.mockImplementation(filter => query(() => decorate(Shipment, allowed([...state.shipments.values()].find(row => String(row.orderId) === String(filter.orderId))))));
  Shipment.findById.mockImplementation(Shipment.findOne.getMockImplementation());
  Item.findById.mockImplementation(id => query(() => String(id) === productA ? { _id: productA, companyId: companyA, ownerId: actor, name: 'Laptop', skuNumber: 'LT-1' } : null));
  Pallet.find.mockImplementation(filter => {
    const results = [...state.pallets.values()].filter(row => allowed(row) && row.skuNumber === filter.skuNumber
      && String(row.warehouseId) === String(filter.warehouseId) && !['receiving', 'damaged'].includes(row.status));
    return { sort: () => ({ session: () => query(() => results.map(copy)) }) };
  });
  Pallet.findById.mockImplementation(id => query(() => {
    const row = allowed(state.pallets.get(String(id)));
    return row ? copy(row) : null;
  }));
  Pallet.findOneAndUpdate.mockImplementation((filter, update, options) => query(() => {
    const row = state.pallets.get(String(filter.$and[0]._id));
    if (!allowed(row) || !matchesFilter(row, filter)) return null;
    if (update.$set) Object.assign(row, update.$set);
    for (const [field, amount] of Object.entries(update.$inc || {})) row[field] = Number(row[field] || 0) + amount;
    if (update.$push?.movementLog) row.movementLog.push(copy(update.$push.movementLog));
    return copy(row);
  }));
  Warehouse.findOne.mockImplementation(filter => query(() => String(filter._id) === warehouseA ? { _id: warehouseA } : null));
  Company.findOne.mockImplementation(filter => query(() => filter.status === 'active' ? { _id: filter._id, status: 'active' } : null));
  Membership.findOne.mockImplementation(filter => query(() => {
    if (filter.userId === actor && filter.companyId) return {
      _id: '64b000000000000000000777', userId: actor, companyId: filter.companyId,
      status: 'active', role: current()?.membershipRole || 'company_admin', revision: 0
    };
    if (filter.userId === worker && filter.companyId === companyA) return { userId: worker, companyId: companyA, status: 'active', role: 'warehouse_staff', assignedWarehouseIds: [warehouseA] };
    return null;
  }));
  Membership.find.mockImplementation(filter => query(() => [{ userId: worker, role: 'warehouse_staff', assignedWarehouseIds: [warehouseA] }]));
  User.findById.mockImplementation(id => query(() => String(id) === worker || String(id) === actor ? { _id: id, accountStatus: 'active', deletedAt: null } : null));
  User.find.mockImplementation(() => ({ select: () => ({ sort: () => query(() => [{ _id: worker, name: 'Picker', email: 'picker@example.test' }]) }) }));
  AuditLog.create.mockImplementation(async (rows, options) => { if (!options.session) throw new Error('Audit must share transaction'); return rows; });
  InventoryOperation.findOne.mockImplementation(filter => query(() => {
    const row = [...state.operations.values()].find(entry => entry.requestKey === filter.requestKey && allowed(entry));
    return row ? copy(row) : null;
  }));
  InventoryOperation.create.mockImplementation(async (rows, options) => {
    if (!options.session) throw new Error('Operation must share transaction');
    const row = { ...copy(rows[0]), _id: new mongoose.Types.ObjectId(), ownerId: current()?.id || actor, companyId: current()?.companyId || null };
    if ([...state.operations.values()].some(entry => entry.requestKey === row.requestKey && String(entry.companyId) === String(row.companyId))) throw Object.assign(new Error('duplicate key'), { code: 11000 });
    state.operations.set(String(row._id), row);
    return [row];
  });
  mongoose.startSession = jest.fn().mockResolvedValue(makeSession());
});

afterEach(() => { jest.restoreAllMocks(); });

const request = (companyId = companyA, role = 'company_admin', warehouses = [warehouseA]) => ({
  auth: { id: actor, role },
  tenant: { companyId, membershipId: '64b000000000000000000777', membershipRevision: 0, membershipRole: role, allowedWarehouseIds: warehouses, warehouseScoped: role !== 'company_admin', activeWarehouseId: warehouseA },
  tenantAuth: { id: actor, role, companyId, membershipId: '64b000000000000000000777', membershipRevision: 0, membershipRole: role, allowedWarehouseIds: warehouses, warehouseScoped: role !== 'company_admin', activeWarehouseId: warehouseA }
});
const asCompany = (companyId, fn) => runWithAuth({ id: actor, role: 'company_admin', companyId, membershipRole: 'company_admin', activeWarehouseId: warehouseA }, fn);

beforeEach(() => {
  state.customers.set(customerA, { _id: customerA, ownerId: actor, companyId: companyA, name: 'Customer', active: true });
  state.pallets.set('64b000000000000000000601', {
    _id: '64b000000000000000000601', ownerId: actor, companyId: companyA, warehouseId: warehouseA,
    skuNumber: 'LT-1', status: 'store', location: 'A-01', cont: 10, contAvailable: 10, contReserved: 0,
    contPicked: 0, contQuarantined: 0, __v: 0, movementLog: []
  });
});

async function createAndSubmit() {
  const order = await service.createOrder(request(), { customerId: customerA, warehouseId: warehouseA, lines: [{ productId: productA, quantity: 6 }] });
  const submitted = await service.submitOrder(request(), String(order._id), 0);
  return submitted;
}

test('creates tenant-owned customer orders and never changes inventory during creation', async () => {
  const order = await service.createOrder(request(), { customerId: customerA, warehouseId: warehouseA, lines: [{ productId: productA, quantity: 3 }] });
  expect(order).toMatchObject({ reference: expect.stringMatching(/^SO-/), status: 'draft', companyId: companyA });
  expect(state.pallets.get('64b000000000000000000601').cont).toBe(10);
});

test('order creation rejects customer, product, or warehouse references outside the tenant', async () => {
  await expect(service.createOrder(request(), {
    customerId: '64b000000000000000000599', warehouseId: warehouseA,
    lines: [{ productId: productA, quantity: 1 }]
  })).rejects.toMatchObject({ status: 404 });
  await expect(service.createOrder(request(), {
    customerId: customerA, warehouseId: warehouseA,
    lines: [{ productId: '64b000000000000000000499', quantity: 1 }]
  })).rejects.toMatchObject({ status: 404 });
  await expect(service.createOrder(request(), {
    customerId: customerA, warehouseId: '64b000000000000000000399',
    lines: [{ productId: productA, quantity: 1 }]
  })).rejects.toMatchObject({ status: 403 });
});

test('reservation is transactional, decreases available, and same-key retry replays without double reserve', async () => {
  const order = await createAndSubmit();
  const args = { expectedRevision: 1, requestKey: 'reserve-order-key-01' };
  const first = await service.reserveOrder(request(), String(order._id), args);
  const replay = await service.reserveOrder(request(), String(order._id), args);
  const pallet = state.pallets.get('64b000000000000000000601');
  expect(first.order.status).toBe('reserved');
  expect(replay.idempotentReplay).toBe(true);
  expect(pallet).toMatchObject({ cont: 10, contAvailable: 4, contReserved: 6 });
});

test('partial reservation records available stock without taking more than exists', async () => {
  const order = await createAndSubmit();
  state.pallets.get('64b000000000000000000601').contAvailable = 2;
  const result = await service.reserveOrder(request(), String(order._id), { expectedRevision: 1, requestKey: 'partial-order-key-01' });
  expect(result.order.status).toBe('partially_reserved');
  expect(result.order.lines[0].reservedQuantity).toBe(2);
  expect(state.pallets.get('64b000000000000000000601').contReserved).toBe(2);
});

test('insufficient stock fails without changing the pallet, order, or operation ledger', async () => {
  const order = await createAndSubmit();
  const pallet = state.pallets.get('64b000000000000000000601');
  pallet.contAvailable = 0;
  const beforeMovementCount = pallet.movementLog.length;
  await expect(service.reserveOrder(request(), String(order._id), {
    expectedRevision: 1, requestKey: 'insufficient-reserve-key-01'
  })).rejects.toMatchObject({ status: 409 });
  expect(pallet).toMatchObject({ cont: 10, contAvailable: 0, contReserved: 0 });
  expect(pallet.movementLog).toHaveLength(beforeMovementCount);
  expect(state.orders.get(String(order._id)).status).toBe('submitted');
  expect(state.operations.size).toBe(0);
});

test('reservation audit failure rolls back pallet, order, and idempotency writes', async () => {
  const order = await createAndSubmit();
  AuditLog.create.mockRejectedValueOnce(new Error('injected audit failure'));
  await expect(service.reserveOrder(request(), String(order._id), {
    expectedRevision: 1, requestKey: 'rollback-reserve-key-01'
  })).rejects.toThrow(/injected audit failure/i);
  expect(state.pallets.get('64b000000000000000000601')).toMatchObject({ contAvailable: 10, contReserved: 0 });
  expect(state.orders.get(String(order._id)).status).toBe('submitted');
  expect(state.operations.size).toBe(0);
});

test('cross-company order and unassigned warehouse are rejected', async () => {
  const order = await createAndSubmit();
  await expect(service.reserveOrder(request(companyB), String(order._id), { expectedRevision: 1, requestKey: 'cross-tenant-key-01' })).rejects.toMatchObject({ status: 404 });
  await expect(service.reserveOrder(request(companyA, 'warehouse_manager', []), String(order._id), { expectedRevision: 1, requestKey: 'unassigned-key-001' })).rejects.toMatchObject({ status: 403 });
});

test('short pick releases unpicked reserve, dispatch deducts on-hand once, delivery does not deduct again', async () => {
  const submitted = await createAndSubmit();
  await service.reserveOrder(request(), String(submitted._id), { expectedRevision: 1, requestKey: 'pick-reserve-key-01' });
  const reserved = state.orders.get(String(submitted._id));
  const picked = await service.confirmPicking(request(), String(submitted._id), {
    expectedRevision: reserved.revision, complete: true,
    lines: [{ orderLineId: String(reserved.lines[0]._id), pickedQuantity: 4 }]
  });
  expect(picked.status).toBe('picked');
  expect(state.pallets.get('64b000000000000000000601')).toMatchObject({ cont: 10, contAvailable: 6, contReserved: 0, contPicked: 4 });
  expect(state.pallets.get('64b000000000000000000601').movementLog.find(entry => entry.type === 'pick')).toMatchObject({ quantity: 4 });
  const packed = await service.packOrder(request(), String(submitted._id), {
    expectedRevision: picked.revision, requestKey: 'packing-order-key-01',
    packages: [{ lines: [{ orderLineId: String(picked.lines[0]._id), quantity: 4 }] }]
  });
  const dispatchArgs = { expectedRevision: packed.order.revision, requestKey: 'dispatch-order-key-01' };
  const dispatched = await service.dispatchOrder(request(), String(submitted._id), dispatchArgs);
  const replay = await service.dispatchOrder(request(), String(submitted._id), dispatchArgs);
  expect(dispatched.order.status).toBe('dispatched');
  expect(replay.idempotentReplay).toBe(true);
  expect(state.pallets.get('64b000000000000000000601')).toMatchObject({ cont: 6, contAvailable: 6, contPicked: 0 });
  expect(state.pallets.get('64b000000000000000000601').movementLog.find(entry => entry.type === 'dispatch')).toMatchObject({ quantity: 4 });
  await service.confirmDelivery(request(), String(submitted._id), { deliveredTo: 'Receiver' });
  expect(state.pallets.get('64b000000000000000000601').cont).toBe(6);
});

test('failed dispatch operation record rolls back the physical stock update', async () => {
  const submitted = await createAndSubmit();
  await service.reserveOrder(request(), String(submitted._id), { expectedRevision: 1, requestKey: 'rollback-reserve-key-01' });
  let order = state.orders.get(String(submitted._id));
  order = await service.confirmPicking(request(), String(submitted._id), { expectedRevision: order.revision, complete: true, lines: [{ orderLineId: String(order.lines[0]._id), pickedQuantity: 6 }] });
  const packed = await service.packOrder(request(), String(submitted._id), { expectedRevision: order.revision, requestKey: 'rollback-pack-key-01', packages: [{ lines: [{ orderLineId: String(order.lines[0]._id), quantity: 6 }] }] });
  InventoryOperation.create.mockRejectedValueOnce(new Error('injected operation write failure'));
  await expect(service.dispatchOrder(request(), String(submitted._id), { expectedRevision: packed.order.revision, requestKey: 'rollback-dispatch-key-01' })).rejects.toThrow(/injected operation/i);
  expect(state.pallets.get('64b000000000000000000601')).toMatchObject({ cont: 10, contPicked: 6 });
  expect(state.orders.get(String(submitted._id)).status).toBe('packed');
  expect(state.shipments.size).toBe(0);
});

test('picking and packing reject quantities beyond reserved or picked amounts', async () => {
  const submitted = await createAndSubmit();
  await service.reserveOrder(request(), String(submitted._id), { expectedRevision: 1, requestKey: 'quantity-reserve-key-01' });
  const reserved = state.orders.get(String(submitted._id));
  await expect(service.confirmPicking(request(), String(submitted._id), {
    expectedRevision: reserved.revision, complete: true,
    lines: [{ orderLineId: String(reserved.lines[0]._id), pickedQuantity: 7 }]
  })).rejects.toMatchObject({ status: 409 });
  expect(state.pallets.get('64b000000000000000000601')).toMatchObject({ contReserved: 6, contPicked: 0 });
  const picked = await service.confirmPicking(request(), String(submitted._id), {
    expectedRevision: reserved.revision, complete: true,
    lines: [{ orderLineId: String(reserved.lines[0]._id), pickedQuantity: 4 }]
  });
  await expect(service.packOrder(request(), String(submitted._id), {
    expectedRevision: picked.revision, requestKey: 'too-many-packed-key-01',
    packages: [{ lines: [{ orderLineId: String(picked.lines[0]._id), quantity: 5 }] }]
  })).rejects.toMatchObject({ status: 409 });
  expect(state.orders.get(String(submitted._id)).status).toBe('picked');
});

test('cancelling before dispatch releases remaining reserved and picked stock', async () => {
  const submitted = await createAndSubmit();
  await service.reserveOrder(request(), String(submitted._id), { expectedRevision: 1, requestKey: 'cancel-reserve-key-01' });
  let currentOrder = state.orders.get(String(submitted._id));
  currentOrder = await service.confirmPicking(request(), String(submitted._id), {
    expectedRevision: currentOrder.revision, complete: false,
    lines: [{ orderLineId: String(currentOrder.lines[0]._id), pickedQuantity: 2 }]
  });
  const cancelled = await service.cancelOrder(request(), String(submitted._id), {
    expectedRevision: currentOrder.revision, reason: 'Customer cancelled before dispatch'
  });
  expect(cancelled.status).toBe('cancelled');
  expect(state.pallets.get('64b000000000000000000601')).toMatchObject({ cont: 10, contAvailable: 10, contReserved: 0, contPicked: 0 });
});

test('concurrent same-key reservation commits one stock change and replays the result', async () => {
  const order = await createAndSubmit();
  const args = { expectedRevision: 1, requestKey: 'concurrent-reserve-key-01' };
  const results = await Promise.all([
    service.reserveOrder(request(), String(order._id), args),
    service.reserveOrder(request(), String(order._id), args)
  ]);
  expect(results.filter(row => row.idempotentReplay)).toHaveLength(1);
  expect(state.pallets.get('64b000000000000000000601')).toMatchObject({ contAvailable: 4, contReserved: 6 });
});


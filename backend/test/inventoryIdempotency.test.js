jest.mock('../model/Item', () => ({ findOne: jest.fn() }));
jest.mock('../model/Pallets', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn(), create: jest.fn() }));
jest.mock('../model/InventoryOperation', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../model/Location', () => ({ findOne: jest.fn() }));

const mongoose = require('mongoose');
const Item = require('../model/Item');
const Pallet = require('../model/Pallets');
const InventoryOperation = require('../model/InventoryOperation');
const Location = require('../model/Location');
const { runWithAuth } = require('../middleware/requestContext');
const { receivePalletStock, receiveNewPallet, adjustPalletStock } = require('../services/inventoryService');

const actorId = '64b000000000000000000001';
const companyA = '64b00000000000000000000a';
const companyB = '64b00000000000000000000b';
const palletId = '64b000000000000000000101';
const skuNumber = 'IDEMP-SKU';
const clone = value => JSON.parse(JSON.stringify(value));
const query = resolve => {
  const q = {
    session: () => q,
    lean: () => q,
    exec: async () => resolve(),
    then: (yes, no) => Promise.resolve().then(resolve).then(yes, no)
  };
  return q;
};

let pallets;
let operations;
let commits;
let aborts;
let queue;
let failOperationWrite;

function auth(companyId) {
  return { id: actorId, role: 'company_admin', companyId, allowedWarehouseIds: [], activeWarehouseId: null };
}

function inCompany(companyId, callback) { return runWithAuth(auth(companyId), callback); }

function sessionMock() {
  return {
    withTransaction: jest.fn(async callback => {
      const previous = queue;
      let release;
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      const before = { pallets: clone([...pallets.entries()]), operations: clone([...operations.entries()]) };
      try {
        const value = await callback();
        commits += 1;
        return value;
      } catch (error) {
        pallets = new Map(before.pallets);
        operations = new Map(before.operations);
        aborts += 1;
        throw error;
      } finally { release(); }
    }),
    endSession: jest.fn()
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  commits = 0; aborts = 0; queue = Promise.resolve(); failOperationWrite = false;
  pallets = new Map([[palletId, {
    _id: new mongoose.Types.ObjectId(palletId), ownerId: new mongoose.Types.ObjectId(actorId),
    companyId: new mongoose.Types.ObjectId(companyA), skuNumber, cont: 5, contAvailable: 5,
    contQuarantined: 0, status: 'store', __v: 0, movementLog: []
  }]]);
  operations = new Map();

  Item.findOne.mockImplementation(({ skuNumber: requestedSku }) => query(() => requestedSku === skuNumber ? ({
    _id: new mongoose.Types.ObjectId('64b000000000000000000201'), skuNumber,
    size: 2, ounce: 3, department: 'Parts'
  }) : null));
  Pallet.findById.mockImplementation(id => query(() => {
    const row = pallets.get(String(id));
    if (!row) return null;
    const principal = require('../middleware/requestContext').getAuthContext();
    return !principal?.companyId || String(row.companyId) === String(principal.companyId) ? clone(row) : null;
  }));
  Pallet.findOneAndUpdate.mockImplementation((filter, update) => {
    const row = pallets.get(String(filter._id));
    if (!row || String(row.companyId) !== String(require('../middleware/requestContext').getAuthContext()?.companyId)
      || (filter.__v !== undefined && filter.__v !== row.__v)
      || (filter.contAvailable !== undefined && filter.contAvailable !== row.contAvailable)) return query(() => null);
    row.contAvailable = update.$set.contAvailable;
    row.cont += update.$inc.cont || 0;
    if (update.$set.cont !== undefined) row.cont = update.$set.cont;
    row.__v += update.$inc.__v;
    row.movementLog.push({ ...clone(update.$push.movementLog), _id: update.$push.movementLog._id || new mongoose.Types.ObjectId() });
    return query(() => clone(row));
  });
  Pallet.create.mockImplementation(async (documents, options) => {
    expect(options.session).toBeDefined();
    const principal = require('../middleware/requestContext').getAuthContext();
    const created = documents.map(value => {
      const row = {
        ...clone(value), _id: new mongoose.Types.ObjectId(), ownerId: new mongoose.Types.ObjectId(principal.id),
        companyId: new mongoose.Types.ObjectId(principal.companyId), movementLog: value.movementLog.map(movement => ({ ...movement, _id: movement._id || new mongoose.Types.ObjectId() }))
      };
      pallets.set(String(row._id), row);
      return row;
    });
    return created;
  });
  InventoryOperation.findOne.mockImplementation(({ requestKey }) => query(() => {
    const principal = require('../middleware/requestContext').getAuthContext();
    return [...operations.values()].find(row => row.requestKey === requestKey && String(row.companyId) === String(principal.companyId)) || null;
  }));
  InventoryOperation.create.mockImplementation(async (documents, options) => {
    expect(options.session).toBeDefined();
    if (failOperationWrite) throw new Error('injected idempotency record failure');
    const principal = require('../middleware/requestContext').getAuthContext();
    const value = documents[0];
    const collision = [...operations.values()].some(row => row.requestKey === value.requestKey && String(row.companyId) === String(principal.companyId));
    if (collision) throw Object.assign(new Error('duplicate key'), { code: 11000 });
    const row = { ...clone(value), _id: new mongoose.Types.ObjectId(), ownerId: new mongoose.Types.ObjectId(principal.id), companyId: new mongoose.Types.ObjectId(principal.companyId) };
    operations.set(String(row._id), row);
    return [row];
  });
  Location.findOne.mockImplementation(() => query(() => null));
  jest.spyOn(mongoose, 'startSession').mockImplementation(async () => sessionMock());
});

afterEach(() => mongoose.startSession.mockRestore());

const newPalletRequest = (overrides = {}) => ({
  skuNumber, quantity: 3, reason: 'approved manual adjustment', warehouseId: '64b000000000000000000030',
  requestKey: 'manual-stock-in-0001', userId: actorId, ...overrides
});

test('first new-pallet stock-in commits pallet, movement and idempotency record in one transaction', async () => {
  const result = await inCompany(companyA, () => receiveNewPallet(newPalletRequest()));
  expect(result.idempotentReplay).toBe(false);
  expect(result.pallet).toMatchObject({ cont: 3, contAvailable: 3, status: 'received' });
  expect(result.movement).toMatchObject({ type: 'stock-in', quantity: 3, reason: 'approved manual adjustment' });
  expect(operations.size).toBe(1);
  expect(commits).toBe(1);
  expect(aborts).toBe(0);
});

test('repeated identical stock-in returns the original pallet and movement without adding stock again', async () => {
  const request = newPalletRequest();
  const first = await inCompany(companyA, () => receiveNewPallet(request));
  const replay = await inCompany(companyA, () => receiveNewPallet(request));
  expect(replay.idempotentReplay).toBe(true);
  expect(String(replay.pallet._id)).toBe(String(first.pallet._id));
  expect([...pallets.values()].filter(row => row.skuNumber === skuNumber && row.status === 'received')).toHaveLength(1);
  expect(operations.size).toBe(1);
});

test('same stock-in key with a different payload returns conflict and does not add stock', async () => {
  await inCompany(companyA, () => receiveNewPallet(newPalletRequest()));
  await expect(inCompany(companyA, () => receiveNewPallet(newPalletRequest({ quantity: 4 }))))
    .rejects.toMatchObject({ status: 409, code: 'INVENTORY_REQUEST_CONFLICT' });
  expect([...pallets.values()].filter(row => row.skuNumber === skuNumber && row.status === 'received')).toHaveLength(1);
  expect(operations.size).toBe(1);
});

test('failed transaction removes the stock change and idempotency record; retry can then succeed', async () => {
  failOperationWrite = true;
  await expect(inCompany(companyA, () => receiveNewPallet(newPalletRequest()))).rejects.toThrow(/injected idempotency/i);
  expect([...pallets.values()].filter(row => row.skuNumber === skuNumber && row.status === 'received')).toHaveLength(0);
  expect(operations.size).toBe(0);
  expect(aborts).toBe(1);
  failOperationWrite = false;
  const result = await inCompany(companyA, () => receiveNewPallet(newPalletRequest()));
  expect(result.idempotentReplay).toBe(false);
  expect(operations.size).toBe(1);
});

test('concurrent duplicate new-pallet stock-in requests create one pallet', async () => {
  const request = newPalletRequest();
  const results = await Promise.all([
    inCompany(companyA, () => receiveNewPallet(request)),
    inCompany(companyA, () => receiveNewPallet(request))
  ]);
  expect(results.filter(result => result.idempotentReplay)).toHaveLength(1);
  expect([...pallets.values()].filter(row => row.skuNumber === skuNumber && row.status === 'received')).toHaveLength(1);
  expect(operations.size).toBe(1);
});

test('the same client key can be reused in another company without exposing or replaying the first result', async () => {
  const request = newPalletRequest();
  const first = await inCompany(companyA, () => receiveNewPallet(request));
  const second = await inCompany(companyB, () => receiveNewPallet(request));
  expect(second.idempotentReplay).toBe(false);
  expect(String(first.pallet.companyId)).toBe(companyA);
  expect(String(second.pallet.companyId)).toBe(companyB);
  expect(operations.size).toBe(2);
});

test('idempotency keys are independently scoped to stock-in and inventory-adjustment operations', async () => {
  const key = 'shared-operation-key-01';
  await inCompany(companyA, () => receiveNewPallet(newPalletRequest({ requestKey: key })));
  const adjustment = await inCompany(companyA, () => adjustPalletStock({
    palletId, newQuantity: 6, reason: 'cycle count correction', requestKey: key, userId: actorId
  }));
  expect(adjustment.idempotentReplay).toBe(false);
  expect(operations.size).toBe(2);
});

test('existing-pallet stock-in rolls back if idempotency persistence fails', async () => {
  failOperationWrite = true;
  await expect(inCompany(companyA, () => receivePalletStock({
    palletId, quantity: 2, reason: 'approved adjustment', requestKey: 'existing-pallet-key-001', userId: actorId
  }))).rejects.toThrow(/injected idempotency/i);
  expect(pallets.get(palletId).cont).toBe(5);
  expect(pallets.get(palletId).contAvailable).toBe(5);
  expect(pallets.get(palletId).movementLog).toHaveLength(0);
  expect(operations.size).toBe(0);
  expect(aborts).toBe(1);
});

test('inventory increases through the adjustment route can be replayed without applying twice', async () => {
  const args = { palletId, newQuantity: 7, reason: 'cycle count correction', requestKey: 'adjustment-key-0001', userId: actorId };
  const first = await inCompany(companyA, () => adjustPalletStock(args));
  const replay = await inCompany(companyA, () => adjustPalletStock(args));
  expect(first.pallet.contAvailable).toBe(7);
  expect(replay.idempotentReplay).toBe(true);
  expect(pallets.get(palletId).cont).toBe(7);
  expect(operations.size).toBe(1);
});

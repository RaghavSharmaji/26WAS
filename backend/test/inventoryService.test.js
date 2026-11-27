jest.mock('../model/Item', () => ({}));
jest.mock('../model/Pallets', () => ({ find: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../model/InventoryOperation', () => ({
  collection: { createIndex: jest.fn().mockResolvedValue('unique_inventory_operation_request') },
  findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn()
}));

const mongoose = require('mongoose');
const Pallet = require('../model/Pallets');
const InventoryOperation = require('../model/InventoryOperation');
const { deductPalletStockBatch } = require('../services/inventoryService');

const skuNumber = 'SKU-BATCH-1';
const idA = '64b000000000000000000101';
const idB = '64b000000000000000000102';
const keyA = 'batch-deduction-key-001';
const clone = value => JSON.parse(JSON.stringify(value));
const q = resolve => {
  const query = {
    session: () => query,
    lean: () => query,
    exec: async () => resolve()
  };
  return query;
};

let pallets;
let operations;
let accessibleIds;
let commits;
let aborts;
let updateCalls;
let failOnUpdateCall;
let queue;

function makePallet(id, quantity, warehouseId = '64b000000000000000000201') {
  return {
    _id: new mongoose.Types.ObjectId(id), skuNumber, warehouseId: new mongoose.Types.ObjectId(warehouseId),
    cont: quantity, contAvailable: quantity, __v: 0, movementLog: []
  };
}

function sessionMock() {
  return {
    withTransaction: jest.fn(async callback => {
      const previous = queue;
      let release;
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      const palletSnapshot = clone([...pallets.entries()]);
      const operationSnapshot = clone([...operations.entries()]);
      try {
        const result = await callback();
        commits += 1;
        return result;
      } catch (error) {
        pallets = new Map(palletSnapshot);
        operations = new Map(operationSnapshot);
        aborts += 1;
        throw error;
      } finally { release(); }
    }),
    endSession: jest.fn()
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  pallets = new Map([[idA, makePallet(idA, 7)], [idB, makePallet(idB, 5)]]);
  operations = new Map();
  accessibleIds = new Set([idA, idB]);
  commits = 0;
  aborts = 0;
  updateCalls = 0;
  failOnUpdateCall = null;
  queue = Promise.resolve();

  Pallet.find.mockImplementation(filter => q(() => [...pallets.values()].filter(pallet =>
    accessibleIds.has(String(pallet._id))
    && filter._id.$in.some(id => String(id) === String(pallet._id))
    && pallet.skuNumber === filter.skuNumber
  )));
  Pallet.findById.mockImplementation(id => q(() => {
    const pallet = pallets.get(String(id));
    return pallet ? clone(pallet) : null;
  }));
  Pallet.findOneAndUpdate.mockImplementation((filter, update) => {
    updateCalls += 1;
    if (failOnUpdateCall === updateCalls) throw new Error('injected pallet write failure');
    const id = String(filter._id);
    const pallet = pallets.get(id);
    if (!pallet || (filter.__v !== undefined && filter.__v !== pallet.__v)
      || (filter.contAvailable !== undefined && filter.contAvailable !== pallet.contAvailable)) return q(() => null);
    pallet.contAvailable = update.$set.contAvailable;
    if (update.$inc.cont !== undefined) pallet.cont += update.$inc.cont;
    if (update.$set.cont !== undefined) pallet.cont = update.$set.cont;
    pallet.__v += update.$inc.__v;
    const movement = { ...update.$push.movementLog, _id: new mongoose.Types.ObjectId() };
    pallet.movementLog.push(movement);
    return q(() => clone(pallet));
  });
  InventoryOperation.findOne.mockImplementation(({ requestKey }) => q(() => operations.get(requestKey) || null));
  InventoryOperation.create.mockImplementation(async (documents, options) => {
    expect(options.session).toBeDefined();
    const operation = { _id: new mongoose.Types.ObjectId(), ownerId: '64b000000000000000000001', ...clone(documents[0]) };
    operations.set(operation.requestKey, operation);
    return [operation];
  });
  InventoryOperation.updateOne.mockImplementation((filter, update, options) => {
    expect(options.session).toBeDefined();
    const operation = operations.get([...operations.keys()].find(key => String(operations.get(key)._id) === String(filter._id)));
    if (!operation) return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
    operation.movements = clone(update.$set.movements);
    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
  });
  jest.spyOn(mongoose, 'startSession').mockImplementation(async () => sessionMock());
});

afterEach(() => { mongoose.startSession.mockRestore(); });

const request = (overrides = {}) => ({
  skuNumber, items: [{ palletId: idA, quantity: 4 }, { palletId: idB, quantity: 3 }],
  reason: 'Cycle count issue', userId: '64b000000000000000000001', requestKey: keyA, ...overrides
});

describe('deductPalletStockBatch', () => {
  test('deducts all requested pallets and records movement and idempotency data in one transaction', async () => {
    const result = await deductPalletStockBatch(request());
    expect(result).toMatchObject({ idempotentReplay: false, skuNumber, quantity: 7 });
    expect(pallets.get(idA).contAvailable).toBe(3);
    expect(pallets.get(idA).cont).toBe(3);
    expect(pallets.get(idB).contAvailable).toBe(2);
    expect(pallets.get(idB).cont).toBe(2);
    expect(pallets.get(idA).movementLog[0]).toMatchObject({ type: 'stock-out', delta: -4, stockBefore: 7, stockAfter: 3 });
    expect(pallets.get(idB).movementLog[0]).toMatchObject({ type: 'stock-out', delta: -3, stockBefore: 5, stockAfter: 2 });
    expect([...operations.values()][0].movements).toHaveLength(2);
    expect(commits).toBe(1);
    expect(aborts).toBe(0);
    expect(InventoryOperation.collection.createIndex).not.toHaveBeenCalled();
  });

  test('rejects insufficient stock before any pallet or operation write', async () => {
    await expect(deductPalletStockBatch(request({ items: [{ palletId: idA, quantity: 8 }] })))
      .rejects.toThrow(/insufficient stock/i);
    expect(pallets.get(idA).contAvailable).toBe(7);
    expect(operations.size).toBe(0);
    expect(updateCalls).toBe(0);
    expect(aborts).toBe(1);
  });

  test('rejects invalid pallet IDs without starting a transaction', async () => {
    await expect(deductPalletStockBatch(request({ items: [{ palletId: 'bad-id', quantity: 1 }] })))
      .rejects.toThrow(/valid/i);
    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  test('rejects pallets outside the active company scope', async () => {
    accessibleIds = new Set([idA]);
    await expect(deductPalletStockBatch(request({ items: [{ palletId: idB, quantity: 1 }] })))
      .rejects.toThrow(/unavailable in the active company/i);
    expect(pallets.get(idB).contAvailable).toBe(5);
    expect(updateCalls).toBe(0);
  });

  test('rejects pallets outside the actor warehouse assignment', async () => {
    accessibleIds = new Set([idA]);
    await expect(deductPalletStockBatch(request({ items: [{ palletId: idB, quantity: 1 }] })))
      .rejects.toThrow(/assigned warehouse/i);
    expect(updateCalls).toBe(0);
  });

  test('rolls back every prior pallet deduction when a later pallet write fails', async () => {
    failOnUpdateCall = 2;
    await expect(deductPalletStockBatch(request())).rejects.toThrow(/injected pallet write failure/);
    expect(pallets.get(idA).contAvailable).toBe(7);
    expect(pallets.get(idB).contAvailable).toBe(5);
    expect(pallets.get(idA).movementLog).toHaveLength(0);
    expect(operations.size).toBe(0);
    expect(commits).toBe(0);
    expect(aborts).toBe(1);
  });

  test('replays a duplicate idempotency key without deducting twice', async () => {
    await deductPalletStockBatch(request());
    const replay = await deductPalletStockBatch(request());
    expect(replay.idempotentReplay).toBe(true);
    expect(pallets.get(idA).contAvailable).toBe(3);
    expect(pallets.get(idB).contAvailable).toBe(2);
    expect(updateCalls).toBe(2);
  });

  test('rejects reuse of an idempotency key for a different request', async () => {
    await deductPalletStockBatch(request());
    await expect(deductPalletStockBatch(request({ items: [{ palletId: idA, quantity: 1 }] })))
      .rejects.toThrow(/different inventory request/i);
    expect(pallets.get(idA).contAvailable).toBe(3);
    expect(updateCalls).toBe(2);
  });

  test('serializes concurrent requests so duplicate and competing deductions cannot oversubscribe stock', async () => {
    pallets.set(idA, makePallet(idA, 5));
    const sameRequest = request({ items: [{ palletId: idA, quantity: 4 }] });
    const duplicatePair = await Promise.all([
      deductPalletStockBatch(sameRequest), deductPalletStockBatch(sameRequest)
    ]);
    expect(duplicatePair.filter(result => result.idempotentReplay)).toHaveLength(1);
    expect(pallets.get(idA).contAvailable).toBe(1);

    await expect(deductPalletStockBatch(request({
      requestKey: 'batch-deduction-key-002', items: [{ palletId: idA, quantity: 2 }]
    }))).rejects.toThrow(/insufficient stock/i);
    expect(pallets.get(idA).contAvailable).toBe(1);
  });
});

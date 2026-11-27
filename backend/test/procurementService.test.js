jest.mock('../model/Item', () => ({ findById: jest.fn() }));
jest.mock('../model/Supplier', () => ({ findOne: jest.fn() }));
jest.mock('../model/Warehouse', () => ({ findOne: jest.fn() }));
jest.mock('../model/Location', () => ({ findOne: jest.fn() }));
jest.mock('../model/Pallets', () => ({ create: jest.fn(), findById: jest.fn() }));
jest.mock('../model/PurchaseOrder', () => ({ create: jest.fn(), findById: jest.fn() }));
jest.mock('../model/GoodsReceipt', () => ({ create: jest.fn(), findOne: jest.fn(), findById: jest.fn() }));
jest.mock('../model/Putaway', () => ({ create: jest.fn(), findOne: jest.fn() }));

const mongoose = require('mongoose');
const Item = require('../model/Item');
const Supplier = require('../model/Supplier');
const Warehouse = require('../model/Warehouse');
const Location = require('../model/Location');
const Pallet = require('../model/Pallets');
const PurchaseOrder = require('../model/PurchaseOrder');
const GoodsReceipt = require('../model/GoodsReceipt');
const Putaway = require('../model/Putaway');
const { runWithAuth } = require('../middleware/requestContext');
const service = require('../services/procurementService');

const id = () => new mongoose.Types.ObjectId();
const companyA = id();
const companyB = id();
const actorId = id();
const warehouseId = id();
const supplierId = id();
const productId = id();
const product2Id = id();
const locationId = id();
let state;
let commits;
let aborts;
let palletWrites;
let failPalletWrite;
let failReceiptSave;
let transactionQueue;

const tenant = companyId => ({ id: String(actorId), role: 'warehouse_staff', companyId: String(companyId), warehouseScoped: true, allowedWarehouseIds: [String(warehouseId)], activeWarehouseId: String(warehouseId) });
const reqFor = (companyId = companyA, allowed = [warehouseId]) => ({ tenant: { companyId: String(companyId), warehouseScoped: true, allowedWarehouseIds: allowed.map(String), activeWarehouseId: String(warehouseId) } });
const scoped = record => {
  const principal = require('../middleware/requestContext').getAuthContext();
  if (!record || !principal) return record || null;
  if (principal.companyId) return String(record.companyId) === String(principal.companyId) ? record : null;
  return String(record.ownerId) === String(principal.id) && !record.companyId ? record : null;
};
function query(resolve) {
  const q = {
    session: () => q, select: () => q, lean: () => q,
    exec: async () => resolve(),
    then: (yes, no) => Promise.resolve().then(resolve).then(yes, no)
  };
  return q;
}
function doc(value, collection) {
  const principal = require('../middleware/requestContext').getAuthContext();
  const result = { ...value, _id: value._id || id(), ownerId: principal?.id || String(actorId), companyId: principal?.companyId || null };
  if (Array.isArray(result.lines)) result.lines = result.lines.map(line => ({ ...line, _id: line._id || id() }));
  result.save = jest.fn(async () => { collection.set(String(result._id), result); return result; });
  return result;
}
function snapshot() {
  const cloneMap = map => new Map([...map.entries()].map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
  return { products: cloneMap(state.products), suppliers: cloneMap(state.suppliers), warehouses: cloneMap(state.warehouses), purchaseOrders: cloneMap(state.purchaseOrders), goodsReceipts: cloneMap(state.goodsReceipts), pallets: cloneMap(state.pallets), putaways: cloneMap(state.putaways), locations: cloneMap(state.locations) };
}
function restore(value) { state = value; }
function makeSession() {
  return {
    withTransaction: jest.fn(async callback => {
      const previous = transactionQueue;
      let release;
      transactionQueue = new Promise(resolve => { release = resolve; });
      await previous;
      const before = snapshot();
      try { const result = await callback(); commits += 1; return result; }
      catch (error) { restore(before); aborts += 1; throw error; }
      finally { release(); }
    }),
    endSession: jest.fn()
  };
}
function findById(map, recordId) {
  return query(() => {
    const row = scoped(map.get(String(recordId)));
    return row && typeof row.save !== 'function' ? doc(row, map) : row;
  });
}
function createDocs(map, values, opts) {
  expect(opts.session).toBeDefined();
  return values.map(value => {
    const saved = doc(value, map);
    map.set(String(saved._id), saved);
    return saved;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  commits = 0; aborts = 0; palletWrites = 0; failPalletWrite = null; failReceiptSave = false; transactionQueue = Promise.resolve();
  const product = { _id: productId, companyId: companyA, ownerId: actorId, name: 'Widget', skuNumber: 'W-1', size: 2, department: 'Parts' };
  const product2 = { _id: product2Id, companyId: companyA, ownerId: actorId, name: 'Gadget', skuNumber: 'G-2', size: 1, department: 'Parts' };
  const supplier = { _id: supplierId, companyId: companyA, ownerId: actorId, name: 'Supplier One', active: true };
  const warehouse = { _id: warehouseId, companyId: companyA, ownerId: actorId, active: true };
  const location = { _id: locationId, companyId: companyA, ownerId: actorId, warehouse: warehouseId, fullName: 'A-01', status: 'empty', size: 0, maxSize: 100, palletId: [], save: jest.fn(async function save() { state.locations.set(String(this._id), this); return this; }) };
  state = { products: new Map([[String(productId), product], [String(product2Id), product2]]), suppliers: new Map([[String(supplierId), supplier]]), warehouses: new Map([[String(warehouseId), warehouse]]), locations: new Map([[String(locationId), location]]), purchaseOrders: new Map(), goodsReceipts: new Map(), pallets: new Map(), putaways: new Map() };

  Item.findById.mockImplementation(key => query(() => scoped(state.products.get(String(key)))));
  Supplier.findOne.mockImplementation(filter => query(() => {
    const row = scoped(state.suppliers.get(String(filter._id)));
    return row && row.active !== false ? row : null;
  }));
  Warehouse.findOne.mockImplementation(filter => {
    const row = scoped(state.warehouses.get(String(filter._id)));
    return query(() => row && row.active !== false ? row : null);
  });
  Location.findOne.mockImplementation(filter => query(() => {
    const row = scoped([...state.locations.values()].find(entry => entry.fullName === filter.fullName && String(entry.warehouse) === String(filter.warehouse)));
    return row;
  }));
  PurchaseOrder.create.mockImplementation((values, opts) => createDocs(state.purchaseOrders, values, opts));
  PurchaseOrder.findById.mockImplementation(key => findById(state.purchaseOrders, key));
  GoodsReceipt.create.mockImplementation((values, opts) => {
    if (failReceiptSave) throw new Error('injected GRN persistence failure');
    return createDocs(state.goodsReceipts, values, opts);
  });
  GoodsReceipt.findById.mockImplementation(key => findById(state.goodsReceipts, key));
  GoodsReceipt.findOne.mockImplementation(filter => query(() => scoped([...state.goodsReceipts.values()].find(entry => entry.requestKey === filter.requestKey))));
  Pallet.create.mockImplementation((values, opts) => {
    palletWrites += 1;
    if (palletWrites === failPalletWrite) throw new Error('injected pallet write failure');
    return createDocs(state.pallets, values, opts);
  });
  Pallet.findById.mockImplementation(key => findById(state.pallets, key));
  Putaway.findOne.mockImplementation(filter => query(() => scoped([...state.putaways.values()].find(entry => entry.requestKey === filter.requestKey))));
  Putaway.create.mockImplementation((values, opts) => createDocs(state.putaways, values, opts));
  jest.spyOn(mongoose, 'startSession').mockImplementation(async () => makeSession());
});

afterEach(() => mongoose.startSession.mockRestore());

async function asCompany(companyId, callback) { return runWithAuth(tenant(companyId), callback); }
async function createAndSubmit(lines = [{ productId, orderedQuantity: 5, unitCost: 10 }]) {
  const po = await asCompany(companyA, () => service.createPurchaseOrder({ supplierId: String(supplierId), warehouseId: String(warehouseId), lines, userId: String(actorId), req: reqFor() }));
  return asCompany(companyA, () => service.submitPurchaseOrder({ purchaseOrderId: String(po._id), expectedRevision: 0, userId: String(actorId) }));
}
async function receive(po, quantity, key = 'receive-key-0001', line = po.lines[0], expectedRevision = po.revision) {
  return asCompany(companyA, () => service.recordGoodsReceipt({ purchaseOrderId: String(po._id), expectedRevision, lines: [{ purchaseOrderLineId: String(line._id), quantity }], requestKey: key, userId: String(actorId), req: reqFor() }));
}

test('creates a draft PO against tenant-owned supplier, products and warehouse without changing inventory', async () => {
  const po = await asCompany(companyA, () => service.createPurchaseOrder({ supplierId: String(supplierId), warehouseId: String(warehouseId), lines: [{ productId: String(productId), orderedQuantity: 4 }], userId: String(actorId), req: reqFor() }));
  expect(po.status).toBe('draft'); expect(po.reference).toMatch(/^PO-/); expect(po.lines[0]).toMatchObject({ orderedQuantity: 4, receivedQuantity: 0 });
  expect(state.pallets.size).toBe(0); expect(commits).toBe(1);
});

test('supports partial then complete receipts while PO alone never increases stock', async () => {
  let po = await createAndSubmit();
  const first = await receive(po, 2, 'partial-receipt-001');
  expect(first.receipt.reference).toMatch(/^GRN-/); expect(String(first.receipt.receivedBy)).toBe(String(actorId));
  po = state.purchaseOrders.get(String(po._id)); expect(po.status).toBe('partially_received'); expect(po.lines[0].receivedQuantity).toBe(2);
  const second = await receive(po, 3, 'complete-receipt-01');
  expect(second.receipt.status).toBe('received');
  expect(state.purchaseOrders.get(String(po._id)).status).toBe('completed');
  expect([...state.pallets.values()].reduce((sum, pallet) => sum + pallet.cont, 0)).toBe(5);
  expect([...state.pallets.values()].every(pallet => pallet.contAvailable === 0)).toBe(true);
});

test('duplicate GRN idempotency key replays the original receipt without a second stock receipt', async () => {
  const po = await createAndSubmit();
  const revision = po.revision;
  const first = await receive(po, 2, 'same-grn-key-001', po.lines[0], revision);
  const replay = await receive(po, 2, 'same-grn-key-001', po.lines[0], revision);
  expect(replay.idempotentReplay).toBe(true); expect(String(replay.receipt._id)).toBe(String(first.receipt._id));
  expect(state.pallets.size).toBe(1); expect(state.purchaseOrders.get(String(po._id)).lines[0].receivedQuantity).toBe(2);
});

test('reusing a GRN idempotency key with different receipt contents is rejected', async () => {
  const po = await createAndSubmit();
  await receive(po, 2, 'same-key-different-001');
  await expect(receive(po, 3, 'same-key-different-001')).rejects.toThrow(/different goods receipt/i);
  expect(state.goodsReceipts.size).toBe(1);
  expect(state.pallets.size).toBe(1);
  expect(state.purchaseOrders.get(String(po._id)).lines[0].receivedQuantity).toBe(2);
});

test('concurrent duplicate GRN requests create one receipt and one stock movement set', async () => {
  const po = await createAndSubmit();
  const results = await Promise.all([receive(po, 2, 'concurrent-grn-001'), receive(po, 2, 'concurrent-grn-001')]);
  expect(results.filter(result => result.idempotentReplay)).toHaveLength(1);
  expect(state.goodsReceipts.size).toBe(1); expect(state.pallets.size).toBe(1);
  expect(state.purchaseOrders.get(String(po._id)).lines[0].receivedQuantity).toBe(2);
});

test('concurrent distinct GRN keys cannot receive the same PO revision twice', async () => {
  const po = await createAndSubmit();
  const results = await Promise.allSettled([
    receive(po, 5, 'grn-distinct-concurrent-1'),
    receive(po, 5, 'grn-distinct-concurrent-2')
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(state.goodsReceipts.size).toBe(1);
  expect(state.pallets.size).toBe(1);
  expect(state.purchaseOrders.get(String(po._id)).lines[0].receivedQuantity).toBe(5);
});

test('rejects excess receiving before any pallet write', async () => {
  const po = await createAndSubmit();
  await expect(receive(po, 6, 'excess-receipt-001')).rejects.toThrow(/exceeds outstanding/i);
  expect(state.pallets.size).toBe(0); expect(state.goodsReceipts.size).toBe(0); expect(aborts).toBe(1);
});

test('inspection records accepted and rejected quantities, damaged and incorrect counts, and isolates quarantine', async () => {
  const po = await createAndSubmit(); const grn = await receive(po, 4).then(value => value.receipt); const line = grn.lines[0];
  const updated = await asCompany(companyA, () => service.inspectGoodsReceiptLine({ receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 0, acceptedQuantity: 2, rejectedQuantity: 2, damagedQuantity: 1, incorrectQuantity: 1, reason: 'Two packages failed inspection', userId: String(actorId) }));
  const pallet = state.pallets.get(String(line.receiptPalletId));
  expect(updated.lines[0]).toMatchObject({ acceptedQuantity: 2, rejectedQuantity: 2, damagedQuantity: 1, incorrectQuantity: 1 });
  expect(pallet.cont).toBe(4); expect(pallet.contAvailable).toBe(0); expect(pallet.contQuarantined).toBe(2);
  expect(pallet.movementLog.at(-1).type).toBe('quarantine');
  await expect(asCompany(companyA, () => service.inspectGoodsReceiptLine({ receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 1, acceptedQuantity: 3, rejectedQuantity: 2, damagedQuantity: 1, incorrectQuantity: 1, reason: 'Over inspection', userId: String(actorId) }))).rejects.toThrow(/cannot exceed/i);
});

test('putaway rejects quantities above accepted outstanding and validates location capacity', async () => {
  const po = await createAndSubmit(); const grn = (await receive(po, 3)).receipt; const line = grn.lines[0];
  await asCompany(companyA, () => service.inspectGoodsReceiptLine({ receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 0, acceptedQuantity: 2, rejectedQuantity: 1, reason: 'One damaged', userId: String(actorId) }));
  const args = { receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 1, quantity: 3, locationName: 'A-01', requestKey: 'putaway-over-001', userId: String(actorId), req: reqFor() };
  await expect(asCompany(companyA, () => service.putawayAcceptedQuantity(args))).rejects.toThrow(/exceeds accepted/i);
  expect(state.putaways.size).toBe(0); expect([...state.pallets.values()].length).toBe(1);
});

test('putaway records a duplicate-safe movement and inventory ledger consistently', async () => {
  const po = await createAndSubmit(); const grn = (await receive(po, 3)).receipt; const line = grn.lines[0];
  await asCompany(companyA, () => service.inspectGoodsReceiptLine({ receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 0, acceptedQuantity: 2, rejectedQuantity: 1, reason: 'One damaged', userId: String(actorId) }));
  const args = { receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 1, quantity: 2, locationName: 'A-01', requestKey: 'putaway-good-001', userId: String(actorId), req: reqFor() };
  const result = await asCompany(companyA, () => service.putawayAcceptedQuantity(args));
  const replay = await asCompany(companyA, () => service.putawayAcceptedQuantity(args));
  expect(result.putaway.quantity).toBe(2); expect(replay.idempotentReplay).toBe(true);
  expect(replay.receipt).toBeDefined();
  expect(state.pallets.size).toBe(2); expect(state.putaways.size).toBe(1);
  const source = state.pallets.get(String(line.receiptPalletId)); const destination = state.pallets.get(String(result.destinationPallet._id));
  expect(source.cont).toBe(1); expect(source.contQuarantined).toBe(1); expect(destination.contAvailable).toBe(2);
  expect(destination.movementLog[0]).toMatchObject({ type: 'stock-in', quantity: 2, onHandAfter: 2 });
  expect([...state.pallets.values()].reduce((sum, pallet) => sum + pallet.cont, 0)).toBe(3);
  expect(state.locations.get(String(locationId)).size).toBe(4);
});

test('putaway is limited to assigned warehouses and destination capacity', async () => {
  const po = await createAndSubmit(); const grn = (await receive(po, 2)).receipt; const line = grn.lines[0];
  await asCompany(companyA, () => service.inspectGoodsReceiptLine({ receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 0, acceptedQuantity: 2, rejectedQuantity: 0, reason: 'Good condition', userId: String(actorId) }));
  const args = { receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 1, quantity: 1, locationName: 'A-01', requestKey: 'putaway-scope-001', userId: String(actorId), req: reqFor(companyA, [id()]) };
  await expect(asCompany(companyA, () => service.putawayAcceptedQuantity(args))).rejects.toThrow(/not assigned/i);
  state.locations.get(String(locationId)).maxSize = 1;
  await expect(asCompany(companyA, () => service.putawayAcceptedQuantity({ ...args, req: reqFor() }))).rejects.toThrow(/capacity/i);
  expect(state.putaways.size).toBe(0);
});

test('putaway rejects destination locations with unknown or unavailable statuses', async () => {
  const po = await createAndSubmit(); const grn = (await receive(po, 1)).receipt; const line = grn.lines[0];
  await asCompany(companyA, () => service.inspectGoodsReceiptLine({ receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 0, acceptedQuantity: 1, rejectedQuantity: 0, reason: 'Good condition', userId: String(actorId) }));
  state.locations.get(String(locationId)).status = 'unknown';
  await expect(asCompany(companyA, () => service.putawayAcceptedQuantity({ receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 1, quantity: 1, locationName: 'A-01', requestKey: 'unknown-location-001', userId: String(actorId), req: reqFor() }))).rejects.toThrow(/not available/i);
  expect(state.putaways.size).toBe(0);
});

test('concurrent duplicate putaway requests commit one destination pallet and movement', async () => {
  const po = await createAndSubmit(); const grn = (await receive(po, 3)).receipt; const line = grn.lines[0];
  await asCompany(companyA, () => service.inspectGoodsReceiptLine({ receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 0, acceptedQuantity: 2, rejectedQuantity: 1, reason: 'One damaged', userId: String(actorId) }));
  const args = { receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 1, quantity: 2, locationName: 'A-01', requestKey: 'concurrent-putaway', userId: String(actorId), req: reqFor() };
  const results = await Promise.all([asCompany(companyA, () => service.putawayAcceptedQuantity(args)), asCompany(companyA, () => service.putawayAcceptedQuantity(args))]);
  expect(results.filter(result => result.idempotentReplay)).toHaveLength(1);
  expect(state.putaways.size).toBe(1); expect(state.pallets.size).toBe(2);
  expect(state.purchaseOrders.get(String(po._id)).lines[0].receivedQuantity).toBe(3);
});

test('concurrent distinct putaway keys cannot put away the same accepted quantity twice', async () => {
  const po = await createAndSubmit();
  const grn = (await receive(po, 2)).receipt;
  const line = grn.lines[0];
  await asCompany(companyA, () => service.inspectGoodsReceiptLine({
    receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 0,
    acceptedQuantity: 2, rejectedQuantity: 0, reason: 'All goods passed inspection', userId: String(actorId)
  }));
  const args = {
    receiptId: String(grn._id), lineId: String(line._id), expectedRevision: 1,
    quantity: 2, locationName: 'A-01', userId: String(actorId), req: reqFor()
  };
  const results = await Promise.allSettled([
    asCompany(companyA, () => service.putawayAcceptedQuantity({ ...args, requestKey: 'putaway-distinct-key-1' })),
    asCompany(companyA, () => service.putawayAcceptedQuantity({ ...args, requestKey: 'putaway-distinct-key-2' }))
  ]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(state.putaways.size).toBe(1);
  expect(state.pallets.size).toBe(2);
  expect(state.purchaseOrders.get(String(po._id)).lines[0].receivedQuantity).toBe(2);
});

test('denies cross-company access to an existing purchase order', async () => {
  const po = await createAndSubmit();
  await expect(asCompany(companyB, () => service.recordGoodsReceipt({ purchaseOrderId: String(po._id), expectedRevision: 1, lines: [{ purchaseOrderLineId: String(po.lines[0]._id), quantity: 1 }], requestKey: 'cross-company-001', userId: String(actorId), req: reqFor(companyB) }))).rejects.toThrow(/not found/i);
  expect(state.pallets.size).toBe(0);
});

test('denies warehouse users who are not assigned to the PO warehouse', async () => {
  const po = await createAndSubmit(); const unassignedReq = reqFor(companyA, [id()]);
  await expect(asCompany(companyA, () => service.recordGoodsReceipt({ purchaseOrderId: String(po._id), expectedRevision: po.revision, lines: [{ purchaseOrderLineId: String(po.lines[0]._id), quantity: 1 }], requestKey: 'unassigned-warehouse', userId: String(actorId), req: unassignedReq }))).rejects.toThrow(/not assigned/i);
  expect(state.pallets.size).toBe(0);
});

test('aborts all writes when a later pallet creation in a multi-line receipt fails', async () => {
  const po = await createAndSubmit([{ productId: String(productId), orderedQuantity: 5 }, { productId: String(product2Id), orderedQuantity: 5 }]);
  const commitsBefore = commits;
  failPalletWrite = 2;
  await expect(asCompany(companyA, () => service.recordGoodsReceipt({ purchaseOrderId: String(po._id), expectedRevision: po.revision, lines: po.lines.map(line => ({ purchaseOrderLineId: String(line._id), quantity: 1 })), requestKey: 'atomic-receipt-001', userId: String(actorId), req: reqFor() }))).rejects.toThrow(/injected pallet write failure/i);
  expect(state.pallets.size).toBe(0); expect(state.goodsReceipts.size).toBe(0); expect(state.purchaseOrders.get(String(po._id)).lines.every(line => line.receivedQuantity === 0)).toBe(true);
  expect(commits).toBe(commitsBefore); expect(aborts).toBe(1);
});

test('a failed receipt transaction can be retried with the same idempotency key', async () => {
  const po = await createAndSubmit();
  failPalletWrite = 1;
  const args = {
    purchaseOrderId: String(po._id), expectedRevision: po.revision,
    lines: [{ purchaseOrderLineId: String(po.lines[0]._id), quantity: 1 }],
    requestKey: 'retry-after-failure-001', userId: String(actorId), req: reqFor()
  };
  await expect(asCompany(companyA, () => service.recordGoodsReceipt(args))).rejects.toThrow(/injected pallet write failure/i);
  failPalletWrite = null;
  const result = await asCompany(companyA, () => service.recordGoodsReceipt(args));
  expect(result.idempotentReplay).toBe(false);
  expect(state.goodsReceipts.size).toBe(1);
  expect(state.pallets.size).toBe(1);
  expect(state.purchaseOrders.get(String(po._id)).lines[0].receivedQuantity).toBe(1);
});

test('rolls back pallet and PO writes when GRN persistence fails', async () => {
  const po = await createAndSubmit(); failReceiptSave = true;
  await expect(receive(po, 1, 'grn-save-failure')).rejects.toThrow(/injected GRN persistence failure/i);
  expect(state.pallets.size).toBe(0); expect(state.goodsReceipts.size).toBe(0); expect(state.purchaseOrders.get(String(po._id)).lines[0].receivedQuantity).toBe(0);
  expect(aborts).toBe(1);
});

test('rejects receiving when the destination warehouse is not in the company', async () => {
  const po = await createAndSubmit();
  state.warehouses.delete(String(warehouseId));
  await expect(receive(po, 1, 'invalid-warehouse-001')).rejects.toThrow(/warehouse/i);
  expect(state.pallets.size).toBe(0);
});

const { movementDateMatch, movementTotals, qualityTotals } = require('../services/movementReport');
const { runWithAuth } = require('../middleware/requestContext');
const Pallet = require('../model/Pallets');
const GoodsReceipt = require('../model/GoodsReceipt');

const companyA = '64b000000000000000000010';
const warehouseA = '64b000000000000000000030';
const warehouseB = '64b000000000000000000031';

function groupsFrom(events) {
  const grouped = new Map();
  for (const event of events) {
    const key = `${event.type}|${event.referenceType || ''}`;
    const group = grouped.get(key) || { type: event.type, referenceType: event.referenceType, count: 0, quantity: 0 };
    group.count += 1;
    group.quantity += event.quantity;
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

test('reports receipt once across partial GRN, quarantine and internal putaway lifecycle', () => {
  const events = [
    { type: 'receipt', referenceType: 'goods_receipt', quantity: 6, warehouse: 'A' },
    { type: 'receipt', referenceType: 'goods_receipt', quantity: 4, warehouse: 'B' },
    { type: 'quarantine', referenceType: 'goods_receipt', quantity: 2, warehouse: 'A' },
    { type: 'putaway', referenceType: 'goods_receipt', quantity: 4, warehouse: 'A' },
    // Putaway destination is represented as stock-in, but is not a new receipt.
    { type: 'stock-in', referenceType: 'goods_receipt', quantity: 4, warehouse: 'A' },
    { type: 'stock-in', quantity: 3, warehouse: 'B' }, // manual stock-in
  ];
  expect(movementTotals(groupsFrom(events))).toMatchObject({
    received: { count: 3, quantity: 13 },
    stockIn: { count: 3, quantity: 13 },
    quarantined: { count: 1, quantity: 2 },
    shipped: { count: 0, quantity: 0 }
  });
});

test('only dispatch is shipped; reservation, picking, release, legacy stock-out and putaway are excluded', () => {
  const events = [
    { type: 'reserve', referenceType: 'order', quantity: 5 },
    { type: 'pick', referenceType: 'order', quantity: 4 },
    { type: 'release', referenceType: 'order', quantity: 3 }, // short pick and cancellation release
    { type: 'stock-out', quantity: 4 }, // legacy ticket/pick deduction, not dispatch evidence
    { type: 'putaway', referenceType: 'goods_receipt', quantity: 4 },
    { type: 'dispatch', referenceType: 'order', quantity: 4 }
  ];
  expect(movementTotals(groupsFrom(events)).shipped).toEqual({ count: 1, quantity: 4 });
});

test('quality totals keep rejected and damaged distinct without adding damaged twice', () => {
  expect(qualityTotals([{ rejected: 3, damaged: 2, incorrect: 1 }])).toEqual({
    rejected: 3, damaged: 2, incorrect: 1
  });
});

test('date ranges use inclusive UTC days and exact timestamp boundaries', () => {
  expect(movementDateMatch('2026-05-01', '2026-05-03')).toEqual({
    'movementLog.createdAt': {
      $gte: new Date('2026-05-01T00:00:00.000Z'),
      $lt: new Date('2026-05-04T00:00:00.000Z')
    }
  });
  expect(movementDateMatch('2026-05-01T12:30:00.000Z', '2026-05-02T10:00:00.000Z')).toEqual({
    'movementLog.createdAt': {
      $gte: new Date('2026-05-01T12:30:00.000Z'),
      $lte: new Date('2026-05-02T10:00:00.000Z')
    }
  });
  expect(() => movementDateMatch('2026-02-30', undefined)).toThrow('from must be a valid date');
});

test('report source aggregations retain company and assigned multi-warehouse isolation', async () => {
  const principal = {
    id: '64b000000000000000000001', role: 'warehouse_manager', companyId: companyA,
    warehouseScoped: true, allowedWarehouseIds: [warehouseA, warehouseB]
  };
  for (const Model of [Pallet, GoodsReceipt]) {
    const aggregate = Model.aggregate([{ $unwind: Model === Pallet ? '$movementLog' : '$lines' }]);
    const hook = Model.schema.s.hooks._pres.get('aggregate').find(row => row.fn.name === 'scopeAggregate').fn;
    await runWithAuth(principal, () => new Promise((resolve, reject) => {
      hook.call(aggregate, error => (error ? reject(error) : resolve()));
    }));
    expect(aggregate.pipeline()[0]).toEqual({ $match: {
      companyId: companyA, warehouseId: { $in: [warehouseA, warehouseB] }
    } });
  }
});

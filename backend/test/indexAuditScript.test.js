'use strict';

const {
  EXPECTED,
  duplicatePipeline,
  matchingIndex,
  parseArgs,
  uriTarget
} = require('../scripts/auditProcurementIndexes');

test('declares all company and legacy scoped unique indexes', () => {
  expect(EXPECTED).toHaveLength(10);
  expect(EXPECTED).toEqual(expect.arrayContaining([
    expect.objectContaining({ collection: 'inventory_operations', key: { companyId: 1, requestKey: 1 }, unique: true }),
    expect.objectContaining({ collection: 'goods_receipts', key: { companyId: 1, reference: 1 }, unique: true }),
    expect.objectContaining({ collection: 'goods_receipts', key: { companyId: 1, requestKey: 1 }, unique: true }),
    expect.objectContaining({ collection: 'putaways', key: { companyId: 1, requestKey: 1 }, unique: true }),
    expect.objectContaining({ collection: 'purchase_orders', key: { companyId: 1, reference: 1 }, unique: true })
  ]));
  for (const spec of EXPECTED) {
    expect(spec.key).toHaveProperty(spec.partialFilterExpression.companyId ? 'companyId' : 'ownerId');
    expect(spec.unique).toBe(true);
  }
});

test('requires an explicit dry-run and rejects unrecognized flags', () => {
  expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  expect(parseArgs([]).dryRun).toBe(false);
  expect(() => parseArgs(['--apply'])).toThrow(/Unknown argument/);
});

test('requires exact key, uniqueness, and partial scope to accept an index', () => {
  const spec = EXPECTED[0];
  expect(matchingIndex(spec, {
    key: { companyId: 1, requestKey: 1 }, unique: true,
    partialFilterExpression: { companyId: { $type: 'objectId' } }
  })).toBe(true);
  expect(matchingIndex(spec, { key: spec.key, unique: false, partialFilterExpression: spec.partialFilterExpression })).toBe(false);
  expect(matchingIndex(spec, { key: spec.key, unique: true, partialFilterExpression: {} })).toBe(false);
});

test('duplicate scan groups by all indexed fields after applying scope filter', () => {
  const pipeline = duplicatePipeline(EXPECTED[0]);
  expect(pipeline[0]).toEqual({ $match: { companyId: { $type: 'objectId' } } });
  expect(pipeline[1].$group._id).toEqual({ companyId: '$companyId', requestKey: '$requestKey' });
  expect(pipeline[2]).toEqual({ $match: { duplicateCount: { $gt: 1 } } });
});

test('parses a database target and marks loopback as local', () => {
  expect(uriTarget('mongodb://127.0.0.1:27017/wareflow_test?replicaSet=rs0')).toEqual({
    hostname: '127.0.0.1', database: 'wareflow_test', isLocal: true
  });
  expect(uriTarget('mongodb+srv://example.invalid/wareflow_test').isLocal).toBe(false);
});

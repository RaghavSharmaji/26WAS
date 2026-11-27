const InventoryOperation = require('../model/InventoryOperation');
const PurchaseOrder = require('../model/PurchaseOrder');
const GoodsReceipt = require('../model/GoodsReceipt');
const Putaway = require('../model/Putaway');

function hasUniqueIndex(Model, key, partialField) {
  return Model.schema.indexes().some(([indexKey, options]) => (
    JSON.stringify(indexKey) === JSON.stringify(key)
    && options.unique === true
    && options.partialFilterExpression?.[partialField] !== undefined
  ));
}

test('purchase order and GRN references have company-scoped and legacy uniqueness', () => {
  expect(hasUniqueIndex(PurchaseOrder, { companyId: 1, reference: 1 }, 'companyId')).toBe(true);
  expect(hasUniqueIndex(PurchaseOrder, { ownerId: 1, reference: 1 }, 'companyId')).toBe(true);
  expect(hasUniqueIndex(GoodsReceipt, { companyId: 1, reference: 1 }, 'companyId')).toBe(true);
  expect(hasUniqueIndex(GoodsReceipt, { ownerId: 1, reference: 1 }, 'companyId')).toBe(true);
});

test('GRN, putaway and inventory operation idempotency keys are unique per company and legacy owner', () => {
  expect(hasUniqueIndex(GoodsReceipt, { companyId: 1, requestKey: 1 }, 'companyId')).toBe(true);
  expect(hasUniqueIndex(GoodsReceipt, { ownerId: 1, requestKey: 1 }, 'companyId')).toBe(true);
  expect(hasUniqueIndex(Putaway, { companyId: 1, requestKey: 1 }, 'companyId')).toBe(true);
  expect(hasUniqueIndex(Putaway, { ownerId: 1, requestKey: 1 }, 'companyId')).toBe(true);
  expect(hasUniqueIndex(InventoryOperation, { companyId: 1, requestKey: 1 }, 'companyId')).toBe(true);
  expect(hasUniqueIndex(InventoryOperation, { ownerId: 1, requestKey: 1 }, 'companyId')).toBe(true);
});

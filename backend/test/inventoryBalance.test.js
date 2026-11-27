const { availableQuantity, availableQuantityExpression } = require('../services/inventoryBalance');

test('availability excludes receiving and damaged pallets and subtracts legacy quarantine', () => {
  expect(availableQuantity({ status: 'receiving', cont: 8, contAvailable: 0 })).toBe(0);
  expect(availableQuantity({ status: 'damaged', cont: 8, contAvailable: 8 })).toBe(0);
  expect(availableQuantity({ status: 'store', cont: 8, contQuarantined: 3 })).toBe(5);
  expect(availableQuantity({ status: 'store', cont: 8, contAvailable: 6, contQuarantined: 2 })).toBe(6);
  expect(availableQuantity({ status: 'store', cont: 8, contAvailable: 8, contQuarantined: 2 })).toBe(6);
});

test('Mongo aggregation availability expression excludes held statuses and falls back around quarantine', () => {
  expect(availableQuantityExpression()).toEqual({
    $cond: [
      { $in: ['$status', ['receiving', 'damaged']] },
      0,
      {
        $min: [
          { $max: [0, { $ifNull: ['$contAvailable', { $max: [0, { $subtract: [{ $ifNull: ['$cont', 0] }, { $ifNull: ['$contQuarantined', 0] }] }] }] }] },
          { $max: [0, { $subtract: [{ $ifNull: ['$cont', 0] }, { $ifNull: ['$contQuarantined', 0] }] }] }
        ]
      }
    ]
  });
});

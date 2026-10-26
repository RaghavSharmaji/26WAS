jest.mock('../model/Pallets', () => ({ findById: jest.fn(), findOneAndUpdate: jest.fn(), create: jest.fn() }));
jest.mock('../model/Item', () => ({ findOne: jest.fn() }));

const Pallet = require('../model/Pallets');
const Item = require('../model/Item');
const { changePalletStock } = require('../services/inventoryService');

const palletId = '64b000000000000000000001';
const userId = '64b000000000000000000002';
const doc = (available, version = 0) => ({ _id: palletId, cont: 10, contAvailable: available, __v: version });
const leanResult = value => ({ lean: () => ({ exec: async () => value }) });

beforeEach(() => jest.clearAllMocks());

describe('inventory stock changes', () => {
  test('stock-out atomically decrements availability and appends the movement', async () => {
    Pallet.findById.mockReturnValue(leanResult(doc(5)));
    Pallet.findOneAndUpdate.mockReturnValue(leanResult({ _id: palletId, contAvailable: 3 }));
    const result = await changePalletStock({
      palletId, type: 'stock-out', quantity: 2, reason: 'Order pick', userId
    });

    const [filter, update] = Pallet.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({ _id: palletId, __v: 0, contAvailable: 5 });
    expect(update.$set.contAvailable).toBe(3);
    expect(update.$push.movementLog).toMatchObject({
      type: 'stock-out', quantity: 2, delta: -2, stockBefore: 5, stockAfter: 3,
      reason: 'Order pick', responsibleUser: userId
    });
    expect(result.pallet.contAvailable).toBe(3);
  });

  test('rejects stock-out beyond available quantity without updating MongoDB', async () => {
    Pallet.findById.mockReturnValue(leanResult(doc(1)));
    await expect(changePalletStock({
      palletId, type: 'stock-out', quantity: 2, reason: 'Pick', userId
    })).rejects.toMatchObject({ status: 409, message: 'Insufficient stock for this operation' });
    expect(Pallet.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('retries a compare-and-set after a concurrent update', async () => {
    Pallet.findById
      .mockReturnValueOnce(leanResult(doc(5, 0)))
      .mockReturnValueOnce(leanResult(doc(7, 1)));
    Pallet.findOneAndUpdate
      .mockReturnValueOnce(leanResult(null))
      .mockReturnValueOnce(leanResult({ _id: palletId, contAvailable: 6 }));
    await changePalletStock({ palletId, type: 'stock-out', quantity: 1, reason: 'Pick', userId });
    expect(Pallet.findById).toHaveBeenCalledTimes(2);
    expect(Pallet.findOneAndUpdate.mock.calls[1][1].$push.movementLog.stockBefore).toBe(7);
  });

  test('rejects adjustments that would set stock below zero', async () => {
    Pallet.findById.mockReturnValue(leanResult(doc(0)));
    await expect(changePalletStock({
      palletId, type: 'adjustment', newQuantity: -1, reason: 'Count correction', userId
    })).rejects.toMatchObject({ status: 400 });
    expect(Pallet.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

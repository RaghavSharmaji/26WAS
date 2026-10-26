process.env.SECRET_OR_KEY = 'unit-test-secret-that-is-long-enough';

jest.mock('../model/User', () => ({ create: jest.fn(), findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../model/Category', () => ({
  create: jest.fn(), find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), exists: jest.fn()
}));
jest.mock('../model/Supplier', () => ({
  create: jest.fn(), find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), exists: jest.fn(), countDocuments: jest.fn()
}));
jest.mock('../model/Warehouse', () => ({
  create: jest.fn(), find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), exists: jest.fn(), countDocuments: jest.fn()
}));
jest.mock('../model/Location', () => ({
  create: jest.fn(), find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(), exists: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn()
}));
jest.mock('../model/Item', () => ({
  create: jest.fn(), find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(),
  countDocuments: jest.fn(), exists: jest.fn()
}));
jest.mock('../model/Pallets', () => ({
  create: jest.fn(), find: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(),
  findOneAndUpdate: jest.fn(), aggregate: jest.fn(), exists: jest.fn()
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../server');
const User = require('../model/User');
const Category = require('../model/Category');
const Item = require('../model/Item');
const Pallet = require('../model/Pallets');

const staffId = '64b000000000000000000001';
const adminId = '64b000000000000000000002';
const tokenFor = (id, role) => jwt.sign({ id, role }, process.env.SECRET_OR_KEY);

beforeEach(() => jest.clearAllMocks());

describe('authentication and resource APIs', () => {
  test('rejects protected requests without a token', async () => {
    const response = await request(app).get('/api/categories');
    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/authentication required/i);
  });

  test('rejects an invalid token', async () => {
    const response = await request(app).get('/api/categories').set('Authorization', 'Bearer invalid');
    expect(response.status).toBe(401);
  });

  test('registers a staff account and never returns its password hash', async () => {
    User.create.mockImplementation(async value => ({ ...value, _id: staffId }));
    const response = await request(app).post('/api/auth/register').send({
      name: 'Warehouse Staff', email: 'STAFF@example.com', password: 'correct-horse-battery'
    });
    expect(response.status).toBe(201);
    expect(response.body.user.role).toBe('staff');
    expect(response.body.user.email).toBe('staff@example.com');
    expect(response.body.user.password).toBeUndefined();
    expect(jwt.verify(response.body.token, process.env.SECRET_OR_KEY).id).toBe(staffId);
    expect(User.create.mock.calls[0][0].password).not.toBe('correct-horse-battery');
  });

  test('validates registration fields before writing', async () => {
    const response = await request(app).post('/api/auth/register').send({ email: 'bad', password: 'short' });
    expect(response.status).toBe(400);
    expect(User.create).not.toHaveBeenCalled();
  });

  test('logs in and returns a signed bearer token without password data', async () => {
    const stored = {
      _id: staffId,
      name: 'Warehouse Staff',
      email: 'staff@example.com',
      role: 'staff',
      clearance: ['staff'],
      password: await bcrypt.hash('correct-horse-battery', 4)
    };
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(stored) });
    const response = await request(app).post('/api/auth/login').send({
      email: 'STAFF@example.com', password: 'correct-horse-battery'
    });
    expect(response.status).toBe(200);
    expect(response.body.user.password).toBeUndefined();
    expect(jwt.verify(response.body.token, process.env.SECRET_OR_KEY).id).toBe(staffId);
  });

  test('returns a sanitized authenticated profile', async () => {
    User.findById.mockResolvedValue({
      _id: staffId, name: 'Warehouse Staff', email: 'staff@example.com', role: 'staff',
      clearance: ['staff'], password: 'must-never-appear'
    });
    const response = await request(app).get('/api/auth/user')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
    expect(response.status).toBe(200);
    expect(response.body.user.password).toBeUndefined();
  });

  test('creates a category and maps duplicate unique values to 409', async () => {
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    Category.create.mockResolvedValue({ _id: '64b000000000000000000003', name: 'Electronics' });
    const created = await request(app).post('/api/categories')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
      .send({ name: 'Electronics' });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe('Electronics');

    Category.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }));
    const duplicate = await request(app).post('/api/categories')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`)
      .send({ name: 'Electronics' });
    expect(duplicate.status).toBe(409);
  });

  test('supports category list, retrieve, update, and safe admin deletion', async () => {
    const categoryId = '64b000000000000000000003';
    const categoryRecord = { _id: categoryId, name: 'Electronics' };
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    Category.find.mockReturnValue({
      sort: () => ({ limit: () => ({ lean: async () => [categoryRecord] }) })
    });
    const list = await request(app).get('/api/categories').set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`);
    expect(list.status).toBe(200);
    expect(list.body.data[0].name).toBe('Electronics');

    const deleteOne = jest.fn().mockResolvedValue({});
    Category.findById
      .mockReturnValueOnce({ lean: async () => categoryRecord })
      .mockResolvedValueOnce({ ...categoryRecord, deleteOne });
    const read = await request(app).get(`/api/categories/${categoryId}`).set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`);
    expect(read.status).toBe(200);
    expect(read.body.data.name).toBe('Electronics');

    Category.findByIdAndUpdate.mockResolvedValue({ ...categoryRecord, name: 'Devices' });
    const updated = await request(app).put(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).send({ name: 'Devices' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Devices');

    Item.exists.mockResolvedValue(false);
    const deleted = await request(app).delete(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`);
    expect(deleted.status).toBe(200);
    expect(deleteOne).toHaveBeenCalled();
  });

  test('rejects category deletion while products still reference it', async () => {
    const categoryId = '64b000000000000000000003';
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    Category.findById.mockResolvedValue({ _id: categoryId });
    Item.exists.mockResolvedValue(true);
    const response = await request(app).delete(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`);
    expect(response.status).toBe(409);
  });

  test('creates, updates, and safely deletes a catalog product; duplicate SKU returns 409', async () => {
    const productId = '64b000000000000000000004';
    const product = { _id: productId, name: 'Laptop', skuNumber: 'LAP-TEST', size: 1, department: 'IT' };
    User.findById.mockResolvedValue({ _id: adminId, role: 'admin' });
    Item.create.mockResolvedValue(product);
    const created = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
      .send({ name: 'Laptop', skuNumber: 'LAP-TEST', size: 1, department: 'IT' });
    expect(created.status).toBe(201);

    Item.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }));
    const duplicate = await request(app).post('/api/products')
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`)
      .send({ name: 'Laptop', skuNumber: 'LAP-TEST', size: 1, department: 'IT' });
    expect(duplicate.status).toBe(409);

    Item.findByIdAndUpdate.mockResolvedValue({ ...product, description: 'Updated' });
    const updated = await request(app).put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`).send({ description: 'Updated' });
    expect(updated.status).toBe(200);

    const deleteOne = jest.fn().mockResolvedValue({});
    Item.findById.mockResolvedValue({ ...product, deleteOne });
    Pallet.exists.mockResolvedValue(false);
    const deleted = await request(app).delete(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${tokenFor(adminId, 'admin')}`);
    expect(deleted.status).toBe(200);
    expect(deleteOne).toHaveBeenCalled();
  });

  test('rejects invalid identifiers and requires admin role for deletes', async () => {
    User.findById.mockResolvedValue({ _id: staffId, role: 'staff' });
    const invalidId = await request(app).get('/api/categories/not-an-id')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
    expect(invalidId.status).toBe(400);

    const denied = await request(app).delete('/api/categories/64b000000000000000000003')
      .set('Authorization', `Bearer ${tokenFor(staffId, 'staff')}`);
    expect(denied.status).toBe(403);
  });
});

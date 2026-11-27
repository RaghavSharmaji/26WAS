const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const integrationUri = process.env.WAREFLOW_TICKET_TEST_URI;
const describeIfLocalReplica = integrationUri ? describe : describe.skip;

if (integrationUri) {
  const parsedUri = new URL(integrationUri);
  if (parsedUri.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost', '::1'].includes(parsedUri.hostname)) {
    throw new Error('WAREFLOW_TICKET_TEST_URI must connect to a local loopback MongoDB only.');
  }
  if (!parsedUri.pathname.includes('wareflow_ticket_test')) {
    throw new Error('WAREFLOW_TICKET_TEST_URI database name must include wareflow_ticket_test.');
  }
}

process.env.SECRET_OR_KEY = process.env.SECRET_OR_KEY || 'ticket-fulfillment-integration-test-secret';

const app = require('../server');
const User = require('../model/User');
const Company = require('../model/Company');
const CompanyMembership = require('../model/CompanyMembership');
const Warehouse = require('../model/Warehouse');
const Item = require('../model/Item');
const Pallet = require('../model/Pallets');
const Product = require('../model/Product');
const Order = require('../model/Order');
const Ticket = require('../model/Ticket');

describeIfLocalReplica('ticket fulfillment transactions on local MongoDB replica set', () => {
  let fixtures;
  let originalProductSave;
  let originalTicketSave;

  beforeAll(async () => {
    await mongoose.connect(integrationUri, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([
      User.init(), Company.init(), CompanyMembership.init(), Warehouse.init(),
      Item.init(), Pallet.init(), Product.init(), Order.init(), Ticket.init()
    ]);
  });

  afterAll(async () => mongoose.disconnect());

  beforeEach(() => {
    fixtures = { users: [], companies: [], memberships: [], warehouses: [], items: [], pallets: [], orders: [] };
    originalProductSave = Product.prototype.save;
    originalTicketSave = Ticket.prototype.save;
  });

  afterEach(async () => {
    Product.prototype.save = originalProductSave;
    Ticket.prototype.save = originalTicketSave;
    if (!fixtures) return;
    await Promise.all([
      Ticket.deleteMany({ ownerId: { $in: fixtures.users } }),
      Product.deleteMany({ ownerId: { $in: fixtures.users } }),
      Order.deleteMany({ _id: { $in: fixtures.orders } }),
      Pallet.deleteMany({ _id: { $in: fixtures.pallets } }),
      Item.deleteMany({ _id: { $in: fixtures.items } }),
      CompanyMembership.deleteMany({ _id: { $in: fixtures.memberships } }),
      Warehouse.deleteMany({ _id: { $in: fixtures.warehouses } }),
      Company.deleteMany({ _id: { $in: fixtures.companies } }),
      User.deleteMany({ _id: { $in: fixtures.users } })
    ]);
  });

  async function createTenant({ role = 'warehouse_manager', secondCompany = false } = {}) {
    const suffix = crypto.randomBytes(8).toString('hex');
    const company = await Company.create({ name: `Ticket ${suffix}`, slug: `ticket-${suffix}`, status: 'active' });
    fixtures.companies.push(company._id);
    const user = await User.create({
      name: `Ticket User ${suffix}`, email: `ticket-${suffix}@example.test`,
      password: 'hashed-test-password', role: 'staff', accountStatus: 'active'
    });
    fixtures.users.push(user._id);
    const warehouses = await Warehouse.create([
      { companyId: company._id, ownerId: user._id, name: 'Assigned', code: `A${suffix.slice(0, 7)}`, active: true },
      { companyId: company._id, ownerId: user._id, name: 'Unassigned', code: `B${suffix.slice(0, 7)}`, active: true }
    ]);
    fixtures.warehouses.push(...warehouses.map(row => row._id));
    const membership = await CompanyMembership.create({
      userId: user._id, companyId: company._id, role, status: 'active',
      assignedWarehouseIds: [warehouses[0]._id]
    });
    fixtures.memberships.push(membership._id);

    let foreign = null;
    if (secondCompany) foreign = await createTenant();
    return { company, user, warehouses, membership, foreign };
  }

  async function createOrder(tenant, { warehouse = tenant.warehouses[0], quantity = 5, stock = 10 } = {}) {
    const suffix = crypto.randomBytes(4).toString('hex');
    const item = await Item.create({
      ownerId: tenant.user._id, companyId: tenant.company._id,
      name: `Item ${suffix}`, size: 1, skuNumber: `SKU-${suffix}`, department: 'Test'
    });
    fixtures.items.push(item._id);
    const pallet = await Pallet.create({
      ownerId: tenant.user._id, companyId: tenant.company._id, warehouseId: warehouse._id,
      item: item._id, size: stock, skuNumber: item.skuNumber, status: 'store',
      location: 'A-01', cont: stock, contAvailable: stock, movementLog: []
    });
    fixtures.pallets.push(pallet._id);
    const order = await Order.create({
      ownerId: tenant.user._id, companyId: tenant.company._id, warehouseId: warehouse._id,
      status: 'create', items: [{ skuNumber: item.skuNumber, cont: quantity }]
    });
    fixtures.orders.push(order._id);
    return { item, pallet, order };
  }

  function auth(userId) {
    return `Bearer ${jwt.sign({ id: String(userId), role: 'staff' }, process.env.SECRET_OR_KEY)}`;
  }

  function fulfill(tenant, order, warehouseId = tenant.warehouses[0]._id) {
    return request(app).post('/api/ticket/create')
      .set('Authorization', auth(tenant.user._id))
      .set('X-Company-Id', String(tenant.company._id))
      .set('X-Warehouse-Id', String(warehouseId))
      // Client-supplied ownership fields must never affect the persisted records.
      .send({
        order_id: String(order._id),
        ownerId: new mongoose.Types.ObjectId().toString(),
        companyId: new mongoose.Types.ObjectId().toString()
      });
  }

  async function expectStockUnchanged(pallet, order) {
    const [storedPallet, storedOrder, tickets, products] = await Promise.all([
      Pallet.findById(pallet._id).lean(), Order.findById(order._id).lean(),
      Ticket.countDocuments({ ownerId: { $in: fixtures.users } }),
      Product.countDocuments({ ownerId: { $in: fixtures.users } })
    ]);
    expect(storedPallet.contAvailable).toBe(pallet.contAvailable);
    expect(storedPallet.movementLog).toHaveLength(0);
    expect(storedOrder.status).toBe('create');
    expect(storedOrder.ticketsId).toHaveLength(0);
    expect(tickets).toBe(0);
    expect(products).toBe(0);
  }

  test('successful fulfillment commits stock movement, pick record, ticket, and order state together', async () => {
    const tenant = await createTenant();
    const { item, pallet, order } = await createOrder(tenant);
    const response = await fulfill(tenant, order);

    expect(response.status).toBe(200);
    const [storedPallet, storedOrder, ticket, product] = await Promise.all([
      Pallet.findById(pallet._id).lean(), Order.findById(order._id).lean(),
      Ticket.findOne({ ownerId: tenant.user._id }).lean(), Product.findOne({ ownerId: tenant.user._id }).lean()
    ]);
    expect(storedPallet.contAvailable).toBe(5);
    expect(storedPallet.movementLog).toHaveLength(1);
    expect(storedPallet.movementLog[0]).toMatchObject({ type: 'stock-out', quantity: 5, stockBefore: 10, stockAfter: 5 });
    expect(product).toMatchObject({ sku_number: item.skuNumber, cont: 5, cont_to_be_pick: 5 });
    expect(String(product.ticketId)).toBe(String(ticket._id));
    expect(ticket.products.map(String)).toContain(String(product._id));
    expect(storedOrder).toMatchObject({ status: 'plash' });
    expect(storedOrder.ticketsId.map(String)).toContain(String(ticket._id));
  });

  test('insufficient SKU quantity is recorded without partially deducting that line', async () => {
    const tenant = await createTenant();
    const { pallet, order } = await createOrder(tenant, { quantity: 12, stock: 10 });
    const response = await fulfill(tenant, order);

    expect(response.status).toBe(200);
    const [storedPallet, storedOrder] = await Promise.all([
      Pallet.findById(pallet._id).lean(), Order.findById(order._id).lean()
    ]);
    expect(storedPallet.contAvailable).toBe(10);
    expect(storedPallet.movementLog).toHaveLength(0);
    expect(storedOrder.status).toBe('plash');
    expect(storedOrder.itemsI).toHaveLength(1);
    expect(storedOrder.itemsI[0].cont).toBe(12);
    expect(await Product.countDocuments({ ownerId: tenant.user._id })).toBe(0);
  });

  test('failure after pallet inventory update rolls back all fulfillment writes', async () => {
    const tenant = await createTenant();
    const { pallet, order } = await createOrder(tenant);
    Product.prototype.save = async function injectedProductFailure() { throw new Error('injected pick-record failure'); };

    const response = await fulfill(tenant, order);
    expect(response.status).toBe(500);
    await expectStockUnchanged(pallet, order);
  });

  test('ticket save failure rolls back stock, movement log, pick records, and order state', async () => {
    const tenant = await createTenant();
    const { pallet, order } = await createOrder(tenant);
    Ticket.prototype.save = async function injectedTicketFailure() { throw new Error('injected ticket failure'); };

    const response = await fulfill(tenant, order);
    expect(response.status).toBe(500);
    await expectStockUnchanged(pallet, order);
  });

  test('a repeated fulfillment request does not deduct stock twice', async () => {
    const tenant = await createTenant();
    const { pallet, order } = await createOrder(tenant);
    expect((await fulfill(tenant, order)).status).toBe(200);
    expect((await fulfill(tenant, order)).status).toBe(409);

    const storedPallet = await Pallet.findById(pallet._id).lean();
    expect(storedPallet.contAvailable).toBe(5);
    expect(storedPallet.movementLog).toHaveLength(1);
    expect(await Ticket.countDocuments({ ownerId: tenant.user._id })).toBe(1);
  });

  test('concurrent fulfillment attempts can commit only once', async () => {
    const tenant = await createTenant();
    const { pallet, order } = await createOrder(tenant);
    const responses = await Promise.all([fulfill(tenant, order), fulfill(tenant, order)]);

    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);
    const storedPallet = await Pallet.findById(pallet._id).lean();
    expect(storedPallet.contAvailable).toBe(5);
    expect(storedPallet.movementLog).toHaveLength(1);
    expect(await Ticket.countDocuments({ ownerId: tenant.user._id })).toBe(1);
  });

  test('a different company cannot fulfill the order or change its stock', async () => {
    const tenant = await createTenant({ secondCompany: true });
    const { pallet, order } = await createOrder(tenant);
    const response = await request(app).post('/api/ticket/create')
      .set('Authorization', auth(tenant.foreign.user._id))
      .set('X-Company-Id', String(tenant.foreign.company._id))
      .set('X-Warehouse-Id', String(tenant.foreign.warehouses[0]._id))
      .send({ order_id: String(order._id) });

    expect(response.status).toBe(404);
    const storedPallet = await Pallet.findById(pallet._id).lean();
    expect(storedPallet.contAvailable).toBe(10);
    expect(storedPallet.movementLog).toHaveLength(0);
  });

  test('an unassigned warehouse cannot be selected to fulfill an order', async () => {
    const tenant = await createTenant();
    const { pallet, order } = await createOrder(tenant, { warehouse: tenant.warehouses[1] });
    const response = await fulfill(tenant, order, tenant.warehouses[1]._id);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('WAREHOUSE_ACCESS_DENIED');
    const storedPallet = await Pallet.findById(pallet._id).lean();
    expect(storedPallet.contAvailable).toBe(10);
    expect(storedPallet.movementLog).toHaveLength(0);
  });
});

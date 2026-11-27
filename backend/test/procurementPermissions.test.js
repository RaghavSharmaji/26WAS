const { permissionForRequest, hasPermission } = require('../middleware/permissions');

const request = (baseUrl, method, path) => ({ baseUrl, method, path });

test('purchase order create, update and submit routes map to explicit permissions', () => {
  expect(permissionForRequest(request('/api/purchase-orders', 'POST', '/'))).toBe('purchaseOrders.create');
  expect(permissionForRequest(request('/api/purchase-orders', 'PUT', '/64b000000000000000000001'))).toBe('purchaseOrders.update');
  expect(permissionForRequest(request('/api/purchase-orders', 'POST', '/64b000000000000000000001/submit'))).toBe('purchaseOrders.update');
  expect(hasPermission('procurement_manager', 'purchaseOrders.create')).toBe(true);
});

test('GRN receiving, inspection and putaway routes map to distinct effective grants', () => {
  expect(permissionForRequest(request('/api/grns', 'POST', '/'))).toBe('receiving.execute');
  expect(permissionForRequest(request('/api/grns', 'PATCH', '/64b000000000000000000001/lines/64b000000000000000000002/inspection'))).toBe('receiving.execute');
  expect(permissionForRequest(request('/api/grns', 'POST', '/64b000000000000000000001/lines/64b000000000000000000002/putaway'))).toBe('receiving.putaway');
  expect(hasPermission('warehouse_staff', 'receiving.execute')).toBe(true);
  expect(hasPermission('warehouse_staff', 'receiving.putaway')).toBe(true);
  expect(hasPermission('auditor', 'receiving.execute')).toBe(false);
  expect(hasPermission('auditor', 'receiving.putaway')).toBe(false);
});

test('unmapped procurement mutations fail closed', () => {
  expect(permissionForRequest(request('/api/purchase-orders', 'DELETE', '/64b000000000000000000001'))).toBeNull();
  expect(permissionForRequest(request('/api/grns', 'DELETE', '/64b000000000000000000001'))).toBeNull();
  expect(permissionForRequest(request('/api/grns', 'POST', '/unmapped'))).toBeNull();
});

test('manual stock-in endpoints require inventory adjustment permission', () => {
  const routes = [
    request('/api/inventory', 'POST', '/stock-in'),
    request('/api/pallets', 'POST', '/'),
    request('/api/pallet', 'POST', '/create'),
    request('/api/receiving', 'POST', '/create')
  ];
  for (const route of routes) expect(permissionForRequest(route)).toBe('inventory.adjust');
  expect(hasPermission('warehouse_staff', 'inventory.adjust')).toBe(false);
  expect(hasPermission('procurement_manager', 'inventory.adjust')).toBe(false);
  expect(hasPermission('warehouse_manager', 'inventory.adjust')).toBe(true);
  expect(hasPermission('inventory_manager', 'inventory.adjust')).toBe(true);
});

test('outbound lifecycle routes map to explicit capabilities and arbitrary status writes stay unmapped', () => {
  const orderId = '64b000000000000000000001';
  const cases = [
    ['POST', '/api/customers', '/', 'customers.create'],
    ['PUT', '/api/customers', `/${orderId}`, 'customers.update'],
    ['POST', '/api/order', '/', 'orders.create'],
    ['POST', '/api/order', `/${orderId}/submit`, 'orders.submit'],
    ['POST', '/api/order', `/${orderId}/reserve`, 'inventory.reserve'],
    ['POST', '/api/order', `/${orderId}/picking/assign`, 'picking.assign'],
    ['POST', '/api/order', `/${orderId}/picking/confirm`, 'picking.execute'],
    ['POST', '/api/order', `/${orderId}/packing`, 'packing.execute'],
    ['POST', '/api/order', `/${orderId}/dispatch`, 'shipping.execute'],
    ['POST', '/api/order', `/${orderId}/delivery`, 'shipping.execute'],
    ['POST', '/api/order', `/${orderId}/cancel`, 'orders.cancel'],
    ['GET', '/api/shipments', '/', 'shipping.view']
  ];
  for (const [method, baseUrl, path, expected] of cases) {
    expect(permissionForRequest(request(baseUrl, method, path))).toBe(expected);
  }
  expect(permissionForRequest(request('/api/order', 'PUT', `/${orderId}/status`))).toBeNull();
  expect(permissionForRequest(request('/api/order', 'POST', `/${orderId}/made-up`))).toBeNull();
});

test('outbound grants are role-specific and Auditors remain read-only', () => {
  expect(hasPermission('company_admin', 'customers.create')).toBe(true);
  expect(hasPermission('company_admin', 'orders.submit')).toBe(true);
  expect(hasPermission('company_admin', 'orders.cancel')).toBe(true);
  expect(hasPermission('warehouse_manager', 'picking.assign')).toBe(true);
  expect(hasPermission('warehouse_staff', 'picking.execute')).toBe(true);
  expect(hasPermission('warehouse_staff', 'packing.execute')).toBe(true);
  expect(hasPermission('warehouse_staff', 'shipping.execute')).toBe(true);
  for (const permission of ['customers.create', 'orders.create', 'inventory.reserve', 'picking.execute', 'packing.execute', 'shipping.execute']) {
    expect(hasPermission('auditor', permission)).toBe(false);
  }
});

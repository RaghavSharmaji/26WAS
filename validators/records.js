const validator = require('validator');

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function requiredText(value, label, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    badRequest(`${label} is required and must be at most ${maxLength} characters`);
  }
  return value.trim();
}

function positiveNumber(value, label, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    badRequest(`${label} must be a ${allowZero ? 'non-negative' : 'positive'} number`);
  }
  return number;
}

function item(body, { partial = false } = {}) {
  const data = {};
  if (!partial || body.name !== undefined) data.name = requiredText(body.name, 'name', 120);
  if (!partial || body.skuNumber !== undefined) data.skuNumber = requiredText(body.skuNumber, 'skuNumber', 80);
  if (!partial || body.department !== undefined) data.department = requiredText(body.department, 'department', 100);
  if (!partial || body.size !== undefined) data.size = positiveNumber(body.size, 'size', { allowZero: true });
  ['description'].forEach(key => {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string') badRequest(`${key} must be text`);
      data[key] = body[key].trim();
    }
  });
  ['ounce', 'reorderLevel'].forEach(key => {
    if (body[key] !== undefined) data[key] = positiveNumber(body[key], key, { allowZero: true });
  });
  ['category', 'suppliers'].forEach(key => {
    if (body[key] !== undefined) data[key] = body[key];
  });
  return data;
}

function category(body) {
  if (body.description !== undefined && typeof body.description !== 'string') badRequest('description must be text');
  return {
    name: requiredText(body.name, 'name', 100),
    description: typeof body.description === 'string' ? body.description.trim() : ''
  };
}

function supplier(body) {
  const data = { name: requiredText(body.name, 'name', 120) };
  ['contactName', 'phone', 'address'].forEach(key => {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string') badRequest(`${key} must be text`);
      data[key] = body[key].trim();
    }
  });
  if (body.email !== undefined && body.email !== '') {
    if (typeof body.email !== 'string' || !validator.isEmail(body.email)) badRequest('email must be valid');
    data.email = body.email.trim().toLowerCase();
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') badRequest('active must be a boolean');
    data.active = body.active;
  }
  return data;
}

function warehouse(body) {
  const data = {
    name: requiredText(body.name, 'name', 120),
    code: requiredText(body.code, 'code', 40).toUpperCase()
  };
  if (body.address !== undefined) {
    if (typeof body.address !== 'string') badRequest('address must be text');
    data.address = body.address.trim();
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') badRequest('active must be a boolean');
    data.active = body.active;
  }
  return data;
}

function location(body) {
  const data = {
    zone: requiredText(body.zone, 'zone', 40),
    fullName: requiredText(body.fullName, 'fullName', 100),
    row: positiveNumber(body.row, 'row', { allowZero: true }),
    location: positiveNumber(body.location, 'location', { allowZero: true }),
    level: positiveNumber(body.level, 'level', { allowZero: true })
  };
  ['department'].forEach(key => {
    if (body[key] !== undefined) data[key] = requiredText(body[key], key, 100);
  });
  if (body.warehouse !== undefined) data.warehouse = body.warehouse;
  if (body.maxSize !== undefined) data.maxSize = positiveNumber(body.maxSize, 'maxSize', { allowZero: true });
  if (body.status !== undefined) {
    if (!['empty', 'occupied', 'upcoming', 'maintenance'].includes(body.status)) badRequest('status is invalid');
    data.status = body.status;
  }
  return data;
}

function inventory(body, type) {
  const data = {};
  if (body.palletId !== undefined) data.palletId = requiredText(String(body.palletId), 'palletId', 24);
  if (body.skuNumber !== undefined) data.skuNumber = requiredText(body.skuNumber, 'skuNumber', 80);
  if (body.quantity !== undefined) {
    data.quantity = positiveNumber(body.quantity, 'quantity');
    if (!Number.isInteger(data.quantity)) badRequest('quantity must be a whole number');
  }
  if (body.reason !== undefined) data.reason = requiredText(body.reason, 'reason', 500);
  if (body.location !== undefined) data.location = requiredText(body.location, 'location', 120);
  if (body.size !== undefined) data.size = positiveNumber(body.size, 'size', { allowZero: true });
  if (body.department !== undefined) data.department = requiredText(body.department, 'department', 100);
  if (type === 'adjustment' && body.newQuantity !== undefined) {
    data.newQuantity = positiveNumber(body.newQuantity, 'newQuantity', { allowZero: true });
    if (!Number.isInteger(data.newQuantity)) badRequest('newQuantity must be a whole number');
  }
  if (body.category !== undefined) data.category = body.category;
  if (body.suppliers !== undefined) data.suppliers = body.suppliers;

  if (type === 'stock-in' && !data.palletId && !data.skuNumber) {
    badRequest('palletId or skuNumber is required for stock-in');
  }
  if (type !== 'stock-in' && !data.palletId) badRequest('palletId is required');
  if (type !== 'adjustment' && !data.quantity) badRequest('quantity must be positive');
  if (type === 'adjustment' && data.newQuantity === undefined) badRequest('newQuantity is required');
  if (!data.reason) badRequest('reason is required');
  return data;
}

module.exports = { badRequest, requiredText, positiveNumber, item, category, supplier, warehouse, location, inventory };

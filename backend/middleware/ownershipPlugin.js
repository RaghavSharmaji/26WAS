const { getAuthContext } = require('./requestContext');

function tenantFilter(principal, warehouseField) {
  if (!principal || principal.role === 'superadmin') return {};
  const filter = principal.companyId
    ? { companyId: principal.companyId }
    : { ownerId: principal.legacyOwnerId || principal.id };
  if (principal.companyId && warehouseField) {
    if (principal.warehouseScoped) filter[warehouseField] = { $in: principal.allowedWarehouseIds || [] };
    if (principal.activeWarehouseId && warehouseField !== '_id') {
      filter[warehouseField] = principal.warehouseScoped
        ? { $in: (principal.allowedWarehouseIds || []).filter(id => String(id) === String(principal.activeWarehouseId)) }
        : principal.activeWarehouseId;
    }
  }
  return filter;
}

function assignTenantFields(document, principal, { isNew = true, schema } = {}) {
  if (!principal || principal.role === 'superadmin') return document;
  const hasPath = name => schema && schema.path(name);
  const set = (name, value) => (typeof document.set === 'function' ? document.set(name, value) : (document[name] = value));
  const get = name => (typeof document.get === 'function' ? document.get(name) : document[name]);
  if (isNew) {
    if (hasPath('ownerId')) set('ownerId', principal.id);
    if (hasPath('companyId')) set('companyId', principal.companyId || null);
  } else {
    for (const field of ['ownerId', 'companyId']) {
      if (hasPath(field) && typeof document.isModified === 'function' && document.isModified(field)) {
        throw Object.assign(new Error(`${field} is immutable on an existing tenant record`), { status: 403 });
      }
    }
  }
  const warehouseField = schema && schema.options.tenantWarehouseField;
  if (!isNew && principal.companyId && warehouseField && warehouseField !== '_id'
    && typeof document.isModified === 'function' && document.isModified(warehouseField)) {
    throw Object.assign(new Error('Warehouse assignment is immutable outside an authorized transfer operation'), { status: 403 });
  }
  if (principal.companyId && warehouseField && warehouseField !== '_id') {
    const allowed = new Set((principal.allowedWarehouseIds || []).map(String));
    let warehouseId = get(warehouseField);
    if (!warehouseId && isNew && principal.activeWarehouseId) warehouseId = principal.activeWarehouseId;
    else if (!warehouseId && isNew && principal.warehouseScoped && allowed.size === 1) [warehouseId] = allowed;
    if (!warehouseId || (principal.warehouseScoped && !allowed.has(String(warehouseId)))
      || (principal.activeWarehouseId && String(warehouseId) !== String(principal.activeWarehouseId))) {
      throw Object.assign(new Error('An assigned warehouse is required for this operation'), { status: 403 });
    }
    if (isNew && !get(warehouseField)) set(warehouseField, warehouseId);
  }
  return document;
}

function scopeQuery(next) {
  const principal = getAuthContext();
  if (principal && principal.role !== 'superadmin'
    && ['replaceOne', 'findOneAndReplace'].includes(this.op)) {
    return next(Object.assign(new Error('Replacement writes are not enabled for tenant-scoped records'), { status: 403 }));
  }
  if (principal && principal.role !== 'superadmin' && this.getOptions && this.getOptions().upsert) {
    return next(Object.assign(new Error('Upsert is not enabled for tenant-scoped records'), { status: 403 }));
  }
  if (principal && principal.role !== 'superadmin') {
    const warehouseField = this.model.schema.options.tenantWarehouseField;
    this.where(tenantFilter(principal, warehouseField));
  }
  const update = this.getUpdate && this.getUpdate();
  if (principal && principal.role !== 'superadmin' && Array.isArray(update)) {
    return next(Object.assign(new Error('Update pipelines are not enabled for tenant-scoped records'), { status: 400 }));
  }
  if (principal && principal.role !== 'superadmin' && update) {
    if (!Object.keys(update).some(key => key.startsWith('$'))) {
      this.setUpdate({ $set: update });
    }
    const normalizedUpdate = this.getUpdate();
    normalizedUpdate.$set = normalizedUpdate.$set || {};
    if (principal.companyId) {
      normalizedUpdate.$set = normalizedUpdate.$set || {};
      normalizedUpdate.$set.companyId = principal.companyId;
      if (normalizedUpdate.$unset) delete normalizedUpdate.$unset.companyId;
      if (normalizedUpdate.$setOnInsert) {
        delete normalizedUpdate.$setOnInsert.companyId;
        delete normalizedUpdate.$setOnInsert.ownerId;
      }
      if (normalizedUpdate.$set) delete normalizedUpdate.$set.ownerId;
      if (normalizedUpdate.$unset) delete normalizedUpdate.$unset.ownerId;
      if (normalizedUpdate.$rename) {
        Object.keys(normalizedUpdate.$rename).forEach((key) => {
          if (key === 'companyId' || normalizedUpdate.$rename[key] === 'companyId') delete normalizedUpdate.$rename[key];
        });
      }
    } else {
      normalizedUpdate.$set = normalizedUpdate.$set || {};
      normalizedUpdate.$set.ownerId = principal.legacyOwnerId || principal.id;
      if (normalizedUpdate.$unset) delete normalizedUpdate.$unset.ownerId;
      if (normalizedUpdate.$set) delete normalizedUpdate.$set.companyId;
      if (normalizedUpdate.$setOnInsert) delete normalizedUpdate.$setOnInsert.companyId;
    }
    const warehouseField = this.model.schema.options.tenantWarehouseField;
    if (principal.companyId && warehouseField) {
      const assigned = new Set((principal.allowedWarehouseIds || []).map(String));
      const requested = normalizedUpdate.$set[warehouseField]
        || (normalizedUpdate.$setOnInsert && normalizedUpdate.$setOnInsert[warehouseField]);
      if (requested !== undefined && requested !== null
        && ((principal.warehouseScoped && !assigned.has(String(requested)))
          || (principal.activeWarehouseId && String(requested) !== String(principal.activeWarehouseId)))) {
        return next(Object.assign(new Error('Cannot move a record outside your assigned warehouses'), { status: 403 }));
      }
      if (normalizedUpdate.$unset && normalizedUpdate.$unset[warehouseField]) {
        return next(Object.assign(new Error('Warehouse assignment cannot be removed'), { status: 403 }));
      }
      if (normalizedUpdate.$rename && Object.keys(normalizedUpdate.$rename).some(key => key === warehouseField || normalizedUpdate.$rename[key] === warehouseField)) {
        return next(Object.assign(new Error('Warehouse assignment cannot be renamed'), { status: 403 }));
      }
    }
    this.setUpdate(normalizedUpdate);
  }
  next();
}

function ownershipPlugin(schema) {
  const queryHooks = [
    'count', 'countDocuments', 'deleteMany', 'deleteOne', 'distinct', 'find', 'findOne',
    'findOneAndDelete', 'findOneAndRemove', 'findOneAndReplace', 'findOneAndUpdate', 'remove',
    'replaceOne', 'update', 'updateMany', 'updateOne'
  ];
  queryHooks.forEach((hook) => schema.pre(hook, scopeQuery));

  schema.pre('save', function assignOwner(next) {
    try {
      assignTenantFields(this, getAuthContext(), { isNew: this.isNew, schema: this.schema });
      return next();
    } catch (error) {
      return next(error);
    }
  });

  schema.pre('insertMany', function assignInsertManyOwners(next, documents) {
    const principal = getAuthContext();
    if (principal && principal.role !== 'superadmin') {
      try {
        documents.forEach(document => assignTenantFields(document, principal, { isNew: true, schema: this.schema }));
      } catch (error) {
        return next(error);
      }
    }
    next();
  });

  schema.pre('aggregate', function scopeAggregate(next) {
    const principal = getAuthContext();
    if (principal && principal.role !== 'superadmin') {
      const firstStage = this.pipeline()[0];
      const insertAt = firstStage && (firstStage.$geoNear || firstStage.$search || firstStage.$vectorSearch) ? 1 : 0;
      const warehouseField = this._model.schema.options.tenantWarehouseField;
      const match = tenantFilter(principal, warehouseField);
      this.pipeline().splice(insertAt, 0, { $match: match });
    }
    next();
  });
}

module.exports = ownershipPlugin;
module.exports.tenantFilter = tenantFilter;
module.exports.assignTenantFields = assignTenantFields;

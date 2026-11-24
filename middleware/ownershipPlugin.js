const { getAuthContext } = require('./requestContext');

function scopeQuery(next) {
  const principal = getAuthContext();
  if (principal && principal.role !== 'superadmin') this.where({ ownerId: principal.id });
  const update = this.getUpdate && this.getUpdate();
  if (principal && principal.role !== 'superadmin' && update && !Array.isArray(update)) {
    if (update.$set) update.$set.ownerId = principal.id;
    else update.ownerId = principal.id;
    if (update.$unset) delete update.$unset.ownerId;
    this.setUpdate(update);
  }
  next();
}

function ownershipPlugin(schema) {
  const queryHooks = [
    'count', 'countDocuments', 'deleteMany', 'deleteOne', 'find', 'findOne',
    'findOneAndDelete', 'findOneAndRemove', 'findOneAndUpdate', 'remove',
    'update', 'updateMany', 'updateOne'
  ];
  queryHooks.forEach((hook) => schema.pre(hook, scopeQuery));

  schema.pre('save', function assignOwner(next) {
    const principal = getAuthContext();
    if (principal && principal.role !== 'superadmin' && this.isNew) this.ownerId = principal.id;
    next();
  });

  schema.pre('insertMany', function assignInsertManyOwners(next, documents) {
    const principal = getAuthContext();
    if (principal && principal.role !== 'superadmin') {
      documents.forEach((document) => { document.ownerId = principal.id; });
    }
    next();
  });

  schema.pre('aggregate', function scopeAggregate(next) {
    const principal = getAuthContext();
    if (principal && principal.role !== 'superadmin') {
      const firstStage = this.pipeline()[0];
      const insertAt = firstStage && firstStage.$geoNear ? 1 : 0;
      this.pipeline().splice(insertAt, 0, { $match: { ownerId: principal.id } });
    }
    next();
  });
}

module.exports = ownershipPlugin;

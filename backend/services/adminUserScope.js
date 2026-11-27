function idString(value) {
  return value == null ? null : String(value._id || value);
}

function buildUserScopes(userIds, memberships, activeCompanies) {
  const allowedCompanies = new Map(activeCompanies
    .filter(company => company.status === 'active')
    .map(company => [idString(company._id), company]));
  const byUser = new Map(userIds.map(userId => [idString(userId), {
    userId: idString(userId), legacyOwnerId: userId, companyIds: [], companies: []
  }]));

  for (const membership of memberships) {
    if (membership.status !== 'active') continue;
    const userKey = idString(membership.userId);
    const companyKey = idString(membership.companyId);
    const scope = byUser.get(userKey);
    const company = allowedCompanies.get(companyKey);
    if (!scope || !company || scope.companyIds.some(id => idString(id) === companyKey)) continue;
    scope.companyIds.push(company._id);
    scope.companies.push({
      id: company._id,
      name: company.name,
      slug: company.slug,
      status: company.status
    });
  }
  return byUser;
}

function scopeFilter(scope, extra = {}) {
  const clauses = [];
  if (scope.companyIds.length) clauses.push({ companyId: { $in: scope.companyIds } });
  // Only unmigrated rows explicitly owned by this user are retained.
  clauses.push({ companyId: null, ownerId: scope.legacyOwnerId });
  return { $or: clauses, ...extra };
}

function multiUserScopeFilter(userIds, companyIds) {
  const clauses = [];
  if (companyIds.length) clauses.push({ companyId: { $in: companyIds } });
  if (userIds.length) clauses.push({ companyId: null, ownerId: { $in: userIds } });
  return { $or: clauses.length ? clauses : [{ _id: { $exists: false } }] };
}

function bucketKey(companyId, ownerId) {
  return companyId ? `company:${idString(companyId)}` : `legacy:${idString(ownerId)}`;
}

function mergeGroupedRows(rows, fields) {
  const result = new Map();
  for (const row of rows) {
    const companyId = row._id && row._id.companyId;
    const ownerId = row._id && row._id.ownerId;
    const key = bucketKey(companyId, ownerId);
    const current = result.get(key) || Object.fromEntries(fields.map(field => [field, 0]));
    for (const field of fields) current[field] += Number(row[field] || 0);
    result.set(key, current);
  }
  return result;
}

function statsForScope(scope, companyStats, legacyStats) {
  const result = {
    products: 0, inventoryUnits: 0, inventoryOnHandUnits: 0,
    inventoryQuarantinedUnits: 0, orders: 0, warehouses: 0,
    suppliers: 0, categories: 0, locations: 0
  };
  const fields = Object.keys(result);
  const included = new Set(scope.companyIds.map(id => bucketKey(id)));
  included.add(bucketKey(null, scope.legacyOwnerId));
  for (const key of included) {
    const values = key.startsWith('company:') ? companyStats.get(key) : legacyStats.get(key);
    if (values) for (const field of fields) result[field] += Number(values[field] || 0);
  }
  result.companyCount = scope.companyIds.length;
  return result;
}

module.exports = { buildUserScopes, scopeFilter, multiUserScopeFilter, bucketKey, mergeGroupedRows, statsForScope };

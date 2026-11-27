const {
  buildUserScopes, scopeFilter, multiUserScopeFilter, bucketKey,
  mergeGroupedRows, statsForScope
} = require('../services/adminUserScope');

const userA = '64b000000000000000000001';
const userB = '64b000000000000000000002';
const companyA = '64b000000000000000000010';
const companyB = '64b000000000000000000011';
const companyPending = '64b000000000000000000012';
const companyInactiveMembership = '64b000000000000000000013';
const companyRevoked = '64b000000000000000000014';

function scopeFixture(memberships, companies) {
  return buildUserScopes([userA, userB], memberships, companies);
}

test('active user company scope includes company-owned records from other creators', () => {
  const scopes = scopeFixture([
    { userId: userA, companyId: companyA, status: 'active' }
  ], [{ _id: companyA, name: 'A', slug: 'a', status: 'active' }]);
  expect(scopeFilter(scopes.get(userA))).toEqual({ $or: [
    { companyId: { $in: [companyA] } },
    { companyId: null, ownerId: userA }
  ] });
  // Creator identity is not used for company-owned rows.
  expect(scopeFilter(scopes.get(userA)).$or[0]).not.toHaveProperty('ownerId');
});

test('multiple companies are deduplicated and inaccessible company IDs stay outside the scope', () => {
  const scopes = scopeFixture([
    { userId: userA, companyId: companyA, status: 'active' },
    { userId: userA, companyId: companyA, status: 'active' },
    { userId: userA, companyId: companyB, status: 'active' },
    { userId: userA, companyId: companyPending, status: 'active' },
    { userId: userA, companyId: companyInactiveMembership, status: 'inactive' },
    { userId: userA, companyId: companyRevoked, status: 'revoked' }
  ], [
    { _id: companyA, name: 'A', slug: 'a', status: 'active' },
    { _id: companyB, name: 'B', slug: 'b', status: 'active' },
    { _id: companyPending, name: 'Pending', slug: 'pending', status: 'pending' },
    { _id: companyInactiveMembership, name: 'Inactive', slug: 'inactive', status: 'active' },
    { _id: companyRevoked, name: 'Revoked', slug: 'revoked', status: 'active' }
  ]);
  expect(scopes.get(userA).companyIds).toEqual([companyA, companyB]);
  expect(scopes.get(userA).companies.map(company => company.id)).toEqual([companyA, companyB]);
  expect(multiUserScopeFilter([userA], scopes.get(userA).companyIds)).toEqual({ $or: [
    { companyId: { $in: [companyA, companyB] } },
    { companyId: null, ownerId: { $in: [userA] } }
  ] });
});

test('inactive, revoked and pending memberships do not expose company records', () => {
  const scopes = scopeFixture([
    { userId: userA, companyId: companyPending, status: 'active' },
    { userId: userA, companyId: companyInactiveMembership, status: 'inactive' },
    { userId: userA, companyId: companyRevoked, status: 'revoked' }
  ], [
    { _id: companyPending, status: 'pending' },
    { _id: companyInactiveMembership, status: 'active' },
    { _id: companyRevoked, status: 'active' }
  ]);
  expect(scopes.get(userA).companyIds).toEqual([]);
  expect(scopeFilter(scopes.get(userA))).toEqual({ $or: [{ companyId: null, ownerId: userA }] });
});

test('legacy owner records are retained while unassociated records remain excluded', () => {
  const scopes = scopeFixture([], []);
  const filter = scopeFilter(scopes.get(userA));
  expect(filter).toEqual({ $or: [{ companyId: null, ownerId: userA }] });
  expect(filter.$or).not.toContainEqual({ ownerId: userB });
  expect(filter.$or).not.toContainEqual({ companyId: { $exists: true } });
});

test('summary merges company records once per membership and adds only the selected users legacy bucket', () => {
  const scope = buildUserScopes([userA], [
    { userId: userA, companyId: companyA, status: 'active' },
    { userId: userA, companyId: companyA, status: 'active' },
    { userId: userA, companyId: companyB, status: 'active' }
  ], [{ _id: companyA, status: 'active' }, { _id: companyB, status: 'active' }]).get(userA);
  const companyStats = new Map([
    [bucketKey(companyA), { products: 6, orders: 2 }],
    [bucketKey(companyB), { products: 3, orders: 1 }]
  ]);
  const legacyStats = new Map([[bucketKey(null, userA), { products: 1, orders: 4 }]]);
  expect(statsForScope(scope, companyStats, legacyStats)).toMatchObject({
    products: 10, orders: 7, companyCount: 2
  });
});

test('grouped records from several creators merge into one company total', () => {
  const companyRows = mergeGroupedRows([
    { _id: { companyId: companyA, ownerId: userA }, products: 4 },
    { _id: { companyId: companyA, ownerId: userB }, products: 3 },
    { _id: { companyId: companyB, ownerId: userB }, products: 20 },
    { _id: { companyId: null, ownerId: userA }, products: 2 }
  ], ['products']);
  expect(companyRows.get(bucketKey(companyA))).toEqual({ products: 7 });
  expect(companyRows.get(bucketKey(companyB))).toEqual({ products: 20 });
  expect(companyRows.get(bucketKey(null, userA))).toEqual({ products: 2 });
});

# Independent Phase 2.1 Security Verification

**Review type:** read-only source review and test run  
**Scope:** current backend source, route registration, migration tooling, and existing backend tests. No source code, `.env`, database record, or migration was changed or executed. No Atlas connection was made.

## Verdict

# NOT APPROVED – FIXES REQUIRED

The operational route boundary is substantially improved: operational routers are mounted after authentication, tenant resolution, company-status validation, and operation permission checks. The backend suite passes. However, the company migration preflight does not compare planned memberships against existing membership grants, and its report is not transactionally tied to the later apply. The migration also performs an unbounded amount of work in one transaction. These gaps can make a migration report “ready” while preserving unexpected access grants or applying stale warehouse assignments. The mock-based test suite does not establish safety under these conditions.

This is not production security approval. Staging migration should wait for the migration findings below to be resolved and reviewed against a restored, representative database.

## Scope inspected

- `backend/server.js`
- `backend/middleware/auth.js`, `tenantContext.js`, `permissions.js`, `ownershipPlugin.js`, `companyAuthorization.js`, and `requestContext.js`
- `backend/services/tenantService.js` and `inventoryService.js`
- All route modules under `backend/routes/`, including legacy singular routes, newer plural routes, company routes, and Super Admin routes
- Tenant-owned models, including User, Company, CompanyMembership, Item, Product, Category, Supplier, Warehouse, Location, Pallet, Order, Ticket, and AuditLog
- `backend/scripts/migrateCompanies.js` and retired `migrateOwnership.js`
- Backend tests and package test command

## Route registration and authorization boundary

`server.js` registers `/api/auth` and `/api/companies` first, `/api/admin` behind `auth` plus `requireRole('superadmin')`, then a shared operational middleware for all listed operational route prefixes. The shared middleware sequence is `auth`, `tenantContext({ blockPending: true })`, then `authorizeOperationalRequest()`. Operational handlers are mounted afterward. The legacy singular routers also add `auth` again; they do not bypass the earlier application-level guard. `/api/user` is a public registration alias and is not an operational data API.

The operational route prefix list includes categories, suppliers, warehouses, locations, products/items, inventory, pallets, reports, legacy location/item/pallet/receiving/order/ticket/picker, and web item lookup. `permissionForRequest()` maps those mounted base paths and methods. Non-GET mutations without a configured permission are denied with `PERMISSION_NOT_CONFIGURED`; unsupported methods are likewise denied before the router. Unknown paths may pass the read permission fallback only for GET/HEAD, but then reach the ordinary 404 handler without a matching data route.

**Result:** no route-registration bypass was identified in the current route set. This conclusion is based on source inspection and route tests; future operational routers must be added to both the shared prefix list and permission map.

## Findings

### V-01 — High: Migration can silently retain an unreviewed existing membership grant

**File and function:** `backend/scripts/migrateCompanies.js`, `makeReport()` and `applyMapping()`.

**Evidence:** `makeReport()` validates mapped users and warehouse references but never queries `CompanyMembership` for existing rows. `applyMapping()` uses `CompanyMembership.updateOne(..., { $setOnInsert: ... })` around lines 248–250. If a membership already exists for the same user/company with a different role, status, or warehouse assignment, `$setOnInsert` leaves it unchanged, while the preflight can still report `readyToApply: true`.

**Potential impact:** a reviewed mapping that intends to reduce access to `staff` can leave an existing `company_admin` grant in place. Conversely, an inactive membership may remain inactive despite the report suggesting the mapped user is ready. Migration output is then inconsistent with the authorization state operators approved.

**Recommended fix:** include existing membership role/status/warehouse grants in preflight. Block on any mismatch unless the mapping explicitly declares and approves a reconciliation action. Verify the post-apply membership state inside the transaction.

### V-02 — High: Preflight and apply are separate snapshots; warehouse backfill can use stale evidence

**File and function:** `backend/scripts/migrateCompanies.js`, `main()`, `makeReport()`, and `applyMapping()`.

**Evidence:** `main()` runs `makeReport()` before starting the transaction in `applyMapping()`. Preflight reads are not in a transaction or snapshot shared with apply. Planned warehouse updates in `applyMapping()` use only `{ _id }` as the `updateOne` filter around lines 265–268. The broad company backfill uses `{ ownerId, companyId: { $in: [null] } }` around lines 257–261.

**Potential impact:** records or warehouse relationships can change between preflight and apply. A stale `warehouseAssignmentsPlanned` entry can overwrite a changed record’s warehouse assignment because the apply filter does not re-check owner, company, or prior warehouse state. Concurrent legacy writes can also change the population between validation and backfill.

**Recommended fix:** require a documented write freeze/maintenance window or implement a consistent snapshot and revalidation. In the transaction, condition each write on the reviewed owner/company/current warehouse state, compare matched counts with the reviewed plan, and abort on drift. Persist and reconcile preflight/apply counts.

### V-03 — High: Migration scales by materializing and processing an unbounded dataset

**File and function:** `backend/scripts/migrateCompanies.js`, `makeReport()` and `applyMapping()`.

**Evidence:** `makeReport()` materializes owner-specific warehouse-bound rows with `.toArray()` around lines 130–132 and performs per-record warehouse lookups. `applyMapping()` runs all company, membership, collection, owner, and planned warehouse updates in one `withTransaction()` callback around lines 235–270, with no batch sizing, checkpoint, or progress reconciliation.

**Potential impact:** large collections can consume substantial memory and exceed transaction duration/size limits. The transaction should abort rather than intentionally leave partial writes on a transaction-capable MongoDB deployment, but repeated aborts can make the migration unusable; the implementation has no bounded restart/checkpoint process or persisted failure reconciliation. The suite does not test real transaction limits or realistic data volume.

**Recommended fix:** design a bounded migration plan with explicit batch sizes, checkpoints, idempotent resume, reconciliation per batch, and a tested rollback/restore procedure. Validate it on a restored production-shaped staging database before approval. Do not treat the current single-transaction migration as staging-ready for a large dataset.

### V-04 — Medium: Migration accepts existing users without validating account or platform status

**File and function:** `backend/scripts/migrateCompanies.js`, `makeReport()` user check around line 189.

**Evidence:** the preflight checks only `User.exists({ _id: member.userObjectId })`. It does not check that the user is active or not a Super Admin before creating a company membership.

**Potential impact:** mappings can create membership rows for inactive/deleted users or platform administrators. Current authentication blocks inactive/deleted users and operational tenant middleware rejects Super Admin, so this is not a demonstrated immediate cross-company access bypass; it can create invalid grants and become relevant if account status changes later.

**Recommended fix:** validate the mapped user’s account status and role. Reject Super Admin mappings and block inactive/deleted accounts unless a separately reviewed migration policy handles them.

### V-05 — Medium: Legacy receiving and location updates can leave warehouse occupancy inconsistent

**Files and routes:** `backend/routes/receiving.routes.js`, `POST /send` and `POST /dynamicsend`; `backend/routes/pallet.routes.js`, `POST /update`; `backend/routes/location.routes.js`, `POST /update`.

**Evidence:** receiving and legacy pallet putaway update pallet and location documents through separate saves, not a transaction. Legacy location update accepts occupancy-related fields such as SKU, size, and status and saves the location independently. The current tenant and warehouse filters limit which documents can be accessed, and pallet relocation checks the warehouse relationship, but these multi-record operations are not atomic.

**Potential impact:** a failure between writes can leave a pallet and location with conflicting occupancy or capacity values. This is a data-integrity risk rather than a demonstrated cross-tenant read bypass.

**Recommended fix:** use a transaction or a recoverable workflow for pallet/location changes, and prevent direct location occupancy edits from bypassing pallet movement operations.

### V-06 — Low: Permission and tenant filters rely on consistent Mongoose model plugins

**Files and functions:** `backend/middleware/ownershipPlugin.js`, `tenantFilter()`, `scopeQuery()`, and `scopeAggregate()`; all operational models and routes.

**Evidence:** the plugin scopes a defined list of query methods and aggregates and rejects replacement writes, update pipelines, and tenant upserts. It does not scope every Mongoose/native write API (for example, direct collection calls or bulk APIs). No direct native collection/bulk write was found in the operational routes inspected; native collection writes are present in the migration script and are part of the separate migration findings above.

**Potential impact:** a future route using an unhooked API could bypass tenant scope if it relies on this plugin without an explicit scoped query.

**Recommended fix:** preserve an allow-listed data-access pattern for operational services and add a route review/test whenever a new query API or direct collection operation is introduced.

## Verification by requirement

1. **Authentication, tenant context, company status, and permissions:** present at the shared operational boundary and registered before operational routers. Company Admin, manager/staff, inventory/procurement, and auditor roles have distinct permission sets. Unmapped writes fail closed.
2. **Caller-supplied companyId/ownerId:** request authorization strips top-level `companyId` and `ownerId`; the ownership plugin assigns them from authenticated context on create and blocks changes through document saves. Legacy tenant filters require both the authenticated `ownerId` and `companyId: null`.
3. **Super Admin operational bypass:** blocked in `tenantContext()` before route handlers. `/api/admin` is a separate Super Admin-only mount.
4. **Company status:** tenant context requires `company.status === 'active'`; pending, suspended, deactivated, missing, and unknown statuses are denied.
5. **Warehouse assignments:** warehouse-scoped queries use assigned warehouse IDs; explicit warehouse IDs in route params/query/body are checked against company/assignment. Receiving and pallet relocation helpers validate warehouse/location relationships. No transfer API exists, so transfer source/destination behavior cannot be verified as an implemented workflow.
6. **Tenant data paths:** current operational Mongoose query and aggregation paths receive the ownership plugin scope. Route handlers inspected use these models; no caller-supplied pipeline or native collection query was found in ordinary operational routes. Platform admin routes intentionally perform global queries behind Super Admin authentication.
7. **Permission fail-closed behavior:** unsupported write methods and unmapped mutation paths are denied. GET/HEAD defaults to read permission; unmatched GET paths proceed to 404. This is safe for the current GET-only read routes but should be re-audited when routes change.
8. **Wrong-company migration mapping:** company ID/slug collisions, missing owners, conflicting company IDs, malformed tenant IDs, missing warehouse assignments, duplicate tenant keys, and cross-company warehouse mappings are reported. Existing membership grants are not reconciled (V-01), and apply is not bound to the preflight snapshot (V-02).
9. **Partial failures and scale:** the apply writes are grouped in one MongoDB transaction, providing atomic abort behavior when supported; no partial-failure integration test was run. The unbounded transaction and preflight reads are not safe to approve for an unknown/large data volume (V-03).
10. **Authentication and legacy ownerId:** auth verifies the token then reloads the user from MongoDB and blocks inactive/deleted accounts. Legacy fallback is allowed only when there are no membership rows at all; inactive membership rows block fallback. Legacy record queries are limited to the authenticated owner and unassigned company records.

## Tests

Executed from `backend/`:

```text
npm test -- --runInBand
Test Suites: 5 passed, 5 total
Tests:       66 passed, 66 total
```

The tests passed. They use mocks for database access and migration behavior; they do not establish MongoDB transaction behavior, live query scoping across all schema/model combinations, migration races, or large-dataset safety. No Atlas or other database connection was made, and no migration was executed.

## Required work before staging migration

1. Add migration preflight for existing memberships and reject privilege/status/warehouse mismatches.
2. Tie preflight to apply with a write freeze or transactional revalidation and strict conditional updates.
3. Replace unbounded migration processing with a bounded, resumable approach or provide measured evidence that the single transaction fits the actual restored dataset and deployment limits.
4. Add migration tests for existing membership conflicts, preflight/apply drift, conditional update match counts, transaction abort/rollback, and representative large data.
5. Test the migration only on a restored staging copy, then reconcile tenant counts, memberships, warehouse assignments, and inventory totals before approving any real apply.

**Final decision: NOT APPROVED – FIXES REQUIRED**

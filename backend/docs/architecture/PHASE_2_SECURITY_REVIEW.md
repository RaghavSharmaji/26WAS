# Phase 2 Independent Security Review

**Review type:** source-level security review, review only  
**Date:** 2026-11-25  
**Scope:** current working-tree implementation and architecture documents. No application source, environment file, database record, or migration was changed or executed for this review.

## Executive assessment

**Phase 2 is not safe to proceed to Phase 3 yet.** The backend tests pass, and the implementation has useful controls: active memberships are looked up from MongoDB, ordinary company queries are scoped through the ownership plugin, company context is not trusted from the request body, and warehouse selections are checked against the membership. However, this review found multiple exploitable or material gaps that the current tests do not cover.

The most urgent findings are:

1. Legacy create endpoints accept caller-supplied `companyId` and the ownership plugin does not remove it for a user in legacy `ownerId` mode. A legacy user can create records visible in another company.
2. Super Admin receives an unscoped context on ordinary operational routes. This bypass is broader than the separate platform route design and allows un-audited platform-wide operational writes.
3. Operational mutations lack company-role checks in several legacy and newer routes. Staff and the nominally read-only Auditor can adjust stock, create/update pallets and run workflow operations.
4. Pending companies are not blocked: the server calls `tenantContext()` without enabling its pending-company restriction.
5. The migration preflight skips warehouse checks for records that already have a `companyId`, and the older `ownership:migrate` command remains available despite making unsafe owner assignments and dropping indexes.

This is a code review, not a penetration test. Passing tests below demonstrate only the tested behavior; they do not negate these findings.

## Files and routes inspected

### Tenancy and authorization

- `model/Company.js`
- `model/CompanyMembership.js`
- `middleware/tenantContext.js`
- `middleware/companyAuthorization.js`
- `middleware/ownershipPlugin.js`
- `middleware/requestContext.js`
- `middleware/auth.js`
- `services/tenantService.js`
- `routes/company.routes.js`
- `server.js`

### Models

- `model/Item.js`, `model/Product.js`, `model/Category.js`, `model/Supplier.js`
- `model/Warehouse.js`, `model/Location.js`, `model/Pallets.js`
- `model/Order.js`, `model/Ticket.js`, `model/AuditLog.js`
- `model/User.js`

### API routes and services

- Newer APIs: `routes/products.routes.js`, `category.routes.js`, `supplier.routes.js`, `warehouse.routes.js`, `locationCrud.routes.js`, `palletCrud.routes.js`, `inventory.routes.js`, `report.routes.js`
- Legacy APIs: `routes/item.routes.js`, `location.routes.js`, `pallet.routes.js`, `receiving.routes.js`, `order.routes.js`, `ticket.routes.js`, `picker.routes.js`
- Administrative and public routes: `routes/admin.routes.js`, `auth.routes.js`, `user.routes.js`, `webscraping.routes.js`
- `routes/crudFactory.js`, `services/inventoryService.js`, `validators/records.js`

### Migration and tests

- `scripts/migrateCompanies.js`
- `scripts/migrateOwnership.js` (legacy migration command also present in `package.json`)
- `test/tenantIsolation.test.js`, `test/companyMigration.test.js`, `test/api.test.js`, and the full backend test suite

### Frontend and architecture documents

- `frontend/src/App.jsx`, `frontend/src/api.js`, `frontend/src/App.css`
- All documents in `docs/architecture/`: current audit, target architecture, role permission matrix, database design, WMS workflow, API design, implementation roadmap, migration strategy, and security checklist.

## Tenant-isolation findings

### High — Legacy create endpoints permit cross-company record injection

**Files / locations:** `middleware/ownershipPlugin.js`, `assignTenantFields()` (lines 19–27); `routes/item.routes.js`, `POST /api/item/create` (lines 62–64); `routes/location.routes.js`, `POST /api/location/create` (lines 89–91); `routes/pallet.routes.js`, `POST /api/pallet/create` (lines 123–127); `routes/receiving.routes.js`, `POST /api/receiving/create` (lines 44–48).

These legacy handlers construct Mongoose documents by spreading `req.body`. In company context the plugin replaces `companyId` with the authenticated company. In legacy mode, however, `assignTenantFields()` assigns `ownerId` but does not clear a supplied `companyId`. The legacy caller therefore can set a known other company's ID directly on a new record. Company-scoped reads filter by that `companyId`, so the injected record can appear in the target company's views and can affect its unique keys and reports. The Item create route also accepts unvalidated `category` and `suppliers` references.

**Required correction:** reject tenant/ownership fields at every route boundary and make the plugin remove `companyId` for legacy writes (or fail closed if an ordinary write has a client-provided tenant field). Add route-level tests that submit a foreign `companyId` through every raw-body legacy create route and prove no foreign-scoped record is created. Validate every supplied reference against the same tenant and warehouse.

### High — Super Admin bypass applies to ordinary operational endpoints

**Files / locations:** `middleware/tenantContext.js`, the Super Admin branch (lines 14–18); `middleware/ownershipPlugin.js`, `tenantFilter()` (lines 3–4) and query/aggregate scope (lines 43–53 and 140–149); `middleware/companyAuthorization.js` (lines 3, 17); `server.js` (lines 55–64).

`server.js` separates `/api/admin` behind `requireRole('superadmin')`, but also mounts Super Admin on every operational route. `tenantContext` marks the request as platform admin and enters async context with role `superadmin`; the ownership plugin then returns no tenant filter, and company-role middleware permits the request. A Super Admin token can therefore read, update, delete, and run stock/workflow operations across tenants through ordinary `/api/products`, `/api/pallets`, `/api/inventory`, legacy singular, and report routes. These mutations do not require a company selection or support reason and are not consistently audited. This conflicts with the architecture documents’ separate, audited, read-only-by-default platform support boundary.

**Required correction:** reject Super Admin from ordinary tenant routes unless a separate, explicitly scoped, audited support context is supplied. Keep cross-company data access in dedicated platform endpoints and require an explicit company scope for support operations. Add negative tests for platform tokens against all tenant operational route families and tests proving any approved support view is read-only by default.

### High — Backend role enforcement is incomplete for operational writes

**Files / locations:** `routes/inventory.routes.js`, `POST /stock-in`, `/stock-out`, `/adjust` (lines 34, 50, 56); `routes/palletCrud.routes.js`, `POST /` and `PUT /:id` (lines 30, 44); `routes/receiving.routes.js`, pallet create/putaway/workflow routes (lines 44, 94, 166, 222, 244); `routes/pallet.routes.js`, `/create` and `/update` (lines 123, 178); `routes/order.routes.js`, `/create`, `/submit`, and `PUT /:id/status` (lines 32, 50, 76); `routes/ticket.routes.js`, `POST /create` (line 28); `routes/picker.routes.js`, `/start_picker`, `/pick`, `/done` (lines 6, 45, 96).

These mutation routes have no company-role middleware. `tenantContext` assigns `staff` and `auditor` memberships a warehouse scope but does not make the Auditor read-only or otherwise restrict these actions. Consequently, any active member who can reach these endpoints can adjust stock, create pallets, alter pallet status/location, create or change orders, and execute receiving/picking operations, subject only to data scoping. The target role matrix explicitly describes Auditors as read-only and Staff as task-limited.

**Required correction:** define and apply backend permissions per operation, including explicit restrictions for Auditor, Staff, Warehouse Manager, and Company Admin. Test each role against every mutating route in both plural and legacy route families. Do not depend on frontend visibility.

### High — Pending companies are operationally usable

**Files / locations:** `middleware/tenantContext.js`, pending status check (line 46); `server.js`, `tenantContext()` invocation (line 60).

The middleware blocks a pending company only when constructed with `{ blockPending: true }`, but `server.js` invokes `tenantContext()` with no options. Any authenticated user can create a company in `routes/company.routes.js` (`POST /api/companies` sets status `pending`) and then use that company’s operational APIs before approval. The company status is therefore not enforcing an approval boundary.

**Required correction:** decide whether company self-service activation is allowed. If approval is required, block operational routes until `active` and separately permit only necessary onboarding actions while `pending`. Add a test for pending-company access to every operational route group.

### Medium — Membership grants have no audit trail or revocation endpoint

**File / locations:** `routes/company.routes.js`, `POST /:companyId/members` (lines 95–133), `GET /:companyId/members` (lines 139–150); `model/CompanyMembership.js`.

Company Admin can grant an existing account an active role and warehouse access. The grant is not written to an audit log, and the current Company API has no endpoint to deactivate/revoke or change an existing membership. That makes security changes difficult to review and leaves no implemented company-level offboarding path. The database enum includes `inactive` and `invited`, but there is no invitation/acceptance lifecycle.

**Required correction:** audit membership create/change/revoke with actor, company, target, old/new role and warehouse grants; implement a guarded revocation/change path and test immediate access revocation. Add an invitation/acceptance flow before treating `invited` as supported.

### Medium — Warehouse relationship checks are inconsistent for pallet relocation

**Files / locations:** `routes/palletCrud.routes.js`, `PUT /:id` (lines 44–71); `routes/pallet.routes.js`, `POST /update` (line 178 onward); `routes/location.routes.js`, `POST /update` (line 153 onward).

The newer pallet update checks that a destination location is visible to the current company/warehouse filter, but it does not compare the destination location’s `warehouse` to the pallet’s `warehouseId`. The legacy pallet update similarly looks up locations by `fullName` under the current tenant context without binding the destination to the pallet warehouse. When a manager has multiple assigned warehouses and no active warehouse header, the model filter allows all assigned warehouses, so a pallet can be pointed at another assigned warehouse’s location while keeping its original `warehouseId`. The old location capacity and pallet-reference updates are also multi-document, non-transactional. A mismatch can corrupt location occupancy and warehouse reports. Company Admin intentionally has company-wide visibility, but still needs explicit transfer semantics and consistent source/destination accounting.

**Required correction:** for simple putaway/location changes, require the same warehouse ID for pallet and destination; implement cross-warehouse movement only as an authorized, atomic transfer that validates both warehouses, updates both locations and pallet scope, and records inventory movement. Add multi-warehouse manager tests with and without `X-Warehouse-Id`.

### Medium — Customer references are not verifiable against tenant ownership

**Files / locations:** `model/Order.js`, `customerId`; `model/Ticket.js`, `customerId`; `routes/ticket.routes.js`, `POST /create` accepts `customerId` (lines 29–30, 119–123).

The referenced `customers` collection has no inspected Customer model or tenant-scoped validation service. Ticket creation stores the client-supplied customer ID without confirming that it belongs to the active company. The architecture audit also notes that no Customer model was found.

**Required correction:** establish the actual customer data source/model and validate customer ownership before storing or returning references. Until then, reject or omit unvalidated customer IDs.

### Review of aggregation, query scoping, nested routes, and background work

- Operational route families mounted in `server.js` pass through `auth` and `tenantContext`; the singular legacy routes are included. `/api/auth` and public registration are identity endpoints; `/api/user` only aliases public registration. `/api/admin` is separately Super Admin-only, but the operational Super Admin bypass noted above defeats the intended separation.
- Mongoose query middleware scopes common find/count/update/delete operations and aggregate middleware adds an initial tenant `$match`. The inspected route code does not accept a caller-supplied aggregation pipeline or use native Mongo collections for operational requests. The migration script deliberately uses native collections and is reviewed separately below.
- No scheduled/background job implementation was found in the inspected backend. No claim is made about tenant propagation to future jobs.
- `bulkWrite`, direct collection access, and some other Mongoose APIs are not covered by `ownershipPlugin`; no operational route currently uses `bulkWrite`, but new code must not assume it is scoped.
- Query scoping protects record lookup before updates, and update middleware forces `companyId` in company context. The raw-body legacy create issue remains because the legacy principal branch does not remove `companyId`.

## Warehouse-access findings

### Controls that are present

- `tenantContext` loads active memberships from the database and checks the selected company against them; request headers alone cannot grant membership.
- Warehouse selections are checked against assigned IDs for non-Company-Admin members, then looked up under the selected company.
- The query plugin limits warehouse-bound models to assigned warehouse IDs and further narrows them when an active warehouse is selected.
- `resolveWarehouse()` checks company membership, assignment scope, selected warehouse context, and active status. Receiving/pallet service paths that call it have useful fail-closed checks.
- Company Admin is not taken from the global user role; it is resolved from the active company membership.

### Gaps

- No inventory transfer API/service/model exists, so source and destination authorization, transit accounting, and cross-company rejection for transfers cannot be verified. Do not represent transfers as implemented.
- Pallet relocation routes do not consistently enforce that the pallet and destination location use the same warehouse. See the Medium finding above.
- Several older receiving and pallet routes do not consistently validate destination warehouse relationships. `routes/receiving.routes.js` `/send` and `/dynamicsend` were improved to validate, but related legacy `/api/pallet/update` and `/api/pallets/:id` paths still need the same invariant.
- `routes/location.routes.js` legacy update accepts status/size/SKU changes without action-level role authorization. The location query is tenant-filtered, but authorization and capacity/stock consistency are not fully enforced.
- Company Admin correctly has company-wide data scope; each warehouse-bound write still needs same-company warehouse validation. The global `assignTenantFields()` helper itself checks assignment membership but does not query that an arbitrary Company Admin-supplied warehouse ID belongs to the company. Route helpers cover some, not all, write paths. Future or raw create paths must use `resolveWarehouse()`.

## Migration-safety findings

### `scripts/migrateCompanies.js`

**Safe properties found:**

- `loadMapping()` requires an explicit JSON mapping path; `--apply` is not the default.
- `makeReport()` uses reads/counts/aggregations only and emits a report. It does not write documents.
- Apply requires `--apply --confirm I_HAVE_VERIFIED_A_BACKUP`, and it refuses when the report is not ready.
- Apply uses one MongoDB transaction, writes company and membership rows with `$setOnInsert`, assigns only missing `companyId` values, preserves `ownerId`, and does not delete records.
- Duplicate company-scoped unique keys, unmapped owners, ownerless rows, conflicts, and many missing warehouse assignments are reported.
- Duplicate user-to-company mappings are rejected rather than silently choosing one company.

**High — Preflight omits warehouse review for already-company-scoped documents**

**File / location:** `scripts/migrateCompanies.js`, `makeReport()` (lines 113–139, especially line 114).

Warehouse-bound documents are examined with a filter limited to `companyId: { $in: [null] }`. A record that already has a matching valid `companyId` but has no `warehouseId`/`warehouse` is skipped by this check. It can therefore be omitted from `unmappedWarehouses`, allowing `readyToApply` to be true even though a warehouse-specific company record is incomplete. The apply path does not backfill such a row unless an assignment was added to `warehouseAssignmentsPlanned`.

**Required correction:** inspect every warehouse-bound record for missing/invalid warehouse assignment regardless of whether `companyId` is missing; verify company and warehouse ownership together. Add fixtures for company-scoped records with missing warehouse fields and require preflight to block apply.

**High — Existing Company ID collisions are not checked against the mapping’s intended company**

**File / location:** `scripts/migrateCompanies.js`, `validateMapping()` (lines 41–64) and `applyMapping()` (lines 202–218).

Mapping validation checks ID syntax and duplicate IDs inside the file but does not query whether a supplied company ObjectId already belongs to a different Company document/name/slug. `applyMapping()` uses `$setOnInsert`; if the ID already exists, the existing company is silently retained and mapped users/records are attached to it. The dry-run does not report this mismatch. A wrong real ID in the mapping can therefore attach legacy records to an unintended existing company without a preflight conflict.

**Required correction:** preflight existing company IDs and slugs. Require an explicit match or a newly unused ID; report and block any ID/name/slug collision before apply. Add tests for an existing ID with mismatched details.

**Medium — Malformed `companyId` BSON types can evade conflict detection**

The conflict count filters for `companyId` BSON type `objectId`; a non-null malformed string or other unexpected BSON type is not counted as a company mismatch and is not in the `companyId: null` backfill set. Add a type audit for every tenant collection; any non-null non-ObjectId value should block apply.

**Medium — The full migration is one unbounded transaction**

`applyMapping()` updates all rows for all mapped owners in a single transaction, with no batch/checkpoint strategy. This is atomic on a transaction-capable Atlas deployment, but can exceed transaction duration/size limits for a large database. A failure should abort changes, but the script provides only the thrown error and no persisted reconciliation/checkpoint report. Test realistic data volume on a restored staging copy before any apply.

### Mapping file: required contents and real IDs to collect

The map file does not currently exist. The script expects the path named by `COMPANY_MIGRATION_MAP`; the error shown points to `backend/scripts/company-migration-map.json`. The JSON structure is:

```json
{
  "companies": [
    {
      "id": "<new unique MongoDB ObjectId for this company>",
      "name": "<real company name>",
      "slug": "<unique-lowercase-company-slug>"
    }
  ],
  "users": [
    {
      "userId": "<existing users collection _id>",
      "companyId": "<matching companies[].id>",
      "role": "company_admin",
      "assignedWarehouseIds": ["<existing warehouse _id>"]
    }
  ],
  "warehouseAssignments": [
    {
      "collection": "pallets",
      "recordId": "<existing document _id>",
      "warehouseId": "<existing warehouse _id>"
    }
  ]
}
```

Collect real data in MongoDB Compass or a read-only export from the **staging/restored database**:

1. From `users`, collect `_id` for every user who owns records in the scoped collections. Also collect each `ownerId` value found in `items`, `products`, `categories`, `suppliers`, `warehouses`, `locations`, `pallets`, `orders`, and `tickets`. Every owning user must have an explicit mapping. One user cannot map to more than one company in this utility.
2. Decide the actual company boundaries with the business owner. Generate a genuinely new ObjectId for each new company and verify it is not already used; place it in `companies[].id`. Do not use a user ID, warehouse ID, slug, or placeholder as the company ID.
3. Collect each existing warehouse `_id` and establish which company it belongs to using verified business records. Use these IDs in each user’s `assignedWarehouseIds` only where that person should be assigned.
4. For each warehouse-bound record with no inferable warehouse, collect its collection name and `_id` for `warehouseAssignments`. Supported collection names are `products`, `locations`, `pallets`, `orders`, and `tickets`. The target warehouse must map to the same company as the document owner.
5. Resolve ownerless records, orphaned warehouses, existing company conflicts, duplicate company keys, and ambiguous ownership outside the map before considering apply.

Do not run apply until the preflight has been fixed to cover the gaps above and an isolated restored backup has been reconciled. No migration was run during this review.

### Legacy `scripts/migrateOwnership.js` is unsafe for SaaS conversion

**File / locations:** `scripts/migrateOwnership.js`, `migrateOwnership()` (lines 11–43); `package.json`, `ownership:migrate` command.

This separate older command assigns every ownerless record in nine collections to one email-selected user, without company mapping, relationship review, or transaction. It then drops several global unique indexes and creates indexes sequentially. A mid-run failure can leave a partial state; the assignment can silently place unrelated users’ records under one account. It is not the multi-company migration and must not be used for Phase 2 conversion.

**Required correction:** disable/remove the command from ordinary project scripts or make it fail with an explicit legacy-only warning until a reviewed, backed-up single-owner migration is intentionally authorized. Do not run it against Atlas.

## Frontend company-context review

- `frontend/src/api.js` stores the active company and warehouse IDs in `localStorage` and sends them as `X-Company-Id` and `X-Warehouse-Id`. These values are untrusted selectors, but the backend revalidates them against membership and warehouse records; this is not by itself an authorization bypass.
- `App.jsx` fetches `/companies/mine`, offers a selector for multiple memberships, and clears stale selections. The backend remains the security boundary.
- The UI allows “All authorized warehouses” (no warehouse header). The backend currently scopes warehouse roles to all assigned warehouses in that case. Any mutation that could span warehouses must explicitly validate the operation’s warehouse(s); current legacy relocation behavior does not always do so.
- JWTs are stored in `localStorage`. This increases exposure if an XSS vulnerability is introduced. The inspected work did not establish CSP/XSS protections or a safer session design; resolve before production hardening.
- Frontend code does not replace backend permission checks. Current screens do not prove that a read-only Auditor cannot invoke mutation endpoints directly.

## Architecture-document alignment

All nine architecture documents were read. The role matrix states Auditor read-only and describes separate audited Super Admin support; current routes do not fully enforce those rules. The API/workflow documents explicitly say transfers, procurement, shipment, returns, billing, and entitlements are proposed/future functionality, and no transfer endpoint was found. The roadmap still labels Phase 2 “Security and API baseline hardening” and Phase 3 “Tenant and membership foundation,” while the approved implementation brief calls the work reviewed here Phase 2 “Multi-Tenant Foundation.” Update roadmap numbering/status during a documentation phase so the phase gate is unambiguous; this review did not edit it.

## Tests executed

All tests were run locally without starting `server.js`, connecting to Atlas, or invoking any migration:

| Command | Result |
|---|---|
| `npm test -- --runInBand` | 5 suites passed; 47 tests passed |
| `npm test -- --runInBand test/tenantIsolation.test.js test/companyMigration.test.js` | 2 suites passed; 18 tests passed |

The migration and API tests use mocks; they do not exercise a real replica set, Atlas transactions, MongoDB indexes, or production data. Tenant tests exercise middleware/helpers and selected Mongoose query/aggregation hooks, not every route listed above. No frontend build/E2E test was run in this security review. No tests failed or were skipped by the test runner.

## Prioritized issue register

| Priority | Issue | Main location(s) |
|---|---|---|
| **High** | Legacy create routes allow a caller-supplied foreign `companyId` in legacy owner mode | `middleware/ownershipPlugin.js:19–27`; `/api/item/create`, `/api/location/create`, `/api/pallet/create`, `/api/receiving/create` |
| **High** | Super Admin gets global unscoped read/write access on tenant operational endpoints | `middleware/tenantContext.js:14–18`; `ownershipPlugin.js:3–4`; `server.js:55–64` |
| **High** | Staff and Auditor can invoke stock, pallet, receiving, order, ticket, and picker mutations | `routes/inventory.routes.js`; `palletCrud.routes.js`; legacy `receiving`, `pallet`, `order`, `ticket`, `picker` routes |
| **High** | Pending companies are not blocked by the production middleware configuration | `tenantContext.js:46`; `server.js:60` |
| **High** | Migration preflight skips missing warehouse fields on already-company-scoped records | `scripts/migrateCompanies.js:113–139` |
| **High** | Migration does not detect an existing Company ID that conflicts with the mapping’s intended company | `scripts/migrateCompanies.js:41–64, 202–218` |
| **High** | Legacy owner migration can silently assign unrelated ownerless records and drop indexes outside a transaction | `scripts/migrateOwnership.js:11–43`; `ownership:migrate` |
| **Medium** | Cross-warehouse pallet/location changes do not consistently enforce same-warehouse/transfer semantics | `routes/palletCrud.routes.js:44–71`; `routes/pallet.routes.js:178 onward` |
| **Medium** | Ticket/customer references cannot be verified against a tenant-aware Customer model | `model/Ticket.js`; `routes/ticket.routes.js:28–30` |
| **Medium** | Company membership grants are not audited and cannot be revoked through the current Company API | `routes/company.routes.js:95–150` |
| **Medium** | Non-ObjectId `companyId` values can evade migration conflict/preflight checks | `scripts/migrateCompanies.js:100–113` |
| **Medium** | Migration performs one unbounded transaction and lacks persisted checkpoints/reconciliation output | `scripts/migrateCompanies.js:202–248` |
| **Low / follow-up** | Local-storage bearer-token exposure and missing verified CSP/session hardening | `frontend/src/App.jsx`, `frontend/src/api.js` |
| **Low / follow-up** | Roadmap phase numbering/status conflicts with the approved Phase 2 brief | `docs/architecture/IMPLEMENTATION_ROADMAP.md` |

## Required fixes before Phase 3

1. Close legacy `companyId` injection and reference-validation paths; add regression tests for each raw-body create endpoint.
2. Remove the general Super Admin bypass from tenant operational endpoints; add a dedicated, audited, explicitly scoped platform support design.
3. Define and enforce per-role read/write permissions for every existing singular and plural route, with Auditor read-only and Staff task-limited behavior.
4. Enforce `active` company status on operational APIs and explicitly define what a pending company may do.
5. Enforce same-company and same-warehouse references at service boundaries; define transfers as a separate authorized, atomic workflow before allowing cross-warehouse movement.
6. Fix migration preflight for pre-scoped rows, malformed `companyId` values, existing company ID/slug collisions, and realistic-size transaction behavior. Add tests for each preflight case.
7. Disable or clearly gate `ownership:migrate` so it cannot be mistaken for the company migration.
8. Add role-by-route and route-level tenant IDOR tests, plus integration tests against an isolated transaction-capable replica set before migration approval.

## Proceed decision

**Do not proceed to Phase 3 yet.** Phase 2 establishes useful scaffolding, but the high-priority issues above mean company isolation, role authorization, Super Admin separation, and migration readiness are not yet independently verified as safe. The backend suite passes, but it does not cover the identified bypasses. No application fixes were made in this review, and no database or migration was touched.

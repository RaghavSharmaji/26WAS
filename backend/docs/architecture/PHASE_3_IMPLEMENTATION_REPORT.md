# Phase 3 — RBAC and Warehouse Authorization

**Status:** MILESTONES 1 AND 2 COMPLETE; MILESTONE 3 ROUTE AND LOCAL REPLICA-SET TESTS PASS; PHASE 3 REMAINS INCOMPLETE.

**Review date:** 2026-11-26

This is a milestone report, not Phase 3 completion. Membership lifecycle safeguards have route-level regressions and a completed local MongoDB replica-set integration run. No database migrations, production/Atlas connections, `.env` edits, dependency installs, or unrelated feature changes were made. The integration run used disposable local test data and cleaned its business fixtures afterward.

## Concise implementation plan

1. **Milestone 1 — role/permission audit and compatibility:** inspect roles, permission catalogs, membership storage, route registrations, authorization helpers, frontend context, and tests; document canonical policy, compatibility, and unmapped operations. **Complete in this pass.**
2. **Milestone 2 — backend permission enforcement:** implement the approved mappings below, replace unsafe wildcard grants, preserve company/warehouse scope, and add mounted route regressions. **Complete and verified.**
3. **Milestone 3 — membership lifecycle:** require reasons for create, role/assignment change, revocation, and reactivation; keep changes and audit writes in one transaction; enforce stale revisions, active actor checks, warehouse ownership, and last-admin rules. **Implementation, mocked route regressions, and four local replica-set integration tests passed.**
4. **Milestone 4 — frontend role/context:** use active membership role for navigation/actions, handle company/warehouse changes and revocation, add frontend regression coverage. A context-isolation fix from the prior Phase 3 pass is reused; role-aware UI is not complete.
5. **Milestone 5 — full verification:** route/role/company/warehouse test matrix, frontend production build, review diff and report. Production topology and cross-instance write-freeze verification remain separate environment gates.

Milestone 2 decisions are documented in `ROLE_PERMISSION_MATRIX.md` and `PHASE_3_ROLE_COMPATIBILITY.md`: both Super Admin identifiers normalize to canonical `super_admin` without stored-value migration; warehouse managers/staff may read company-wide catalog reference data within their active company while stock stays assignment-scoped; order operations map to actual handlers, `/submit` remains fail-closed, and absent transfer/return flows remain deferred.

## Existing functionality reused

- Existing React/Vite, Express, Mongoose, JWT, Company, CompanyMembership, Warehouse models, and tenant query plugin are retained.
- `tenantContext.js` resolves active membership/company from authenticated identity, rejects Super Admin from ordinary company routes, validates selected warehouse membership, and derives assigned warehouse scope.
- `ownershipPlugin.js` applies company/warehouse scope to supported Mongoose queries and aggregations and assigns trusted tenant fields during creation.
- `server.js` applies authentication, tenant context, and centralized permission middleware before operational route families; `/api/admin` remains a separate Super Admin route family.
- `company.routes.js` supports company creation/list/selection, existing-account membership creation/listing, membership role/warehouse assignment changes, and revocation. Membership create/update/revoke revalidate the actor in transaction and preserve last active Company Admin checks/audit writes.
- Existing test coverage includes Super Admin route separation, Auditor mutation denial, company membership revocation/stale-actor behavior, cross-company filtering, assigned/unassigned warehouse checks, and operational endpoint regressions.
- `frontend/src/api.js` supplies `X-Company-Id` and `X-Warehouse-Id`; `App.jsx` loads/selects memberships and authorized warehouses.

## Milestone 1 findings

### Canonical policy captured

The five canonical membership/platform roles are `super_admin`, `company_admin`, `warehouse_manager`, `warehouse_staff`, and `auditor`. Company Admin is full company-level only; Manager and Staff are warehouse-assignment constrained; Auditor is read-only; Super Admin is platform-only. Membership grant/change/revoke/reactivation requires a nonempty reason, with change and audit record atomicity. These rules are in [ROLE_PERMISSION_MATRIX.md](./ROLE_PERMISSION_MATRIX.md).

### Current-to-canonical compatibility

The actual global `User.role` enum is `superadmin`, `admin`, `staff`. The membership enum includes `company_admin`, `warehouse_manager`, `inventory_manager`, `procurement_manager`, `warehouse_staff`, `staff`, and `auditor`. `legacy_admin` and `legacy_staff` are derived permission-context values, not stored values. Existing permissions and route uses are inventoried in [PHASE_3_ROLE_COMPATIBILITY.md](./PHASE_3_ROLE_COMPATIBILITY.md).

No role data will be changed. The auth/authz boundary will normalize both `superadmin` and `super_admin` to the same platform-only identity. New provisioning will write `super_admin` where supported by the existing schema. `admin` is not automatically Company Admin. `staff` membership and global staff identity remain distinct. Inventory and Procurement Manager have no justified canonical equivalent; they remain fail-closed for unmatched permissions.

### Milestone 2 route mapping decisions

The backend now uses explicit route grants and rejects operations without a configured permission. Verified route decisions:

- `/api/order/create` maps to `orders.create`; `PUT /api/order/:id/status` maps to `orders.update` because the handler changes status and does not approve. `/submit` remains unmapped and returns a fail-closed permission error because the handler is an incomplete read and has no persisted submission behavior.
- Receiving handlers combine receive, validation, putaway, status reads, and charts; one route-level permission cannot safely represent all of those operations.
- Existing route-specific IDs such as `inventory.issue` and `inventory.receive` remain explicit compatibility permissions; they are not guessed into different API operations.
- `transfers.create/update`, `returns.receive/update`, and `auditLogs.view` refer to incomplete or platform-only route families. No transfer or returns API/service and no tenant audit-log route were found.
- Warehouse Managers and Staff can read company-wide catalog reference data inside their active company. Inventory/pallet queries remain restricted to assigned warehouse IDs by the model ownership plugin.
- Warehouse create/delete, membership/PII visibility to Auditors, and transfer approval/execution are fail-closed until the existing API semantics or an explicit policy settles them.

No transfer or returns routes were found; these operations remain deferred. Unsupported/unmapped specialist roles and operations remain denied unless an explicit existing permission is present.

## Membership lifecycle status

| Operation | Existing state | Phase 3 work remaining |
| --- | --- | --- |
| Create membership for an existing account | Company Admin only; active existing account and active same-company warehouses are checked; creation and audit are transactional; reason is mandatory. | The local replica-set cases covered membership updates, revocation races, and stale updates; creation-specific real transaction rollback was not a separate integration case. |
| List members | Company Admin only; includes active/inactive records and excludes soft-deleted user accounts. | Auditor read/redaction scope remains unresolved and unavailable by policy. |
| Membership detail | Company Admin only; company-scoped and returns selected account fields without credentials. | Real database transaction behavior not applicable to reads. |
| Change role/warehouse assignments | Transaction-time actor revalidation, membership revision compare-and-set, allowed-role validation, warehouse validation, reason and before/after audit. | Local replica-set stale-update test passed; production topology and cross-instance behavior are not established. |
| Revoke membership | Conditional revision update; clears warehouse assignments; last-admin guard and audit occur in same transaction. Later requests resolve membership from database and reject inactive users. | Local replica-set concurrent last-admin test passed; production topology and external writers are not covered. |
| Reactivate membership | Explicit `status: active`, active account and current warehouse references required; revision and reason required; audit records actual transition. | No separate local integration case for reactivation was run; covered by mocked route regression only. |
| Invite/email | Not implemented. | Not part of this phase unless the existing architecture is found to support it; none was found in this audit. |

## Frontend context status

The prior Phase 3 pass modified `frontend/src/App.jsx` to remount operational page components on company/warehouse changes, cancel stale dashboard response updates, and clear dashboard/warehouse selection data on failed company switching and warehouse selection changes. Company/warehouse headers remain selectors; backend checks remain authoritative.

Still missing: role-aware navigation/action gating based on active membership role; safe handling when membership or warehouse assignment is revoked while the session remains active; automated frontend tests for stale request completion and switching. The current frontend package has no test script/framework. Existing lint errors in `OtherPages.jsx` remain reported and were not hidden or modified.

## Files changed

**Milestone 1 and 2 documentation:**

- `backend/docs/architecture/ROLE_PERMISSION_MATRIX.md` — replaced the old draft with the canonical permission catalog, grants, scope constraints, and fail-closed route-mapping register.
- `backend/docs/architecture/PHASE_3_ROLE_COMPATIBILITY.md` — new legacy role/data compatibility assessment.
- `backend/docs/architecture/PHASE_3_IMPLEMENTATION_REPORT.md` — audit, implementation decisions, Milestone 2 results, and remaining gaps.

**Milestone 2 source and regression coverage:**

- `backend/middleware/roleCompatibility.js`, `auth.js`, `permissions.js`, `tenantContext.js`, `companyAuthorization.js`, `ownershipPlugin.js` — central Super Admin alias normalization, explicit permission checks, active tenant enforcement, and consistent platform-role semantics.
- `backend/model/User.js`, `backend/routes/auth.routes.js`, `backend/routes/company.routes.js`, `backend/routes/admin.routes.js`, `backend/server.js` — support both stored Super Admin IDs, return canonical role to clients, keep platform APIs separate, and exclude both IDs from company-member/admin-user targets.
- `backend/scripts/ensureSuperAdmin.js`, `resetSuperAdminPassword.js`, `createAdmin.js`, `migrateCompanies.js` — preserve legacy stored role values, provision canonical new records, and reject either Super Admin spelling from company mapping.
- `backend/test/api.test.js`, `backend/test/tenantIsolation.test.js` — mounted API and actual Mongoose query-scope regressions for role aliases, catalog scope, inventory scope, mapped orders, and fail-closed operations.
- `frontend/src/App.jsx` — compatibility check for both role spellings so the existing Super Admin dashboard still opens when auth returns canonical `super_admin`.

**Earlier Phase 3 context milestone (preserved):** `frontend/src/App.jsx` contains the company/warehouse stale-data protections described above. No other frontend or backend source was modified in the current Milestone 1 pass. Existing Phase 2 working-tree changes remain untouched.

## Tests and verification

- Backend `npm test -- --runInBand`: **5 suites / 109 tests passed**. An earlier run exposed a syntax error in a new test description; it was corrected, then the full suite passed.
- Frontend `npm run build`: **passed (2,157 modules)**.
- Frontend `npm run lint` was run in the earlier pass and **failed** on React Hooks errors in `frontend/src/pages/OtherPages.jsx`, plus warnings; that file was not modified.
- `git diff --check`: **passed** for this milestone; Git printed LF-to-CRLF normalization notices for existing working-tree files, with no whitespace errors.
- No dependency installation, `.env` change, database connection, role migration, ownership migration, or Atlas/production access occurred.
- Mocked transaction tests are not evidence of real MongoDB transaction or cross-instance write-freeze safety.

## Historical stop point / Milestone 2 status

At the end of Milestone 2, the implementation report recorded that real replica-set transaction behavior was unverified. That historical status was superseded by the Milestone 3 local verification below. The `/api/order/submit` route remains unmapped, incomplete, and denied; unknown operations fail closed. No transfer or returns endpoints exist, so those workflows remain deferred.

**Phase 3 completion:** not approved. Role-aware navigation and frontend regressions, handling assignment revocation in a live session, deferred workflows, broader system verification, production topology verification, and cross-instance write-freeze tests remain outstanding.

## Milestone 3 — Membership Lifecycle (2026-11-26)

### Implemented

- Membership management is mounted behind authentication, an active selected company context, and an active Company Admin membership check. Both stored Super Admin role spellings are denied this ordinary company API.
- Existing-account creation, listing, detail retrieval, role/warehouse assignment updates, revocation, and explicit reactivation are supported by the existing `/api/companies/:companyId/members` route family.
- Every mutation requires a trimmed non-empty textual `reason` of at most 500 characters. Unsupported request fields are rejected; company/owner and privilege fields cannot be supplied.
- Creation only grants the existing allowed creation roles. Update preserves the existing legacy membership roles without changing stored records. Super Admin accounts, inactive accounts, and deleted accounts cannot be added or reactivated.
- Warehouse assignments validate ObjectId format, uniqueness, active state, and same-company ownership. Warehouse-scoped roles require at least one assignment; Company Admin follows the existing company-wide policy.
- Existing `AuditLog` records capture actor, target, company, action, reason, actual prior/next role, assignments and status. Membership changes and audit inserts use the same MongoDB session/transaction.
- Existing per-company `membershipRevision` serialization remains in use. Memberships now carry an additive revision token (legacy missing values act as revision zero); update/revocation compare the expected revision and require one matched and modified document.
- The acting Company Admin is revalidated inside each membership mutation transaction. The company revision write serializes same-company membership mutations; last active Company Admin downgrade/revocation checks execute in the transaction. Revocation clears warehouse assignments and the tenant context checks current membership on each later request.
- Error responses now preserve a safe application error `code` when an error explicitly defines one; unexpected errors continue to return a generic 500 message.

### Regression coverage and result

Route tests cover successful membership creation, missing/invalid reasons, role allowlists, unavailable targets, non-admin denial, duplicate and cross-company warehouse assignments, detail/list retrieval, role changes and old/new audit values, stale revisions, last-admin downgrade/revoke, explicit reactivation, audit failure, transaction-session sharing, actor demotion between context resolution and mutation, and immediate denial on subsequent product and inventory requests after revocation.

**Mocked route suite:** `npm test -- --runInBand` previously reported **5 suites passed, 129 tests passed; the opt-in integration suite and its 4 tests skipped** when `WAREFLOW_M3_TEST_URI` was not configured. These route tests verify request validation and authorization flow but do not prove MongoDB rollback or concurrent transaction behavior.

### M-02 — Transaction-time actor account and authorization revalidation (2026-11-26)

The M-02 remediation rechecks the trusted `req.auth.id` actor inside the transaction for company creation (which creates the initial Company Admin membership) and for existing-account membership creation, role/warehouse/status updates including reactivation, and revocation. The session-scoped User read requires the actor to exist, have `accountStatus: active`, have no `deletedAt` timestamp, and not be a Super Admin. Membership mutations also require the actor's active `company_admin` membership for the route company. `tenantContext` now carries the authenticated membership revision; the transaction compares it with the current membership revision and fails with an authorization error if it changed. Request-body actor identity is not accepted. Failed checks happen before the membership or audit write; last-admin and target-revision checks remain in place.

Regression coverage includes successful membership mutation with the actor User read attached to the transaction session, actor account becoming inactive/deleted/missing, actor membership revocation/demotion, and stale actor membership revision. Each denial asserts that no membership write or successful audit is issued and that the transaction callback fails. An opt-in local-replica-set test additionally changes the actor's account to inactive inside the transaction and verifies the request is denied and that the account update, membership mutation, and audit do not commit together. This test remains opt-in and is not evidence of live rollback unless run against the permitted disposable local replica set.

**M-02 verification:** Focused membership route tests reported **30 passed, 0 failed** (53 non-matching tests skipped by the name filter). The complete backend run reported **5 suites passed, 2 skipped; 155 tests passed, 0 failed, 13 skipped**. The local membership and ticket replica-set suites were skipped because their local-only URI variables were unset. No database connection or migration was performed for this verification. These results are mocked/unit and route-level evidence; live replica-set behavior for M-02 remains unverified.

### Local replica-set integration verification

Per the completed local verification, MongoDB Server **9.0.4** ran as the disposable replica set **`wareflowTest`**, using the dedicated database **`wareflow_phase3_m3_test`**. `WAREFLOW_M3_TEST_URI` was set only as a temporary PowerShell environment variable for the test run; no `.env` file was used or changed.

The actual integration output was **1 suite passed, 4 tests passed, 0 failed, 0 skipped** for `test/membershipTransaction.integration.test.js`. The four cases verified:

1. Membership update and matching audit record commit together.
2. Membership update rolls back when audit insertion fails.
3. Concurrent attempts to remove the last two active Company Admins leave one active.
4. Concurrent updates using one stale revision permit one change and reject the other.

Fixture cleanup was checked after the tests. User, company, membership, warehouse, audit, and other WMS business collections had zero documents. The only remaining record was `wareflow_control` with `_id: company-migration-write-freeze`. The disposable MongoDB server was stopped after verification. No production/Atlas connection, migration, or `.env` modification occurred.

This is real local replica-set evidence for the four membership scenarios above. It does **not** establish the complete production system, production topology behavior, multi-instance write-freeze correctness, external/direct database-writer behavior, or workflows outside those four tests.

### M-03 — Migration write-freeze ownership and recovery safeguards (2026-11-26)

The prior shared control record maintained only a numeric active-write count, so it could not identify which request/process owned a stale count after a crash. The migration token was checked during normal unlock, but there was no migration process identity or controlled recovery workflow. Abrupt process termination during an HTTP mutation or migration can therefore leave a lease/count or a migration lock persisted; automatically clearing it by age could allow writes to overlap a live slow request or migration.

The revised mechanism assigns each HTTP write a unique lease ID and records process-instance ID, PID, hostname, and acquisition time. Release requires the exact lease and current process instance. Migration lock acquisition now waits up to 30 seconds for active leases to finish, then atomically acquires only when the active count equals the empty lease list. The lock records its unique token and owning process metadata; normal release requires both the exact token and owning process instance. New writes and migration attempts fail closed when ownership/count state is inconsistent. A clean, quiescent legacy control record can initialize empty lease/audit lists. Legacy non-zero counters or locks without owner metadata remain blocked for operator review.

No automatic expiry, heartbeat, stale-lock cleanup, or crash recovery was introduced. Recovery is an explicit separate command, `npm run migration:freeze:inspect` (read-only by default) and `npm run migration:freeze:recover -- --apply ...`. Apply mode names exactly one lease or lock, requires an operator, reason, exact owner-stopped confirmation phrase, and owner identity. On the same host it also refuses if the recorded PID is present or cannot be checked. Remote-host liveness is not provable by this application; the operator must verify exact process termination through the host/process supervisor before attesting. Lease recovery is restricted to a sole active lease with no migration lock. Lock recovery requires zero active leases and an exact token/owner match. The record update and embedded recovery audit event are atomic; races fail by exact conditional update. There is no blanket clearing command.

The migration guide includes the Windows PowerShell recovery procedure and exact confirmation phrase. The freeze covers HTTP mutations mounted through the shared middleware, startup Super Admin provisioning, and the migration utility. Repository inspection found no queue worker or scheduled-job implementation. Standalone admin bootstrap/password scripts, other maintenance scripts, other services, and direct database clients do not acquire this lock and must be stopped or independently coordinated. The company's migration CLI confirmation remains an operator attestation for those external writers; it does not prove database-wide write exclusion.

**M-03 verification:** The added coverage is mocked against the in-memory control-record test double. It covers unique lease acquisition/release, cross-instance release denial, shared freeze blocking, bounded draining, interrupted response lease retention, ambiguous legacy state, active/ambiguous recovery refusal, exact-target recovery, audit recording, concurrent recovery, and owner-checked normal migration release. No local or production MongoDB connection was made for this work. The mocks do not prove MongoDB's cross-instance atomic behavior or crash/restart recovery under a real replica set; those require a separately approved local replica-set test. No migration was executed and no database record was changed by this work.

The focused mocked migration suite completed with **1 suite passed, 52 tests passed, 0 failed**. The full backend suite completed with **5 suites passed, 2 opt-in integration suites skipped; 165 tests passed, 0 failed, 13 skipped**. The skipped tests require `WAREFLOW_M3_TEST_URI` or `WAREFLOW_TICKET_TEST_URI`, neither of which was set for this run. `git diff --check` passed. These counts do not include any live database verification.

### Files changed in Milestone 3

- `backend/model/CompanyMembership.js` — additive optimistic revision field.
- `backend/routes/company.routes.js` — protected lifecycle routes, validation, transaction-time authorization, CAS writes, and transactional audit details.
- `backend/middleware/errorHandler.js` — includes explicitly defined safe error codes in expected error responses.
- `backend/test/api.test.js` — mounted route regressions for membership lifecycle and denial behavior.
- `backend/test/membershipTransaction.integration.test.js` — opt-in local-only replica-set transaction/concurrency test suite.
- `backend/docs/architecture/PHASE_3_IMPLEMENTATION_REPORT.md` — Milestone 3 implementation and verification record.

### Remaining limitations and risks

- The four local integration cases passed, while the broader mocked route suite remains a separate test layer; neither alone establishes behavior for every database topology or retry/transient error mode.
- Production topology and cross-instance write-freeze behavior remain unverified. Direct/external database writers remain outside the application transaction and lock guarantees.
- Frontend role-aware controls and live refresh after membership/warehouse reassignment are deferred to Milestone 4; server-side authorization remains authoritative.
- No production readiness claim is made.

# Phase 2.2 Independent Security Review — Remediation Recheck

**Review date:** 2026-11-26  
**Review type:** Current-source verification plus mocked API/migration tests  
**Scope:** F-01 through F-06 from the prior Phase 2.2 review and the related tenant, authorization, pallet, membership, and migration code. No `.env` or dependency changes, Atlas/production connection, migration, or destructive Git operation was performed.

## Verdict

# APPROVED FOR STAGING REHEARSAL

The three source-level blockers F-01, F-02, and F-03 are fixed and have regression coverage. Backend tests and frontend build pass. This verdict permits only an isolated staging/local replica-set rehearsal. It does **not** establish real MongoDB transaction safety or approve migration apply, production rollout, or direct database writes.

## Scope inspected

- `backend/server.js` route registration and middleware ordering.
- `backend/middleware/migrationWriteFreeze.js`, `auth.js`, `tenantContext.js`, `permissions.js`, `companyAuthorization.js`, `ownershipPlugin.js`, and `requestContext.js`.
- Company membership routes, pallet singular/plural routes, receiving/location/picking/order/ticket/inventory/product/CRUD/report routes, services, and operational models.
- `backend/scripts/migrateCompanies.js`, retired `migrateOwnership.js`, `backend/package.json`, and migration/API/tenant tests.
- `frontend/src/App.jsx`, `frontend/src/api.js`, and current architecture documents plus the earlier Phase 2 security/verification/remediation reports.

## Verified control behavior

### Route boundary, tenancy, and roles

`server.js` runs `migrationWriteFreeze` globally before routes. Protected operational families then pass authentication, tenant context, and the centralized permission map before route handlers. `/api/admin` is separately Super Admin-protected. Operational tenant context rejects Super Admin, requires an active membership and a company whose status is exactly active, and denies users with inactive memberships instead of falling back to legacy `ownerId` scope.

The permission middleware strips caller-provided top-level `companyId`/`ownerId`, removes query `companyId`, validates supplied warehouse references, and denies unknown mutation mappings. Legacy owner filtering includes `companyId: null`. Mongoose query and aggregate hooks add tenant/warehouse scope for inspected operational model paths. This does not cover arbitrary future native collection/bulk operations.

### F-01 — Shared application write freeze: fixed in source

`migrationWriteFreeze.js` stores a singleton control record in MongoDB collection `wareflow_control`. Mutating HTTP requests atomically increment `activeWrites` only while `maintenance` is false; response finish/close releases the lease. The migration atomically acquires maintenance only when `activeWrites` is zero, keeps the lock through its in-transaction preflight and writes, and releases it in `finally`. New mutations fail closed with 503. The shared MongoDB record coordinates all backend instances connected to the same database; this coordination is not an in-memory flag.

The CLI phrase is not treated as enforcement. It remains an explicit attestation that external writers were stopped. Direct database clients, independent services, and out-of-process jobs are not blocked and must be frozen separately. A process crash leaves maintenance active (fail-closed); operators must verify no migration is running and reconcile state before manual recovery. A crashed request can leave a stale lease count and block migration, also fail-closed.

Mocked tests cover freeze acquisition, active-request contention, denial of actual mounted HTTP mutations, release, and cleanup after a migration transaction failure. They do not prove MongoDB atomic behavior across instances; that remains part of F-04.

### F-02 — Membership actor revalidation: fixed in source

For membership create, update, and revoke, `company.routes.js` now calls `assertActiveCompanyAdmin(session, actorId, companyId)` after acquiring the company revision lock inside the transaction. It verifies active status and `company_admin` role with the same session before changing the target membership. The last active Company Admin check remains in the same transaction. Membership save/create and AuditLog insert continue to share the transaction, so an audit failure should abort both on a transaction-capable MongoDB deployment.

Mounted API regressions simulate an actor who passes the initial check but is demoted before the transaction recheck. Create, update, and revoke each reject before a target membership or audit write.

### F-03 — Pallet status validation: fixed in source

The model centralizes the workflow statuses observed in existing code: `receiving`, `received`, `r/p`, `store`, `picked`, and `damaged`. The Mongoose field has an enum, and both singular and plural update handlers validate against the same `Pallet.STATUS_VALUES` after enforcing their existing `inventory.putaway` and `inventory.update` permissions. Staff denial is unchanged. Tests cover bad values on both routes, allowed status changes for Warehouse Managers and Company Admins, and Warehouse Staff denial.

Receiving transitions remain separate workflow operations with their own receiving permissions and state checks; they are not arbitrary status-update endpoints.

### Migration safeguards retained

The company migration remains dry-run by default; requires a reviewed mapping and backup confirmation; rechecks preflight inside a transaction; compares the plan; validates user, membership, company, warehouse, and uniqueness conflicts; checks conditional write counts; and verifies final memberships. It refuses more than 1,000 planned writes, more than 10,000 owner records in a collection, or more than 1,000 owner groups. It has no partial-batch bypass. The retired owner-only migration still fails closed.

The new lock is acquired inside `applyMapping()` after the CLI has produced its report, then preflight is repeated under the lock and transaction. The MongoDB lock prevents concurrent HTTP mutation through this backend during the actual revalidation/apply window. External writers still require a separately controlled freeze.

## Finding register

### F-01 — High — Unenforced write-freeze assertion

- **Status:** **Fixed for application HTTP writers; external writer freeze still required.**
- **Files/functions:** `backend/middleware/migrationWriteFreeze.js`, `migrationWriteFreeze()`, `acquireApplicationWriteLease()`, `acquireMigrationWriteFreeze()`; `backend/server.js`; `backend/scripts/migrateCompanies.js`, `applyMapping()`.
- **Evidence:** Shared singleton MongoDB control record, atomic leases/lock, global middleware before all routes, migration acquire/release in `try/finally`, and tests covering denial/contention/release.
- **Residual attack/failure case:** A direct MongoDB client or another service bypasses the Express middleware and can still write during migration if the operator does not stop it. A crashed process can leave the lock/lease state requiring manual recovery.
- **Recommendation:** Keep the external writer freeze mandatory; rehearse stale-lock recovery and multi-instance coordination against a local replica set. Never clear a lock automatically or treat the CLI phrase as proof.
- **Blocks Phase 2:** **No for staging rehearsal; external freeze is mandatory before any apply.**

### F-02 — Medium — Stale Company Admin authorization during membership changes

- **Status:** **Fixed in source and route regressions.**
- **Files/functions:** `backend/routes/company.routes.js`, `assertActiveCompanyAdmin()`, membership POST/PATCH/DELETE transaction callbacks.
- **Evidence:** Actor membership is re-read with the same session after `lockMembershipWrites()`; tests simulate a demoted actor after the initial request check on create/update/revoke.
- **Residual risk:** Real MongoDB transaction conflict/retry semantics are not established by the mocked test suite.
- **Recommendation:** Verify simultaneous demotion/revocation and grant behavior in the local replica-set rehearsal; confirm both membership and audit records roll back on failure.
- **Blocks Phase 2:** **No for rehearsal; transaction integration verification remains part of F-04.**

### F-03 — Medium — Arbitrary status strings on singular pallet update

- **Status:** **Fixed in source and mounted route tests.**
- **Files/functions:** `backend/model/Pallets.js`, status enum; `backend/routes/pallet.routes.js`, POST `/update`; `backend/routes/palletCrud.routes.js`, PUT `/:id`.
- **Evidence:** Both routes consume the same six model-supported status values and validate before loading/updating the target record. Role checks run before value validation. Tests assert invalid values return 400, staff returns 403, and manager/admin valid status writes succeed.
- **Residual risk:** No existing production dataset was queried for legacy values outside this workflow set; no migration or DB access was performed.
- **Recommendation:** During a separately approved read-only staging audit, count existing statuses and resolve any unknown legacy values before deploying the enum to production.
- **Blocks Phase 2:** **No for staging rehearsal.**

### F-04 — Medium — Real replica-set transaction behavior not verified

- **Status:** **Environment limitation; manual isolated rehearsal procedure documented.**
- **Files/functions:** `backend/services/tenantService.js`, `movePallet()`; membership transactions in `company.routes.js`; migration `applyMapping()`.
- **Evidence:** Current environment has no `mongod`/`mongosh` executable or MongoDB service, no `mongodb-memory-server` or Testcontainers MongoDB package, and Docker is installed but its daemon is inaccessible (`docker info` exit code 1). Tests use mocked sessions. Installed versions are Mongoose 6.13.8 and MongoDB driver 4.17.2.
- **Failure scenarios still untested against real MongoDB:** successful pallet/location transaction; rollback after an intermediate write fails; two concurrent movements competing for one location; membership transaction rollback when audit insertion fails; cross-instance write-freeze atomicity.
- **Recommendation:** Follow the local-only replica-set procedure in `PHASE_2_2_REMEDIATION_REPORT.md` on a disposable sanitized copy. Include success, injected failure/rollback, concurrency, audit rollback, and multiple backend instances. Save results for independent review.
- **Blocks Phase 2:** **No for staging rehearsal; yes for migration apply or any claim of verified transaction safety.**

### F-05 — Low — Ownership plugin does not cover every database API

- **Status:** **Open defense-in-depth follow-up; no operational bypass found in inspected routes.**
- **File/function:** `backend/middleware/ownershipPlugin.js`, query and aggregate hooks.
- **Evidence/scenario:** Native collection and bulk APIs bypass plugin hooks if a future operational handler calls them without explicit tenant filters.
- **Recommendation:** Scope and review any direct/native operation explicitly; retain the separate migration/platform controls.
- **Blocks Phase 2:** **No current bypass identified.**

### F-06 — Low — Frontend localStorage token exposure and CSP/session hardening

- **Status:** **Open follow-up; frontend unchanged in this remediation.**
- **Files/functions:** `frontend/src/api.js`, token interceptor; `frontend/src/App.jsx`, session restore.
- **Evidence/scenario:** Same-origin injected script could read `wms.auth.token` and replay the bearer token.
- **Recommendation:** Separately review XSS/CSP and consider secure HttpOnly cookie sessions with CSRF protection. No unrelated auth redesign was included here.
- **Blocks Phase 2:** **No for this targeted staging rehearsal.**

## Tests and build

- Backend full suite: `npm test -- --runInBand` — **5 suites passed, 91 tests passed**.
- Focused mounted API and migration suites: **2 suites passed, 62 tests passed**.
- Frontend: `npm run build` — **passed**, Vite 8.3.8 transformed 2,157 modules.
- `git diff --check` — passed; Git emitted only LF-to-CRLF normalization notices for existing modified files.
- No Atlas/production or other MongoDB connection was made; no migration was run; no dependencies or environment files were changed.

## Final recommendation

**APPROVED FOR STAGING REHEARSAL only.** Complete and independently review the local replica-set rehearsal before any migration apply. The approval does not cover applying the migration, production rollout, or uncoordinated external database writers.

## Follow-up verification — 2026-11-26

### Shared migration write-freeze audit

The shared singleton record is in MongoDB's `wareflow_control` collection. MongoDB's atomic `findOneAndUpdate` predicate prevents a migration from acquiring while `activeWrites` is nonzero or `maintenance` is already true, and prevents an HTTP writer from incrementing while maintenance is true. Competing migration attempts use the same `_id` and mutually exclusive predicates. The `_id` uniqueness constraint and duplicate-key recovery handle concurrent first-time initialization. These are source-level findings; this environment has no local MongoDB process with which to verify cross-process atomicity.

`server.js` mounts the guard before every route. It covers all HTTP mutation verbs on every mounted path, including `/api/auth`, `/api/companies`, `/api/admin`, operational routes and unknown paths. Reads and preflight `OPTIONS` skip the lease. A migration acquires the lock before its transaction/preflight recheck and releases it from `finally`, including session setup and transaction failures. Release matches the lock token, so an old cleanup cannot release a different holder's lock. There is no lease expiry or renewal: an expired/old holder cannot continue under automatic expiry because none exists.

**Race found and corrected:** the prior `close` listener decremented `activeWrites` immediately. A client disconnect can close the response while an asynchronous route is still writing. The middleware now releases on response `finish` only; a premature `close` retains the lease and logs that operator reconciliation is required. This is intentionally fail-closed and can reduce availability, but prevents migration from proceeding based on an unverified drain. A process crash while holding `maintenance=true` similarly requires manual recovery after confirming the migration process is stopped. There is no automatic stale-lock clearing.

The application lock only covers HTTP requests passing through this Express instance set and the migration runner sharing this database. Direct MongoDB writers, external services/jobs, and startup provisioning such as `ensureSuperAdmin()` are outside the HTTP guard and require separate operational controls. The CLI attestation is not enforcement for those writers.

Regression tests added in `backend/test/companyMigration.test.js` race two migration acquisitions against the shared control test double (exactly one succeeds), and simulate an aborted response retaining its lease until finish/reconciliation. The actual mounted API freeze denial test remains in `backend/test/api.test.js`. These mocked tests do not prove replica-set behavior.

### F-02 / F-03 current-source confirmation

F-02 remains verified in `company.routes.js`: create, update, and revoke each acquire the company membership revision write inside the same transaction, then re-read the actor membership with that session and require active `company_admin`. Target membership mutation, last-active-admin count, and audit insert use the same session. Route regressions model stale initial authorization for all three operations. The last-admin guard is present on demotion and revocation in source. Real concurrent write-conflict and rollback semantics remain unverified without a replica set.

F-03 remains verified: `Pallet.STATUS_VALUES` is the model's existing six-value set (`receiving`, `received`, `r/p`, `store`, `picked`, `damaged`) and is also the schema enum. Singular `POST /api/pallet/update` and plural `PUT /api/pallets/:id` each require `inventory.update` for a status change and validate against that same constant. Route tests cover invalid values on both routes, allowed manager/admin writes, and staff denial. The mounted route boundary denies Super Admin before either handler.

### Local replica-set availability and procedure

No `mongod`, `mongosh`, or legacy `mongo` executable is available. The Docker CLI exists, but its daemon is unavailable (`docker info` cannot open the Docker Desktop Linux engine pipe). No database connection was attempted. Therefore real MongoDB transaction tests were not run and transaction safety is not claimed.

To perform the isolated rehearsal on a machine with MongoDB Community Server and Shell installed, use a fresh disposable directory and loopback-only port, then initialize a one-member replica set:

```powershell
New-Item -ItemType Directory -Force "$env:TEMP\wareflow-phase22-mongo" | Out-Null
mongod --replSet wareflowPhase22 --bind_ip 127.0.0.1 --port 27018 --dbpath "$env:TEMP\wareflow-phase22-mongo"
```

In another terminal:

```powershell
mongosh "mongodb://127.0.0.1:27018/admin" --eval "rs.initiate({_id:'wareflowPhase22',members:[{_id:0,host:'127.0.0.1:27018'}]})"
mongosh "mongodb://127.0.0.1:27018/admin" --eval "rs.status().members.map(m => ({name:m.name,stateStr:m.stateStr}))"
```

Use only a sanitized disposable database and terminal-scoped URI. Exercise pallet movement success, injected mid-transaction failure and rollback, two concurrent movements competing for one location, membership/audit rollback, plus two app instances contending on the shared lock. Compare before/after documents and save the output. Do not use Atlas/production and do not run the company migration as part of these transaction tests. Full steps and failpoint examples remain in `PHASE_2_2_REMEDIATION_REPORT.md`.

### Phase 3 preparation (not implemented)

The roadmap's Phase 3 is the tenant and membership foundation. Company, membership, active-company context, warehouse assignments and baseline permission checks already exist from the Phase 2 security work. Remaining Phase 3 work should be scoped to completing and formalizing those contracts, not rebuilding them:

| Work item | Dependencies | Likely files / tests |
| --- | --- | --- |
| Review role/permission matrix against all user journeys; remove legacy wildcard roles only after compatibility policy is approved | Approved business role matrix; Phase 2 authorization baseline | `backend/middleware/permissions.js`, `companyAuthorization.js`, `ROLE_PERMISSION_MATRIX.md`; permission and mounted API tests |
| Complete scoped service/repository boundaries and audit every direct/native query for explicit tenant + warehouse scope | Stable company context and route inventory | `tenantContext.js`, `ownershipPlugin.js`, `requestContext.js`, `services/`, operational routes; cross-company and cross-warehouse IDOR tests |
| Finish active-company selection and multi-company switching behavior in client context, including stale/inactive membership refresh | Backend context contract; token/session behavior decision | `frontend/src/api.js`, `App.jsx`, auth/company context components; multi-company UI/API integration tests |
| Complete invitation and membership lifecycle (invite, accept, role change, warehouse assignment, revoke) with atomic audit and last-admin rules | Membership policy and transaction-capable test DB | `company.routes.js`, membership models/services; stale actor, duplicate invite, role escalation, warehouse assignment and replica-set rollback tests |
| Establish warehouse-scoped role grants consistently for every warehouse-specific workflow | Approved role matrix and warehouse assignment policy | `tenantContext.js`, `companyAuthorization.js`, receiving/order/pallet/location/transfer routes; cross-warehouse negative tests |

Phase 3 must wait for independent acceptance of the Phase 2 security remediation and a successful isolated replica-set rehearsal for transaction-dependent operations. Phase 4 migration work remains separately gated by reviewed real mappings, backup, rehearsal, and approval.

### Verification for this follow-up

- `backend`: `npm test -- --runInBand` — **passed, 5 suites / 93 tests**.
- `frontend`: `npm run build` — **passed**, Vite 8.3.8 transformed 2,157 modules.
- Repository root: `git diff --check` — **passed**. Git printed line-ending normalization notices (LF to CRLF) for existing working-tree files; it reported no whitespace errors.
- Migration-lock concurrency tests: **2 passed** (one concurrent acquisition winner; premature response close retains lease until finish). The actual mounted API freeze-denial test also passes in the full suite.
- No MongoDB executable/service was available and Docker daemon was unavailable. No MongoDB connection or migration was attempted. Therefore these tests do not prove cross-process database atomicity or transaction behavior.

For this follow-up, the only source changes were the response-close lease handling in `backend/middleware/migrationWriteFreeze.js` and two regression tests in `backend/test/companyMigration.test.js`; this review and the remediation report were updated. The rest of the current working tree contains prior Phase 2.1/2.2 work and remains untouched by this follow-up.

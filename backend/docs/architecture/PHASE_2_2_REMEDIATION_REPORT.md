# Phase 2.2 Targeted Security and Migration Remediation

**Review date:** 2026-11-26  
**Status:** F-01, F-02, and F-03 are fixed in source and covered by regression tests. Ready for a controlled staging rehearsal only; this is not approval to apply a migration.  
**Scope:** Phase 2 security remediation only. No Phase 3 implementation, `.env` change, dependency change, database connection, Atlas connection, or migration execution was performed.

## Changes resolving the independent-review findings

### F-01 — Shared, enforced application write freeze

Added `backend/middleware/migrationWriteFreeze.js`, using one MongoDB control document in the `wareflow_control` collection. Every HTTP request using a mutation method obtains an atomic write lease before it reaches a route and releases the lease when its response finishes. The middleware is mounted globally before routes, so membership writes and operational writes share the same control, across separate backend instances using the same database.

The migration runner atomically acquires the maintenance lock only when the active HTTP write count is zero. While held, new HTTP mutations fail closed with HTTP 503. The lock stays held through the transaction and preflight recheck, and normal success/failure cleanup releases it. If the process stops before cleanup, the lock remains set and writes stay paused; an operator must verify the migration process is stopped and inspect the control record before manually recovering service. There is no automatic timeout that could reopen writes during a long-running migration.

If a client disconnects before the response finishes, the middleware retains the lease and requires operator reconciliation. Releasing on `close` could allow an asynchronous route handler to continue writing while a migration starts. This fail-closed behavior can strand an active-write count after a process/request failure; there is no automatic expiration that could admit a stale writer.

The CLI write-freeze confirmation remains an operator attestation for **external database writers**. It is not treated as proof of the application lock. Direct MongoDB clients, startup provisioning, scheduled jobs outside this Express process, and other services are not blocked by this lock and must be separately stopped or frozen for the entire apply window.

### F-02 — Transaction-time Company Admin authorization

Membership create, update, and revoke routes now re-read the actor's membership with the same MongoDB session after acquiring the per-company membership revision lock. The transaction aborts unless the actor is still an active Company Admin. The existing last-active-admin check and audit writes remain in the same transaction as the membership change.

Mounted API regressions simulate a request whose initial authorization succeeds but whose membership has been demoted by the time the transaction rechecks it. Each create/update/revoke path rejects before the target membership or audit write.

### F-03 — Supported pallet status validation

The existing workflow values are now centralized in `Pallet.STATUS_VALUES` and enforced by the Mongoose status enum and both pallet update routes:

```text
receiving, received, r/p, store, picked, damaged
```

These values come from the existing create, receive, putaway, and pallet-edit code paths. No additional status was introduced. Both singular and plural routes reject unknown values after enforcing the existing role permission. Tests cover invalid statuses on both route families, allowed status updates for Warehouse Managers and Company Admins, and denials for Warehouse Staff.

## F-04 — Real replica-set transaction verification

Real transaction testing was **not possible in the current environment**. The workspace has no `mongod`/`mongosh` executable or MongoDB service, neither `mongodb-memory-server` nor Testcontainers MongoDB is installed, and Docker CLI is present but the Docker daemon is inaccessible (`docker info` exited with code 1). The installed Mongoose/driver versions are 6.13.8 / 4.17.2. No dependencies were added and no remote database was contacted.

The Jest suite uses mocked sessions. It verifies authorization/control flow but does not prove transaction isolation, rollback, write-conflict retries, or replica-set support. Use this controlled procedure on a disposable local replica set restored from a sanitized staging copy before approving migration apply:

1. Install MongoDB Community Server and Shell if they are not already available. Start a separate local-only replica set on an unused port and a new temporary data directory; bind only to `127.0.0.1`. For example, in one PowerShell terminal:

   ```powershell
   New-Item -ItemType Directory -Force "$env:TEMP\wareflow-phase22-mongo" | Out-Null
   mongod --replSet wareflowPhase22 --bind_ip 127.0.0.1 --port 27018 --dbpath "$env:TEMP\wareflow-phase22-mongo"
   ```

2. In another terminal, initialize that isolated instance and verify it is a primary:

   ```powershell
   mongosh "mongodb://127.0.0.1:27018/admin" --eval "rs.initiate({_id:'wareflowPhase22',members:[{_id:0,host:'127.0.0.1:27018'}]})"
   mongosh "mongodb://127.0.0.1:27018/admin" --eval "rs.status().members.map(m => ({name:m.name,stateStr:m.stateStr}))"
   ```

3. Restore only a sanitized, disposable data copy into a distinct test database. In the backend terminal, set `MONGODB_URI` for that terminal only (do not edit `.env`) to `mongodb://127.0.0.1:27018/wareflow_phase22_rehearsal?replicaSet=wareflowPhase22`. Start the backend and use test-only users/warehouses/pallets/locations from that copy.
4. **Successful movement:** call the existing receiving putaway endpoint for a received pallet and valid same-warehouse location. Confirm one pallet points at the location, its status becomes `r/p`, the location contains the pallet and updated size, and unrelated locations are unchanged.
5. **Rollback after a write failure:** on this isolated server only, enable MongoDB's `failCommand` failpoint to fail an `update` command during movement after the destination/source has been written. Submit putaway, expect an error, then query both location and pallet. Both must exactly match their pre-request state. Turn the failpoint off immediately with `configureFailPoint: "failCommand", mode: "off"`.
6. **Concurrent occupancy:** prepare two received pallets and one empty location with enough capacity for only one pallet. Submit both putaway requests concurrently. Exactly one may succeed; the other must fail/retry safely. Confirm the location has one pallet, its size equals that pallet's size, and the other pallet remains in its original state.
7. **Membership/audit atomicity:** configure the isolated server's `failCommand` failpoint to fail an `insert` into `audit_logs`, then perform a membership change. The request must fail; query `company_memberships` and confirm the role/status/warehouse assignments are unchanged. Disable the failpoint immediately. Repeat without the failpoint and confirm membership and audit row both commit.
8. Save the command output and before/after documents as rehearsal evidence. Do not point these steps at production or Atlas. Do not run `companies:migrate -- --apply` as part of this transaction test.

This procedure is a manual replica-set rehearsal, not a test result claimed by this report.

## Migration operator requirements

1. Keep the migration capped at 1,000 planned writes; do not split mappings to bypass the limit.
2. Generate and review the default dry-run from a complete real mapping and a verified backup.
3. Before `--apply`, stop external database writers (including scheduled jobs and other services), keep them stopped for the whole apply window, and provide the required explicit operator attestation. The MongoDB-backed lock separately blocks all HTTP mutations through this WareFlow backend.
4. The database lock is fail-closed on process interruption. Do not manually clear a stale lock until confirming no migration is active, checking the active request count, and reconciling the database state.
5. Use a transaction-capable deployment only after the replica-set rehearsal above and separate approval. A transaction abort is the rollback mechanism; restore the verified backup if post-apply reconciliation fails.

Example PowerShell commands (not run):

```powershell
$env:COMPANY_MIGRATION_MAP = "scripts/company-migration-map.json"
npm run companies:migrate
npm run companies:migrate -- --apply --confirm I_HAVE_VERIFIED_A_BACKUP --confirm-write-freeze I_HAVE_FROZEN_APPLICATION_WRITES
```

The second command requires a reviewed dry-run, the shared application lock, and the separate external-writer freeze described above. The phrase only records that external writers were stopped; it does not create or validate the application lock.

## Files changed for this remediation pass

- `backend/middleware/migrationWriteFreeze.js` — shared MongoDB control record, application write leases, migration lock acquisition/release, and fail-closed 503 responses.
- `backend/server.js` — registers the shared write-freeze middleware globally before route handlers.
- `backend/scripts/migrateCompanies.js` — acquires the application freeze before transaction preflight, holds through transaction cleanup, releases on success/failure, and clarifies the separate external-writer confirmation.
- `backend/routes/company.routes.js` — revalidates active Company Admin status inside membership create/update/revoke transactions.
- `backend/model/Pallets.js` — defines supported existing statuses and adds schema enum validation.
- `backend/routes/pallet.routes.js`, `backend/routes/palletCrud.routes.js` — reject unsupported status values while preserving role gates.
- `backend/test/helpers/writeFreezeTestDb.js` — deterministic test double for the MongoDB lock record.
- `backend/test/api.test.js` — adds stale-authorization tests for three membership mutation paths, status validation/role tests for pallet routes, and API freeze denial test.
- `backend/test/companyMigration.test.js` — tests write-lease contention, freeze acquisition/release, and lock cleanup on transaction failure.
- `backend/test/companyMigration.test.js` — additionally tests competing migration acquisitions and lease retention on premature HTTP response close.
- `backend/docs/architecture/PHASE_2_2_REMEDIATION_REPORT.md` and `backend/docs/architecture/PHASE_2_2_INDEPENDENT_REVIEW.md` — updated findings, environment limitation, verification, and rehearsal procedure.

No dependency or `.env` file was changed. Existing work remains in the working tree and was not staged, committed, reset, or discarded.

## Verification

From `backend/`:

```text
npm test -- --runInBand
Test Suites: 5 passed, 5 total
Tests:       93 passed, 93 total
```

From `frontend/`:

```text
npm run build
vite v8.3.8
✓ 2157 modules transformed
✓ built successfully
```

The follow-up race regressions verify that competing migration acquisitions have a single winner in the shared-lock test double, and that a premature HTTP response close does not release a lease. The middleware therefore releases only on response finish; an interrupted response requires manual reconciliation. `git diff --check` passed after implementation and report updates. Git emitted LF-to-CRLF normalization notices for existing modified files only. No MongoDB connection, migration, Atlas access, dependency update, or frontend source change was made.

## Remaining risks and recommendation

- The application-level lock covers HTTP mutations routed through this Express server and shared database only. Direct database writers and jobs outside the process require a separate operational freeze.
- Mocked tests do not establish real transaction behavior. Complete and review the local replica-set rehearsal before any migration apply.
- Over-limit company migrations remain blocked pending a separately designed and reviewed checkpointed migration.
- Existing low-priority F-05/F-06 follow-ups remain: direct/native database API coverage and browser token/CSP hardening.
- No cross-warehouse transfer workflow or invitation/acceptance lifecycle is claimed.

**Phase 2.2 recommendation:** **APPROVED FOR STAGING REHEARSAL only.** This does not approve migration apply or production rollout.

# Data Migration Strategy

## Safety position

No database migration was run for this audit. Do not use the existing `ownership:migrate` script to convert this system to SaaS: it assigns all ownerless records to one selected user and is not a company mapping tool. Never infer company ownership solely from current user ownership without an approved business rule.

## Stage A — Inventory and backup

1. Record collection names, document counts, indexes, validators, reference fields, and estimated sizes in a read-only report.
2. Take a provider-supported consistent backup/snapshot and prove restoration into isolated staging.
3. Freeze schema changes during migration window; define owner, maintenance window, communication and rollback trigger.
4. Export current User IDs, ownerId distributions, Warehouse/Location/Pallet relationships, catalog unique keys, order/ticket refs, and ownerless/orphaned counts. Treat exports as sensitive.

## Stage B — Explicit mapping

Create a reviewed mapping file outside production writes: legacy user → company; initial membership/role; warehouse → company; user → permitted warehouse(s); every owned document → company and, where applicable, warehouse. Classify ambiguous, ownerless, cross-owner reference, and duplicate records for manual resolution. A single-user workspace can map to a company only by explicit approved rule.

## Stage C — Expand schema

Add optional `companyId`/`warehouseId` fields and compatible indexes first. Deploy code that can read legacy owner-scoped records and new company-scoped records, while all new writes receive validated company scope. Prevent records with neither scope once the rollout reaches enforcement. Keep old `ownerId` until reads, reports, and rollback no longer need it.

## Stage D — Dry run and backfill

Implement an idempotent dry-run migration command that reports planned updates, rejects ambiguous mappings, samples relationships, checks unique-key collisions, and requires an explicit approved mapping artifact. Backfill in bounded batches with checkpoints and audit output. Do not delete documents or drop indexes in this stage. Test against a restored copy with production-like shape.

## Stage E — Reconcile and cut over

Compare pre/post counts by collection, company, warehouse, status, SKU, inventory quantity and movement history. Verify every reference remains within company, locations/pallets point to valid warehouses, and aggregate totals match. Run legacy and new scoped reads in shadow mode. Switch reads/writes gradually; monitor authorization denials, errors and count drift.

## Stage F — Contract and cleanup

Only after a rollback period and verified backup: make tenant fields required, enforce final unique compound indexes, remove obsolete owner-only indexes and compatibility paths in separate releases. Retain or archive legacy ownerId according to the approved audit/retention plan. Do not hard-delete operational history as a migration cleanup shortcut.

## Phase 2 migration utility

`npm run companies:migrate` is a read-only dry run by default. It requires `MONGODB_URI` and `COMPANY_MIGRATION_MAP` in the process environment. The mapping JSON must explicitly provide:

```json
{
  "companies": [{ "id": "<new-company-object-id>", "name": "Example Co", "slug": "example-co" }],
  "users": [{ "userId": "<existing-user-object-id>", "companyId": "<company-object-id>", "role": "company_admin", "assignedWarehouseIds": [] }],
  "warehouseAssignments": [{ "collection": "pallets", "recordId": "<record-object-id>", "warehouseId": "<warehouse-object-id>" }]
}
```

Every user role must be explicitly set. A legacy user may map to only one company in this utility; multi-company conversion requires a separately reviewed mapping because one old `ownerId` cannot identify which company owns a record. The report lists ownerless/unmapped records, warehouse assignment gaps, and conflicts. Resolve all of them and verify a restorable backup before applying. Only an explicit `--apply --confirm I_HAVE_VERIFIED_A_BACKUP` attempts the transaction. It preserves `ownerId` and does not delete records. Run it against a restored staging copy first; do not use this utility as an automatic startup task.

Every mapped company must have at least one verified active Company Admin before preflight can pass. A mapping counts only when it explicitly assigns `company_admin` to an existing active, non-deleted, non-Super Admin user and any pre-existing membership matches that mapping. An existing active `company_admin` membership counts only when its user account exists, is active, is not deleted, and is not a Super Admin. Other roles and inactive or mismatched membership states do not count. The condition is recalculated inside the apply transaction before writes. After all migration writes and mapped-membership checks, the transaction queries the actual Company Admin memberships and associated user accounts for every mapped company again, using the same session; if any company has no qualifying admin, the transaction aborts before commit. The migration never promotes a user automatically. Add or correct an explicit, reviewed mapping or resolve the existing membership state before retrying.

Company Admin verification is bounded: the utility requests at most 1,001 active admin memberships to check whether the configured maximum of 1,000 is exceeded. If more than 1,000 are returned, preflight records a conflict and `readyToApply` remains false. The post-write transaction check uses the same bound and aborts if the result exceeds it, so it never accepts a partial verification. Larger companies require a separately reviewed migration design; the limit must not be bypassed by truncating the check. These safeguards and mocked tests do not by themselves establish live MongoDB transaction behavior.

## Rollback

Rollback trigger examples: mismatched inventory totals, cross-company reference, unexpected access denial, elevated write errors, or failed restore validation. Stop writes or route to maintenance mode; restore snapshot or run a specifically rehearsed reverse mapping; do not attempt ad hoc reverse scripts against production. Keep migration checkpoints and immutable reports.

## Shared application write-freeze lifecycle and recovery (M-03)

The Express middleware coordinates HTTP mutation requests through the shared `wareflow_control` record. Each accepted mutation must hold a unique lease with an owner process instance, PID, host, and acquisition time. Startup Super Admin provisioning also obtains a shared lease before it can write. The active-write count must equal the number of recorded leases. A migration polls for active leases to drain for up to 30 seconds, then atomically acquires the lock only when the count and lease list are both empty; it records a unique token and owner process metadata. A competing migration lock or inconsistent state fails immediately. Normal release must match the exact lease or migration token and process owner. A quiescent legacy record with zero writes can be initialized with an empty lease/audit list; inconsistent or legacy state with a non-zero counter or unverifiable migration owner blocks both writes and migration and is never silently normalized.

There is no age-based expiry or automatic recovery. A slow live request/migration cannot be distinguished from a crashed owner by age alone. A recovery command is a separate operator action: its default mode only inspects the control record. Any apply mode must name exactly one lease or migration lock, supply an operator identity, reason, and the required owner-stopped attestation. On the same host it additionally refuses if the recorded PID is still present; for a remote owner, an operator must verify that exact process instance is stopped through the host/process supervisor. PID reuse or uncertainty fails closed. Lease recovery is allowed only when it is the sole active lease and no migration lock exists. Migration-lock recovery is allowed only with zero active writes/leases and an exact token/owner match. The state change and recovery audit entry are one atomic control-record update; concurrent attempts cannot both match the same state. Do not manually edit or delete the control record as a shortcut.

Windows PowerShell operator procedure:

1. Stop and independently verify every application instance and the exact process named by the selected lease/lock. Stop queue workers, scheduled tasks, maintenance scripts, and other services that can write the database. The application middleware cannot stop or detect direct MongoDB clients.
2. Set `WAREFLOW_RECOVERY_OPERATOR` for the named operator in the current PowerShell session and ensure `MONGODB_URI` identifies the intended database without displaying it in logs.
3. Run `npm run migration:freeze:inspect` (read-only) and record the exact lease ID or lock token, owner instance ID, host, PID, and timestamps. Investigate count/list mismatches and legacy records with missing ownership; the CLI must refuse ambiguous states.
4. Confirm the selected owner has stopped using the process supervisor on its host. For a local owner, the CLI also checks the recorded PID. Do not proceed if the process is present, its identity is uncertain, other active leases remain, or a migration may still be running.
5. Use exactly one of the following command forms, substituting values copied from the inspection output. The lock token is a recovery capability; do not paste it into a shared log or support chat.

   ```powershell
   $env:WAREFLOW_RECOVERY_OPERATOR = "Your Name / Change Ticket"
   npm run migration:freeze:recover -- --apply --lease-id "<lease-id>" --owner-instance-id "<owner-instance-id>" --reason "<ticket and process-stop evidence>" --confirm-owner-stopped I_VERIFIED_THE_EXACT_OWNER_PROCESS_IS_STOPPED
   ```

   For an abandoned migration lock, use `--lock-token "<lock-token>"` instead of `--lease-id`, keeping the exact `--owner-instance-id`. The command requires the operator name from `WAREFLOW_RECOVERY_OPERATOR` or `--operator "..."`. Recovery requires a non-empty reason and the exact owner-stopped confirmation phrase. Review the output and then re-run `npm run migration:freeze:inspect`; never use a blanket “clear all” operation.
6. Re-run inspect. Resume application instances only after the record is internally consistent and all external writers remain independently controlled. For an actual company migration, keep all non-HTTP writers stopped for the entire migration and reconciliation window.

The control record covers mutation HTTP requests that pass through this Express middleware, startup Super Admin provisioning, and migration locks acquired through the migration utility. It does not provide database-wide write exclusion. No backend queue worker or scheduled job was found in the inspected repository. Standalone `createAdmin.js`, `resetSuperAdminPassword.js`, other maintenance scripts, other services, and direct database clients do not acquire this application lock and require separate shutdown/coordination. The migration CLI's write-freeze confirmation is an operator attestation for those external writers; it is not proof that they stopped. No migration or recovery operation should be run against a live system without a verified restorable backup and an approved maintenance plan.

## Special data concerns

- Existing global unique indexes may conflict when two companies use the same SKU/code; resolve and test before tenant compound indexes.
- Existing `ownerId` may be absent or reference deleted/soft-deleted users. Quarantine and resolve rather than default to Super Admin or first user.
- Catalog `Item` and legacy `Product` have different meanings; do not merge collections based on naming.
- Embedded pallet movement logs must be exported and mapped to movement ledger events with stable event IDs and ordering; verify totals before enabling ledger-derived balances.
- Customer references in Ticket point to a collection without an observed Customer model; identify actual data source before remapping.
- Migration of a live system needs dual-write/maintenance decision; never improvise dual writes without idempotency and reconciliation.

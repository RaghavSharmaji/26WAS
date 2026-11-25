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

## Rollback

Rollback trigger examples: mismatched inventory totals, cross-company reference, unexpected access denial, elevated write errors, or failed restore validation. Stop writes or route to maintenance mode; restore snapshot or run a specifically rehearsed reverse mapping; do not attempt ad hoc reverse scripts against production. Keep migration checkpoints and immutable reports.

## Special data concerns

- Existing global unique indexes may conflict when two companies use the same SKU/code; resolve and test before tenant compound indexes.
- Existing `ownerId` may be absent or reference deleted/soft-deleted users. Quarantine and resolve rather than default to Super Admin or first user.
- Catalog `Item` and legacy `Product` have different meanings; do not merge collections based on naming.
- Embedded pallet movement logs must be exported and mapped to movement ledger events with stable event IDs and ordering; verify totals before enabling ledger-derived balances.
- Customer references in Ticket point to a collection without an observed Customer model; identify actual data source before remapping.
- Migration of a live system needs dual-write/maintenance decision; never improvise dual writes without idempotency and reconciliation.

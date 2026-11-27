# Procurement and Inventory Idempotency Index Audit

## Scope and safety

The companion script at `backend/scripts/auditProcurementIndexes.js` is a read-only audit tool. It does not load the application or `.env`, and it contains no index or document write operations. It requires the explicit `--dry-run` flag and a URI supplied in the current shell. Remote targets are refused unless `--allow-remote-readonly` is supplied. Use a database account with read-only privileges even for a remote audit. The script has not been run as part of preparing this document, and no database was contacted.

The duplicate check runs aggregation groupings and counts over the four target collections. It is read-only but can consume resources on large collections; first use it against a disposable local replica set and schedule any later staging audit during a quiet period. It returns up to 25 duplicate groups per required index as samples; `duplicateGroupSampleLimitPerIndex` and `summary.duplicateGroupSamples` make the sample bound explicit. Any sample makes the overall status `REVIEW REQUIRED`, so a capped report cannot appear clear when duplicates are found. Duplicate reports include counts, scope IDs, and a short hash fingerprint; they do not print request keys or business references.

## Required unique indexes

These are the unique indexes declared by the current Mongoose schemas. The partial filter separates company records from legacy records. `companyId: null` matches both explicit null and missing `companyId` values in MongoDB, which is how the current legacy scope is defined.

| Collection | Unique key fields, in order | Partial filter | Scope and purpose |
| --- | --- | --- | --- |
| `inventory_operations` | `{ companyId: 1, requestKey: 1 }` | `{ companyId: { $type: 'objectId' } }` | One idempotency record per company and operation-scoped key. Index name: `unique_inventory_operation_request_company`. |
| `inventory_operations` | `{ ownerId: 1, requestKey: 1 }` | `{ companyId: null }` | Legacy owner-scoped idempotency records. Index name: `unique_inventory_operation_request_legacy`. |
| `goods_receipts` | `{ companyId: 1, reference: 1 }` | `{ companyId: { $type: 'objectId' } }` | Unique GRN reference within a company. Schema-generated name: `companyId_1_reference_1`. |
| `goods_receipts` | `{ ownerId: 1, reference: 1 }` | `{ companyId: null }` | Legacy owner-scoped GRN references. Schema-generated name: `ownerId_1_reference_1`. |
| `goods_receipts` | `{ companyId: 1, requestKey: 1 }` | `{ companyId: { $type: 'objectId' } }` | One GRN idempotency record per company. Index name: `unique_grn_request`. |
| `goods_receipts` | `{ ownerId: 1, requestKey: 1 }` | `{ companyId: null }` | Legacy owner-scoped GRN idempotency. Index name: `unique_legacy_grn_request`. |
| `putaways` | `{ companyId: 1, requestKey: 1 }` | `{ companyId: { $type: 'objectId' } }` | One putaway idempotency record per company. Index name: `unique_putaway_request`. |
| `putaways` | `{ ownerId: 1, requestKey: 1 }` | `{ companyId: null }` | Legacy owner-scoped putaway idempotency. Index name: `unique_legacy_putaway_request`. |
| `purchase_orders` | `{ companyId: 1, reference: 1 }` | `{ companyId: { $type: 'objectId' } }` | Unique PO reference within a company. Schema-generated name: `companyId_1_reference_1`. |
| `purchase_orders` | `{ ownerId: 1, reference: 1 }` | `{ companyId: null }` | Legacy owner-scoped PO references. Schema-generated name: `ownerId_1_reference_1`. |

The services scope keys by operation before storage: inventory uses a prefix plus a SHA-256 digest of the client key (`stock-in`, `inventory-adjustment`, or `stock-out-batch`); GRN and putaway are stored in separate collections, so their same client key values are independent. The unique indexes enforce company scope, while the service-derived request key enforces operation scope. Do not remove either layer without a reviewed compatibility plan.

There is no declared PO idempotency-key index. PO creation uses a generated reference protected by its company/legacy reference indexes. A collision should fail as a duplicate conflict; it does not make PO create idempotent.

## Legacy index and data risks

- The legacy indexes scope uniqueness by `ownerId`; the company indexes scope it by `companyId`. A legacy row can coexist with a company row with the same key because the partial filters are disjoint. Once legacy records are assigned to a company, two owners' records with the same reference or request key can collide under the company-wide index. Resolve such records through a reviewed business decision before creating the index; do not automatically delete or rewrite them.
- An older physical `inventory_operations` index such as `{ companyId: 1, ownerId: 1, requestKey: 1 }` may remain after schema changes. It is not a substitute for the company-wide `{ companyId, requestKey }` constraint. The audit reports all current indexes; it does not drop stale indexes.
- Company IDs with non-ObjectId BSON types are outside the declared company partial indexes and are reported as scope anomalies. Investigate before rollout.
- Company or legacy rows with duplicate indexed tuples will block unique index creation. Missing `ownerId`, `requestKey`, or `reference` values can group as null/missing values under the applicable scope and can also prevent creation.
- PO and GRN generated references may already have duplicates from historical data. Inventory operations, GRNs and putaways may have duplicate idempotency entries. The script reports grouped duplicate tuples but never selects a record to keep.
- The script checks exact key order, `unique: true`, and the partial filter. A same-key index with a different uniqueness or scope is reported as mismatched. Index options not relevant to these declared definitions are shown in the existing-index inventory for human review.

## Duplicate-key behavior in the application

Inventory stock-in, adjustment and batch stock-out use transaction-bound operation records. They compare the request hash for replay versus key reuse with a different payload, and use the `11000` duplicate-key path to load an already committed operation where applicable. GRN and putaway follow the same request-hash/replay pattern in their respective collections. If a duplicate-key error does not correspond to an existing idempotency record, it is allowed to bubble to the API error handler, which maps `11000` to HTTP 409. PO reference collisions likewise surface as a conflict rather than retrying a newly generated reference. This review is source inspection only; no database behavior was exercised here.

## Manual audit steps (run only when you choose)

1. Start a disposable local MongoDB replica set and use a throwaway database. Do not use an Atlas or production URI for the first run.
2. In PowerShell, set the URI only in that terminal session. Use a read-only database user where authentication is enabled:

   ```powershell
   $env:WAREFLOW_INDEX_AUDIT_URI = "mongodb://127.0.0.1:27017/wareflow_index_audit?replicaSet=wareflowTest"
   Set-Location "C:\Users\Radhe\OneDrive\Desktop\WMS\WMS F\backend"
   node scripts/auditProcurementIndexes.js --dry-run
   ```

3. Review the JSON `target`, each collection's `indexes`, required-index status, `duplicateGroups`, and `scopeAnomalies`. Exit code `2` means review is required; exit code `1` means the audit could not safely run. The tool does not alter the database.
4. Clear the temporary environment variable when finished:

   ```powershell
   Remove-Item Env:WAREFLOW_INDEX_AUDIT_URI
   ```

The script intentionally does not read `.env`. If you later audit a remote environment, independently verify the target and use a least-privilege read-only credential; the explicit remote flag only removes the script's local-target guard and does not make a credential read-only.

## Proposed future index deployment plan (not executed)

This is a planning outline, not an instruction to run index DDL now.

1. Approve a maintenance window. Take and verify a restorable backup. Stop or drain all application writers and separately stop direct database writers. The application migration write-freeze mechanism does **not** block direct database clients or unrelated services.
2. Ensure every deployed application instance is on a version compatible with the intended indexes. Disable Mongoose automatic index creation in the production connection configuration before relying on a manual index rollout; the current server does not explicitly set `autoIndex: false`, so schema index creation behavior must be addressed and verified in a separately reviewed code/configuration change.
3. Run this read-only audit against the exact target with read-only credentials. Resolve every duplicate and scope anomaly using an approved, backed-up, record-level plan. Re-run the audit until all required index definitions are either correct or explicitly scheduled for creation and duplicate groups are clear.
4. In a separately approved deployment, create only the listed unique indexes with their exact key order, unique option, and partial filter. Preserve the legacy indexes while legacy records remain. Do not drop an older index merely because it is not in the current schema; assess compatibility and query usage first.
5. Verify with `listIndexes`, rerun this audit, run application smoke tests for idempotent replay and conflicting key reuse, then restore writers and monitor duplicate-key conflicts and latency.

No `createIndex`, `dropIndex`, or migration command is included here because index application has not been authorized.

## Local replica-set behavior tests

Use only a disposable local replica set and isolated database. Keep its URI in a temporary shell variable such as `WAREFLOW_INDEX_AUDIT_URI` or the existing test-specific variable expected by an integration suite. First run the audit tool against the empty/test database to verify it only reports state. In separately approved test work, exercise: same company/key/same payload replay; same company/key/different payload conflict; concurrent duplicate requests; the same raw key in separate operation scopes; same keys across companies; and forced failure after a stock mutation to prove transaction rollback. Assert the corresponding operation, movement, pallet, GRN/putaway, and PO state through the same local replica set. Mocked unit tests do not prove MongoDB unique-index races or transaction rollback. This audit task neither starts a database nor runs those integration tests.

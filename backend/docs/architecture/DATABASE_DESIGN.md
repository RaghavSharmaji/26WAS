# Target Database Design

Design proposal for MongoDB/Mongoose. Names are conceptual until reviewed; existing collections must be reused or migrated where semantics match. Do not create all proposed collections before the relevant phase.

## Core identity and tenancy

### User

Retain the existing user identity and password hash. Keep authentication/security fields and account status. Do not place company-wide authorization solely on User because users and companies have many-to-many membership.

### Company

`_id`, legal/display name, normalized slug, status, primary contact, locale/timezone, address, settings, created/updated timestamps. Unique normalized slug; status and timestamps indexed as needed.

### Membership

`companyId`, `userId`, role or role assignments, status, invitedBy, acceptedAt, created/updated timestamps. Unique `(companyId,userId)`. Roles distinguish Company Admin, Warehouse Manager, Staff, Auditor; use explicit permission grants only for reviewed exceptions.

### WarehouseAssignment

May be embedded in Membership for small installations or modeled separately for auditability. If separate: `companyId`, `membershipId`, `warehouseId`, permission set, effective dates/status. Validate warehouse belongs to same company.

### Subscription / Plan / Entitlement

Plan version and entitlement catalog are platform-managed; Subscription belongs to `companyId` and records provider reference, status, periods, limits, grace period, and event IDs. Never rely on client feature flags for authorization. Verify subscription webhooks and deduplicate events.

## Warehouse and master data

Every existing tenant-owned model gains required `companyId`; warehouse-bound rows gain required `warehouseId` after migration. Warehouse contains companyId and unique `(companyId, code)`. Location contains companyId and warehouseId, unique `(warehouseId, normalizedFullName)` or equivalent. Catalog `Item` remains the SKU master unless audit reveals `Product` must be merged; define field semantics first. Use tenant-scoped unique `(companyId, skuNumber)`. Category, Supplier, and new Customer records are company scoped. Supplier may be warehouse-usable within a company; avoid duplicate supplier records solely because warehouses differ unless business rules require it.

## Procurement and inbound

- `PurchaseOrder`: company, supplier, destination warehouse, number, status, expected dates, line snapshots, currency/totals, createdBy/approvedBy.
- `Receipt` (GRN): company, warehouse, purchase-order reference (optional for blind receiving), status, lines, accepted/rejected quantities, lot/serial/expiry/quality data as applicable, receiver and timestamps.
- `PutawayTask`: receipt line, source receiving area, destination location, quantity, assignment, status, idempotent completion reference.

Use immutable line snapshots or catalog references plus snapshots where historical descriptions/prices must not change.

## Inventory and ledger

- `InventoryMovement`: append-only event with companyId, warehouseId, SKU/item ref and snapshot, quantity delta, movement type, from/to location, lot/serial when applicable, source document, idempotency key, actor, reason, timestamps, correlation ID. Disallow update/delete in normal application paths; corrections use compensating movements.
- `InventoryBalance`: projection keyed by company, warehouse, item/SKU, location and lot/serial dimensions. Stores on-hand, reserved, available, in-transit and quality buckets as required. Conditional versioned updates; rebuild/reconcile from movement events.
- `InventoryReservation`: order/line, scoped stock, reserved quantity, expiry/status and idempotent release/consume transitions.
- Stock transfers are represented as a transfer document plus paired departure/receipt movements; stock remains in transit until confirmed at destination.

Existing `Pallets` and embedded `movementLog` must be mapped to this design without losing history. Keep compatibility reads until reconciliation is proven.

## Orders, shipping, and returns

- `SalesOrder` (or evolve existing `Order` only after field/status mapping): company, customer, requested ship date, lines, fulfillment warehouse(s), status, totals, idempotency reference.
- `PickTask`, `Pack`, `Shipment`, `DeliveryEvent`, `ReturnAuthorization`, `ReturnReceipt` provide explicit, auditable workflow state as rollout needs them.
- Preserve order and ticket IDs where possible. Ticket’s current customer reference must be reconciled with the absent Customer schema.

## Audit, idempotency, indexes

- Evolve `AuditLog` to include companyId (nullable only for platform events), actorId, action, resource type/id, timestamp, request/correlation ID, reason, and sanitized before/after summary. Restrict sensitive data and make append-only in service/database permissions.
- `IdempotencyRecord`: company, actor/client scope, operation, key, payload fingerprint, outcome reference, expiration/status. Unique compound key prevents duplicate processing.
- Tenant-scoped compound indexes: begin with `companyId`; add warehouse/time/status dimensions to frequent query patterns. Unique examples: `(companyId, skuNumber)`, `(companyId, code)`, `(warehouseId, locationCode)`, `(companyId, orderNumber)`.
- Review existing global and owner-scoped unique indexes before conversion. Resolve duplicates before building new indexes; do not drop old indexes until backfill/verification and rollback window are complete.

## Referential integrity rules

MongoDB does not provide foreign keys. Services and migration validation must verify that every referenced entity belongs to the same company and applicable warehouse. Reject cross-company references, orphaned membership assignments, and operations on inactive warehouses. Use transactions when multiple documents must change atomically, after confirming the production cluster supports transactions.

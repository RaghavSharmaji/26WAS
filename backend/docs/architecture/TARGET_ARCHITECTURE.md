# WareFlow Target Architecture

## Goals

Evolve the existing React + Vite, Node + Express, MongoDB + Mongoose system into a centrally hosted commercial SaaS WMS with independently isolated companies, multiple warehouses, role-controlled staff, platform administration, subscriptions, and traceable inventory operations. Preserve the current product and avoid a ground-up rewrite.

## Architecture shape

Use a **modular monolith**: one deployable API organized into domain modules. Each module owns its routes/controllers, validation, services, persistence models, and tests. Start with modules for Identity, Tenancy, Catalog, Warehouse, Procurement/Receiving, Inventory, Orders/Fulfillment, Shipping/Returns, Billing/Entitlements, Reporting, and Audit. Keep the existing Express entry point and frontend shell while moving functionality in small slices.

## Request and authorization flow

1. Authenticate the session/token and load the active user.
2. Resolve the selected company membership server-side; never accept a tenant identity as proof of access.
3. Verify the membership is active and its role allows the action.
4. Resolve warehouse scope from the membership/assignment. Company-wide users may access all company warehouses; warehouse-scoped users may access assigned warehouses only.
5. Check subscription entitlement and operational constraints.
6. Call a service with an explicit trusted scope object `{ actorId, companyId, allowedWarehouseIds, role }`.
7. Persist records with required company and warehouse scope, audit/security events, and transactions/idempotency as the operation requires.

Super Admin has a separate platform-wide authorization capability. Company Admin is scoped to one company. A user can hold distinct memberships in multiple companies if product policy supports it; active company is selected at request/session context but always revalidated server-side.

## Tenant isolation

Use a shared MongoDB database with `companyId` on every company-owned entity and `warehouseId` on warehouse-bound entities. Compound indexes and unique constraints begin with tenant scope where applicable. Services/repositories require an explicit scope parameter; do not rely solely on AsyncLocalStorage query middleware. Every direct query, populate, aggregation, update, delete, export, and background job must bind company scope. Super Admin cross-tenant reporting uses a dedicated audited path, never a general bypass flag exposed to ordinary requests.

## Modules and boundaries

- **Identity & Access:** User, authentication, sessions/tokens, memberships, roles/permissions, warehouse assignments, invitations, resets.
- **Tenancy & Billing:** Company lifecycle, plan/subscription state, usage counters, entitlements and feature gates.
- **Warehouse & Catalog:** warehouse/location hierarchy, SKU catalog, categories, suppliers, customers, units of measure.
- **Procurement & Receiving:** purchase orders, expected receipts, receiving sessions, discrepancy/quality decisions, putaway tasks.
- **Inventory:** stock balances/projections, lots/serials as required, reservations, immutable movement ledger, adjustments and reconciliation.
- **Fulfillment:** customer orders, allocation, picking, packing, shipping, delivery confirmation, returns and disposition.
- **Reporting & Audit:** scoped read models/aggregations, operational reports, security/admin audit events.

Modules can share MongoDB within the monolith, but one module should own write rules for its domain. Avoid duplicating existing collections while migration is in progress.

## Inventory consistency

Treat movement events as the source of truth for stock-changing facts; expose a current-balance projection for fast reads. A movement is append-only at service and database privilege layers. Corrections are compensating events with actor, reason, reference, timestamp, company, warehouse, SKU/lot and quantity. Use MongoDB transactions for operations that span documents and require all-or-nothing semantics; ensure the production deployment supports transactions. Use conditional updates/version checks for hot balance rows and unique idempotency keys for retried external/client commands. Define reservation and in-transit states before accepting orders/transfers.

## Transactions and idempotency

Use idempotency keys on commands likely to be retried (receiving confirmation, allocation, shipment confirmation, return receipt, payment/subscription webhooks). Persist key + request fingerprint + result within tenant scope. Use transactions for multi-document inventory/order state transitions where partial completion is invalid. Keep external integrations outside long transactions and use an outbox/retry strategy if introduced.

## Frontend

Keep React/Vite and the current WareFlow design. Add a tenant/warehouse context provider populated from authorized API data, route guards for navigation quality, permission-aware action display, and clear active company/warehouse context. These UI checks complement backend enforcement and are not security controls. Keep Super Admin routes separate and visibly distinguish platform operations from company impersonation/read-only support view. Select one canonical frontend directory before deploying; current repository contains duplicate copies.

## Deployment and operations

Keep configuration in environment/secret storage, with validated startup configuration. Add structured request IDs/logging, health/readiness endpoints, metrics and alerting, database backup/restore procedures, migration controls, and deployment rollback. Pin supported Node and package versions after compatibility verification. Apply least-privilege database credentials and separate development/staging/production secrets.

## Design constraints

- No tenant or role is trusted from a client-supplied ID or JWT claim without database-backed authorization.
- Every owned record has `companyId`; warehouse-bound records also have a validated `warehouseId`.
- Super Admin actions and cross-company views are audited.
- Tenant/warehouse scope is carried through jobs, exports, reports, and background work.
- No new model replaces an existing model until semantic overlap and migration mapping are documented.

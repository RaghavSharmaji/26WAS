# WareFlow Current System Audit

**Audit scope:** repository source and configuration inspection, read-only. No application code, environment configuration, or database was changed for this audit. Tests were inspected but not rerun in this audit pass.

## Executive summary

WareFlow is an existing single-user-owner WMS built as a React/Vite client and Express/Mongoose API. It already has authentication, per-user data ownership, a Super Admin view, catalog and warehouse setup, pallet stock operations, simple order/ticket workflows, reports, and tests. These are useful foundations. It is not yet a commercial multi-company SaaS: there is no Company, Membership, warehouse assignment, subscription, entitlement, or durable workflow model. Current isolation is primarily by `ownerId`, not `companyId`, and the operational inventory model is pallet-centric with mutable embedded movement history.

The repository needs staged evolution, not a replacement. Highest priority before commercial use is establishing company and warehouse scope in backend authorization, addressing legacy routes that bypass newer role conventions, and planning data migration from user ownership without assigning existing data blindly.

## Repository and runtime layout

- The workspace contains sibling `backend/` and `frontend/` directories.
- The Git repository root is `backend/`; it also contains a `frontend/` tree. The two frontend copies were observed to match for source/config files (excluding generated/dependency/environment files). This duplication creates uncertainty about which copy is deployed and reviewed.
- Backend: CommonJS Node.js, Express 4, Mongoose 6.13.8, MongoDB, JWT, bcryptjs. Backend package declares Node `>=18`.
- Frontend: React 19, Vite 8, Axios, React Router 7 is installed but the app primarily switches views through `App.jsx` state rather than a router.
- Backend scripts include `start`, `dev`, admin seeding/reset, ownership migration, and Jest tests.
- `server.js` loads dotenv before reading configuration, validates `MONGODB_URI`, `SECRET_OR_KEY`, and port, connects to MongoDB, provisions the configured Super Admin, and then listens. CORS defaults to local Vite origins and can be configured through `CORS_ORIGINS`.

## Backend structure

- `model/`: `User`, `Item`, `Product`, `Pallets`, `Order`, `Ticket`, `Category`, `Supplier`, `Warehouse`, `Location`, `AuditLog`.
- `routes/`: authentication, admin, inventory, product/item, pallet, receiving, orders, picker, tickets, category, supplier, warehouse, location, report, web scraping; includes generic CRUD factory and overlapping legacy/new route families.
- `middleware/`: auth, error handler, async handler, request context, ownership plugin.
- `services/`: inventory service.
- `scripts/`: Super Admin provisioning and password reset, admin seeding, user-ownership migration.
- `test/`: API, inventory service, item cleanup tests.

## Authentication, roles, and administration

- JWT Bearer auth is supported, with legacy `x-auth-token` compatibility. Auth looks up the user record on requests; current database role/status is used rather than trusting a role field from the token. Inactive/deleted accounts are rejected. JWT lifetime is seven days.
- Registration creates a normal `staff` user; Super Admin provisioning is backend environment-driven and separate from public registration. Passwords use bcryptjs. Existing Super Admin password is not reset on every start; a dedicated reset script exists.
- Roles currently are `superadmin`, `admin`, and `staff`. `admin` means a user-level admin, not a company tenant admin. There are no warehouse-scoped membership assignments or permission records.
- `/api/admin` is mounted behind auth and `requireRole('superadmin')`; its routes expose platform summaries, users, user-specific data/dashboard, monitoring, activity and audit data. These are single-user-owner admin functions, not tenant/company administration.
- There is no Company Admin lifecycle, tenant onboarding, subscription enforcement, or controlled warehouse delegation.
- Client token storage uses `localStorage`, exposing bearer tokens to script injection if an XSS flaw is introduced. No refresh/revocation or password reset workflow was found in the inspected auth routes.

## Data models and current ownership

Business records use `ownerId` referencing users, with a Mongoose ownership plugin that applies user scoping through request context to common query operations, assigns ownership on saves/inserts, and adds an owner match to aggregates. The Super Admin role bypasses this scope. This provides a useful per-user baseline but does not represent shared company data or warehouse membership.

Notable model semantics and gaps:

- `Item` is the product catalog stored in collection `items`; `Product` is a separate legacy fulfillment/picked-quantity model in collection `products`. Similar names can confuse API and reporting semantics.
- `Pallets` holds stock quantities, location/SKU data, and an embedded `movementLog`; it is the closest current inventory representation.
- `Order` and `Ticket` support basic sales/picking concepts. `Ticket` references a `customers` collection, but no Customer model was found.
- `Warehouse`, `Location`, `Category`, and `Supplier` support setup data.
- No explicit `Company`, membership/role assignment, `Customer`, purchase order, receipt/GRN, transfer, reservation, shipment, delivery, return, plan/subscription, or entitlement model was found.
- Ownership is not consistently modeled by `warehouseId`; location/pallet links and ownership need reconciliation before warehouse authorization can be enforced.

## APIs and workflow functionality

`server.js` mounts newer plural APIs (`/api/products`, `/api/items` alias, `/api/pallets`, `/api/inventory`, `/api/warehouses`, `/api/locations`, `/api/reports`) and legacy singular APIs (`/api/item`, `/api/pallet`, `/api/location`, `/api/order`, `/api/receiving`, `/api/ticket`, `/api/picker`). Some routes overlap in purpose and contracts.

Existing capabilities include registration/login/current user/password change/logout, catalog and master-data CRUD, pallet CRUD, stock-in/stock-out/adjustment and movement/report endpoints, simple order creation/status/submit, receiving-related operations, picker/ticket operations, and Super Admin monitoring.

Gaps or defects observed during inspection:

- `order.routes.js` has simple status updates without an explicit transition state machine; the submit handler contains a reference to misspelled/undefined `palletAvilaval` and can fail at runtime.
- `picker.routes.js` `/done` refers to `Orders` without an observed import; ticket fields used in picker logic do not match the inspected Ticket schema (`items`/`palletsCont`).
- Some legacy route catches serialize an error with a success-shaped HTTP 200 response; API behavior is inconsistent.
- Legacy item/location/ticket deletions delete by business key or ID and have less explicit validation/safeguarding than newer CRUD routes. The legacy pallet delete does check positive stock and movement history, but newer route protection and role checks are inconsistent across endpoint families.
- Receiving and ticket loops can mutate stock across multiple records without a multi-document transaction; a later failure may leave partial changes.
- Several route handlers use direct model operations, so ownership safety depends on the plugin being attached to every relevant model/operation and request context remaining correct.

## Inventory and concurrency

`InventoryService` uses a conditional update/CAS pattern on a pallet and version/available quantity to prevent negative stock for a single operation, with bounded retry behavior. This is reusable. Receiving can add a pallet with a movement entry. Reports aggregate available quantity by SKU and identify low stock using catalog reorder level.

The embedded movement log is mutable along with the pallet and is not an immutable ledger. There is no reservation/available-to-promise lifecycle, multi-pallet atomic fulfillment, transfer in-transit state, lot/serial/expiry/quality status, idempotency key, or reconciliation process. These should be introduced incrementally and preserve legacy views during migration.

## Frontend structure and pages

- `src/App.jsx` owns auth/session bootstrap, navigation, and page selection; it branches for Super Admin and normal user views.
- Normal-user sections include dashboard, products, inventory, orders, categories, suppliers, warehouses, locations, reports, and settings.
- Additional screens/components are in `src/pages/` and assets in `src/assets/`.
- Super Admin UI supports user-level monitoring and account administration. It is not yet company-centric.
- Product/category/supplier/warehouse/location/report pages call backend APIs and are reusable. Settings profile/warehouse/notification values are local state and save only changes local UI state; they are not persisted.
- The dashboard uses live API summary data but includes an “Active Orders” placeholder/unavailable display. A product status render path appears to access `product.status.toLowerCase()` even though the mapped product shape may omit `status`; verify/fix when frontend regression testing begins.
- No company selector, warehouse context, subscription/plan UI, or warehouse-role-aware menus exist.

## Security observations (prioritized)

1. **Tenant boundary absent:** current user owner scope is not a company scope. A naïve `companyId` field addition is insufficient without authorization checks on every query and relationship.
2. **Route coverage:** some newer plural routes are mounted without an explicit `auth` at mount site; inspect their internals and ensure every action is authenticated and correctly scoped. Legacy mutations have inconsistent explicit role checks.
3. **Implicit ownership plugin limits:** query middleware is easy to omit or bypass in new models, bulk/replace/distinct operations, raw collection access, population, or aggregation edge cases. A tenant security boundary must be explicit and tested.
4. **Client token storage:** `localStorage` is exposed to XSS. CSP and secure session/token strategy need a design decision before production.
5. **Authentication hardening:** rate limits, lockout/abuse controls, refresh/revocation, secure reset flows and email verification were not found in the inspected route set.
6. **Operational audit:** audit log exists, but coverage/immutability/tenant scope are incomplete; Mixed detail payloads can grow or hold sensitive data unless restricted.
7. **Inventory integrity:** mutable embedded history and partial multi-record operations weaken auditability and consistency.
8. **Data deletion:** route-level deletes and user soft deletion need explicit retention/cascade policies and audit records before supporting commercial tenant deletion.

This is a code audit, not a penetration test. Findings should be verified with focused tests before production claims.

## Existing tests and verification status

Jest/Supertest tests are present for API authentication/role behavior and sanitization, registration role, CRUD conflict handling, temporary password behavior, one-pallet inventory CAS/no-negative/retry behavior, and item cleanup. The previous audit reported 3 suites and 26 tests passing, but this current document-authoring pass did not rerun them. Existing tests use model mocks in parts and do not establish MongoDB-backed multi-tenant isolation, warehouse access, full route coverage, transaction rollback, idempotency, or end-to-end UI behavior.

## Dependency and compatibility notes

Backend versions observed: Express 4.16 range, dotenv 7 range, Mongoose 6.13.8, Puppeteer 2.1.1, Nodemon 2.0.2, Jest 30. Frontend observed: React 19, Vite 8, Axios 1.21.1, React Router 7. Do not upgrade wholesale during architecture work. Before any upgrade, capture lockfile/Node versions, run dependency and build/test compatibility checks, and update one dependency group at a time. Puppeteer 2.1.1 is particularly old relative to modern Chromium/Node environments and warrants checking whether it is still needed and supported by the deployed runtime. No dependency update is proposed by this audit.

## Ownership migration prerequisites

An existing `scripts/migrateOwnership.js` can assign ownerless records to one email-selected user and create owner-scoped indexes. That utility is a legacy single-owner migration, not a multi-company migration. It must not be run for SaaS tenant conversion. Before any migration: identify every record’s real company and warehouse from business records; export/backup; classify ambiguous or orphaned rows; define mapping and rollback; test on a restored copy; reconcile counts and relationships; only then schedule production migration.

## Audit conclusion

Reuse the existing application shell, authentication foundations, catalog/master-data pages, pallet inventory service, reports, and Super Admin UI. Improve and modularize the API without changing the overall stack. Implement company membership, warehouse assignments, entitlement checks, explicit scoped service access, workflow entities, immutable movement events, and migration safeguards in dependency order described in the companion roadmap.

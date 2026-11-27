# WareFlow Canonical Role and Permission Matrix

**Policy baseline:** Phase 3 approved product policy and Milestone 2 decisions recorded on 2026-11-26. This document defines the intended authorization policy and its current-route mapping. Existing role data was not migrated.

## Canonical roles

| Canonical role | Authority boundary |
| --- | --- |
| `super_admin` | Platform administration APIs only. No ordinary company or warehouse permissions. Any support access must be a separate, audited, least-privilege workflow. |
| `company_admin` | Full administration and operations for the active company only; all company-owned warehouses. Never another company. |
| `warehouse_manager` | Operational and warehouse-management permissions, restricted to every warehouse explicitly assigned to the active membership. A transfer requires authority at both ends. |
| `warehouse_staff` | Only assigned operational task permissions, restricted to explicitly assigned warehouses. No direct adjustments or company/master-data administration by default. |
| `auditor` | Read-only access to company/warehouse data explicitly authorized for that membership. No mutation permission. |

The canonical identifiers above are policy identifiers. Current persistence is not yet consistent: `User.role` supports canonical `super_admin`, legacy `superadmin`, `admin`, or `staff`, while `CompanyMembership.role` stores underscore roles plus legacy roles. At the authentication/authorization boundary, `superadmin` is normalized to `super_admin`; both spellings receive the same platform-only policy. Existing stored values are preserved, and no migration or rewrite is permitted for this compatibility change. New Super Admin provisioning uses `super_admin`. See `PHASE_3_ROLE_COMPATIBILITY.md`.

## Canonical permission catalog

The following permission identifiers are the Phase 3 target. Existing identifiers that are semantically equivalent should be reused/adapted at one compatibility boundary, not maintained as a second independent permission system.

| Domain | Permission IDs |
| --- | --- |
| Company | `company.read`, `company.update`, `company.settings.manage` |
| Membership | `membership.read`, `membership.create`, `membership.update`, `membership.revoke`, `membership.assign_warehouse` |
| Warehouse | `warehouse.read`, `warehouse.create`, `warehouse.update`, `warehouse.delete` |
| Inventory | `inventory.read`, `inventory.create`, `inventory.update`, `inventory.adjust`, `inventory.delete` |
| Receiving | `receiving.read`, `receiving.create`, `receiving.update`, `receiving.complete` |
| Putaway | `putaway.read`, `putaway.create`, `putaway.update` |
| Pallet | `pallet.read`, `pallet.create`, `pallet.update`, `pallet.move` |
| Location | `location.read`, `location.create`, `location.update` |
| Order | `order.read`, `order.create`, `order.update`, `order.cancel` |
| Picking | `picking.read`, `picking.execute` |
| Packing | `packing.read`, `packing.execute` |
| Shipping | `shipping.read`, `shipping.execute` |
| Transfer | `transfer.read`, `transfer.create`, `transfer.approve`, `transfer.execute` |
| Return | `return.read`, `return.create`, `return.process` |
| Reporting and audit | `report.read`, `audit.read` |

The current application also has catalog-specific permissions such as `products.view`, `categories.view`, and `suppliers.view`. Keep these existing IDs at the compatibility boundary for current routes. Warehouse Managers and Warehouse Staff may read company-wide catalog/product reference data required by assigned-warehouse tasks, always within their active company. This does not grant access to another company's catalog or any catalog mutation. Inventory quantities and warehouse-specific stock remain limited to assigned warehouses. Catalog mutations require separate explicit grants.

### Existing catalog permissions retained at the compatibility boundary

These identifiers are already used by the mounted catalog routes and do not have an exact identifier in the new permission catalog. Keep the current operation names until a single, tested compatibility mapping is implemented:

| Existing permission family | Company Admin | Warehouse Manager | Warehouse Staff | Auditor | Current resource scope |
| --- | --- | --- | --- | --- | --- |
| `products.view/create/update/delete` | All company products | Company-wide read for assigned work; no master edits | Company-wide read for assigned work; no master edits | Read if authorized | Company/legacy owner scope. Company-wide read is limited to active company. |
| `categories.view/create/update/delete` | All company categories | Company-wide read for assigned work; no master edits | Company-wide read for assigned work; no master edits | Read if authorized | Company/legacy owner scope. |
| `suppliers.view/create/update/delete` | All company suppliers | Read only where needed for receiving; no master edits | Read only where needed for assigned tasks; no master edits | Read if authorized | Company/legacy owner scope. |
| `customers.view` | Own-company customer access where route exists | No customer management grant | No customer management grant | Read if authorized | No customer API was found. |
| `purchaseOrders.view/create/update/approve` | Own-company access where routes exist | No grant until workflow route/approval semantics are mapped | No grant | Read if authorized | No purchase-order route was found. |

The catalog matrix preserves existing exact permission names and company boundaries. Warehouse roles may read company-wide reference data, while warehouse-stock resources remain restricted by assignments.

## Target grants

`R` = read; `W` = explicitly listed write/execute permissions. All grants remain subject to active membership, active company, ownership, and warehouse scope. Permissions not granted below are denied by default.

| Capability | `super_admin` | `company_admin` | `warehouse_manager` | `warehouse_staff` | `auditor` |
| --- | --- | --- | --- | --- | --- |
| Platform settings, plans, cross-company metrics | Platform API only, audited | — | — | — | — |
| Company profile/settings | Platform API only, audited | Full own-company set | `company.read` only if needed for operational context; no settings management | No settings management | Read only within authorized company; data redaction policy pending |
| Memberships and warehouse assignments | Platform-only support workflow, separately audited | Full own-company membership set | — | — | Read-only only if membership data is explicitly authorized; field redaction policy pending |
| Warehouses | Platform-only support workflow, separately audited | Full own-company warehouse set | Read/update assigned warehouses; no create/delete until explicit destructive-operation policy | Read assigned warehouses for tasks | Read assigned warehouses |
| Locations | Platform-only support workflow, separately audited | Full own-company location set | Read/create/update within assigned warehouses | Read/use assigned locations; no configuration writes | Read assigned locations |
| Inventory and pallets | Platform-only support workflow, separately audited | Full own-company inventory set | Read/create/update/adjust, create/update/move pallets in assigned warehouses | Read and receive/putaway task writes only; no adjust/delete | Read assigned warehouse scope |
| Receiving and putaway | Platform-only support workflow, separately audited | Full own-company set | Read/create/update/complete assigned-warehouse work | Read and execute assigned receiving/putaway tasks | Read assigned warehouse scope |
| Orders and fulfillment | Platform-only support workflow, separately audited | Full own-company set | Read/update and execute pick/pack/ship in assigned warehouses | Read assigned work and execute pick/pack/ship tasks | Read assigned warehouse scope |
| Transfers | Platform-only support workflow, separately audited | Full own-company set | Read/create only after source/destination route mapping; both warehouses must be assigned | No authority to approve or execute until workflow policy is explicit | Read authorized scope |
| Returns | Platform-only support workflow, separately audited | Full own-company set | Read/create/process within assigned warehouses | Read/receive assigned return tasks only | Read assigned warehouse scope |
| Reports and audit | Platform reports/logs only, audited | Full own-company reporting and audit access | Assigned warehouse reports; no audit access by default | Operational task views only | Read-only authorized reports and audit data |

### Exact Company Admin set

Company Admin receives every canonical permission listed above **within the active company**, including membership administration and warehouse assignment. The enforcement code must enumerate this set explicitly; `['*']` is prohibited because it could authorize future platform or unknown permissions. Company Admin never receives Super Admin platform permissions.

### Warehouse Manager and Staff execution constraints

- A Warehouse Manager/Staff membership must include one or more valid `assignedWarehouseIds`. A selected warehouse is a selector, never an authorization grant.
- Every warehouse-specific target record and reference must belong to the same company and to an assigned warehouse. A transfer requires authorization for both source and destination.
- Staff writes are limited to the receiving, putaway, pallet movement, order task, picking, packing, shipping, and return-receipt steps already represented by existing workflows. No inventory adjustment, delete, membership, company settings, or master-data write is granted by default.
- A user with several assignments may act in any assigned warehouse. Removing an assignment or revoking membership must deny the next request. Current frontend selection is optional and does not narrow the server-side assignment set.
- Warehouse Manager adjustment grants and delete permissions require a business reason where the existing workflow does not establish a safe rule. Until that is decided, adjustment is allowed only where the existing adjustment endpoint's validation/audit contract is met; warehouse, inventory, and pallet deletion remain Company Admin-only.

## Fail-closed route-mapping items

The current route map does not yet support every permission above. No permission should be inferred from a similar route name:

| Existing operation / permission | Target permission candidate | Status |
| --- | --- | --- |
| `/api/inventory/stock-in`, existing `inventory.receive` | `inventory.create` | Clear stock-in/create equivalence; route-level role test required. |
| `/api/inventory/stock-out`, existing `inventory.issue` | `inventory.update` | Candidate only; confirm whether stock issue is a separate operational task or general update before mapping. |
| `/api/inventory/adjust`, existing `inventory.adjust` | `inventory.adjust` | Same operation; reason/approval requirements must follow the existing service contract. |
| Receiving `/create`, `/valedation`, `/send`, `/dynamicsend` | `receiving.create/complete`, `putaway.create/update`, `pallet.move` | Not one-to-one; map each handler and state transition before enforcement changes. |
| Pallet status versus location update | `pallet.update` versus `pallet.move` | Existing guards distinguish these; preserve that distinction. |
| `/api/order/create` | `orders.create` | Creates an order record. Company Admin only unless another explicit grant is approved. |
| `/api/order/submit` | None | Current handler reads an order and returns derived fields; it does not approve or persist submission. It references an undefined `palletAvilaval`, so the operation is broken/ambiguous and must remain fail-closed. Do not add `order.submit` absent a distinct submission action. |
| `PUT /api/order/:id/status` | `orders.update` | Changes an existing order's status among the handler's four accepted values. This is a status update, not an approval. Map only to roles with explicit `orders.update`; no approval workflow is inferred. |
| Existing `transfers.create/update` | `transfer.create/approve/execute` | No transfer route/service exists; do not substitute update for approve/execute. |
| Existing `returns.receive/update` | `return.create/process` | No returns route exists; exact lifecycle mapping remains unimplemented. |
| Existing `auditLogs.view` | `audit.read` | Platform audit endpoint exists under `/api/admin`; no tenant audit endpoint exists. Keep platform and tenant audit scopes separate. |
| Existing `users.view`, `roles.view`, company settings view | `membership.read`, `company.read`, `company.settings.manage` | No complete tenant user/role/settings API exists. Protect only after endpoint semantics and redaction are specified. |

Any operation without a reviewed mapping must fail closed. Missing transfer, procurement, customer, returns, and tenant audit APIs are not to be created incidentally as part of this permission audit.

## Enforcement invariants

- Backend permissions, company context, warehouse assignment, and resource relationships are mandatory on every sensitive request; frontend checks only control visibility and navigation.
- Tenant IDs come from authenticated identity plus verified active membership. Client-supplied company/warehouse IDs are selectors and are verified server-side.
- Super Admin platform APIs remain separate from company operational APIs. No Super Admin wildcard or implicit tenant impersonation.
- Auditors have no mutation permission. Their reads are scoped to explicitly authorized company/warehouse records.
- Membership role and warehouse-assignment grants require non-empty audit reasons and atomic membership/audit writes.
- Legacy role values remain stored until a separately reviewed migration. Unknown or ambiguous legacy grants fail closed for unsupported canonical operations.

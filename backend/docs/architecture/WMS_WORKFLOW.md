# WMS Operational Workflow

This describes the target business lifecycle. Current implementation covers only pieces of these flows; rollout should activate one tested slice at a time.

## 1. Company and warehouse setup

Platform creates or approves Company and subscription. Company Admin invites users and assigns roles/warehouses. Company Admin or delegated manager configures warehouses, receiving/staging/pick/pack/ship/return locations, SKU catalog, suppliers, customers, units and reorder rules. All records are company scoped; warehouse resources are additionally validated against their company.

## 2. Procurement and receiving

1. Create a purchase order against a supplier, destination warehouse, and line quantities/costs.
2. Submit/approve according to company policy; snapshot supplier and item data.
3. Start a receipt against the PO or an allowed blind receipt.
4. Scan/enter SKU, quantity, lot/serial/expiry and condition; record short/over/damaged discrepancies.
5. Confirm receipt once using an idempotency key. In one transaction, record receipt state, append stock movement(s), update balance projection, and create putaway work.
6. Putaway validates destination location capacity and warehouse scope; completion moves stock from receiving to storage location.

No received quantity is counted twice on retry. Discrepancies and adjustments require actor and reason.

## 3. Inventory control

Balances expose on-hand, reserved, available, in-transit, damaged/quarantined as enabled. Every stock change is represented by an immutable movement with source, destination, actor, timestamp, reason, and reference. Cycle counts produce variance proposals; approval policy controls adjustment events. Reconciliation compares the balance projection with ledger-derived quantities and flags divergence.

## 4. Transfers

Create transfer between warehouses within one company; validate source and destination access/capacity. Reserve or stage quantity, record departure movement and mark in-transit atomically. Destination receipt confirms quantity/condition and records arrival movement. Short, damaged, and rejected transfer quantities follow exception disposition. A transfer cannot be edited into a different company or warehouse after posting; corrections are compensating events.

## 5. Customer order to delivery

1. Create and validate order/customer/lines and requested date.
2. Allocate from eligible warehouse inventory; reserve quantities atomically and prevent oversell.
3. Generate warehouse-scoped pick tasks; staff can act only on assigned/authorized warehouse work.
4. Confirm picked quantities and exceptions; reservation transitions to picked stock.
5. Pack and label; capture package/weight/carrier data as features permit.
6. Ship once with idempotency, create shipment and inventory departure movement; order status advances through allowed transitions.
7. Track delivery proof/events and close the order.

No single endpoint should mark a multi-line order complete before all required line quantities and stock transitions succeed.

## 6. Returns

Authorize or record a return against order/shipment when policy allows. Receive returned units into a designated return/quarantine location. Inspect condition; disposition as restockable, damaged, repair, or disposal. Restock only through a movement that records source return area and destination. Refund/accounting integration is outside the current codebase and requires a separate decision.

## 7. User and platform administration

Company Admin administers only company users and settings. Warehouse managers execute delegated site operations. Super Admin handles platform lifecycle and audited support access. Support “view as user/company” is read-only by default and never changes the authenticated identity or silently broadens mutation authority. Administrative mutations record actor, target, reason, and result.

## State and failure rules

- Define allowed state transitions and actor permissions before exposing each workflow.
- Commands are idempotent under client/network retry.
- Multi-document state changes use transactions or an explicit recoverable saga; partial completion must be visible and repairable.
- Background jobs revalidate company, warehouse, membership, and subscription status at execution time.
- Maintain operational audit history; do not delete movement history to correct mistakes.

# WareFlow User Guide

This guide describes workflows present in the current source tree. Screens and available actions depend on the signed-in account's effective permissions and warehouse assignments. The backend enforces those permissions even when a screen or control is visible.

## Sign in and select a company

1. Open the root `frontend/` development URL and sign in with your WareFlow account.
2. A normal user with one active company membership is taken into that company. If the user has multiple active memberships, select the company first.
3. A company created in WareFlow starts in `pending` status. Its Company Admin cannot select it for operations until a Super Admin reviews and activates it. Activation records a reason in the audit log.
4. Select an assigned warehouse when the page or task requires warehouse scope. Switching company or warehouse refreshes the active context; server-side membership and assignment checks remain authoritative.

## Company and team administration

Company Admins can use the company and employee settings provided by their permissions to review memberships, assign supported roles and warehouses, and manage explicit permission overrides. Membership changes require an audit reason and expected revision. The last active Company Admin cannot be removed or downgraded. Invitations by email are not part of the current implementation; membership creation selects an existing active WareFlow account.

## Product and inventory setup

1. Create or select a catalog product with a unique SKU.
2. Create a warehouse and its locations before putaway.
3. Use the Inventory page to review available and quarantined stock and movement history.
4. Manual stock changes require the appropriate permission, a reason, and an idempotency key. Use a distinct key for each intentional operation; retrying the same request with the same key replays its stored result.
5. For received goods, use the purchase order and receiving workflow instead of direct stock changes. Do not use a manual adjustment as a substitute for a receipt.

## Purchase to receiving

1. A user with procurement permissions creates a purchase order for an existing supplier, products, ordered quantities, and destination warehouse.
2. Submit the purchase order before receiving against it.
3. In Receiving, choose an eligible purchase order and record quantities delivered. Partial receipts are supported; a receipt does not directly mark the ordered balance as received beyond validated outstanding quantities.
4. Record inspection accepted/rejected quantities and a reason. Rejected/damaged/incorrect goods are represented as quarantined inventory and are not available for fulfillment.
5. Put accepted quantities into valid locations. Putaway moves stock from receiving to a location and must not be counted as an additional receipt.
6. Review the GRN history, inventory balances, and movement reports.

## Customer orders and fulfillment

1. Create or select a customer and create an order for a warehouse.
2. Submit the order, then reserve available quantities.
3. Assign a picker when permitted and confirm actual picked quantities. Short-picked quantities are released according to the order workflow.
4. Pack picked goods into packages.
5. Dispatch the order to create a shipment and record the dispatch stock movement. Dispatch is the physical stock deduction point in the modern workflow.
6. Confirm delivery on the shipment/order. Delivery confirmation records delivery details and does not deduct stock a second time.
7. Cancel only when the current order state permits it; the service releases eligible reserved/picked quantity and records movements.

## Reports and audit history

The reports page reads API data scoped to the active tenant/warehouse context. Received totals represent GRN receipt events plus valid manual stock-in; internal putaway is excluded. Shipped totals represent dispatch deductions only; reservation and picking are not shipments. Super Admin monitoring is platform-level and is separate from operational company access.

Some report and activity fields are event-oriented, and not every operational change currently produces a user-facing audit-log row. Consult [Known Limitations](WAREFLOW_KNOWN_LIMITATIONS.md) before presenting a report as a complete compliance ledger.


# WareFlow 10–15 Minute Demonstration Guide

This is a prepared walkthrough, not a seed-data script. No automated demo seeding is configured in the repository. Prepare a disposable local database and accounts before the evaluation; never use real customer data or the production database.

## Before the demonstration

- Start a local MongoDB replica set and verify it is `PRIMARY`; transaction workflows will fail on a standalone server.
- Configure `backend/.env` privately and start the backend and root Vite frontend.
- Confirm `/api/health` returns HTTP 200.
- Provision a Super Admin through the backend environment and verify its login without displaying its password.
- Prepare one pending company and one normal Company Admin account. Ensure the Super Admin account is not also a company operator.
- Prepare a test Company Admin, a Procurement Manager, a Warehouse Manager, Warehouse Staff, Inventory Manager, and Auditor through existing account/membership administration. Assign warehouse-scoped roles only to the demo warehouse.
- Create a warehouse with enough valid locations, one supplier, one laptop SKU, and a customer. Prepare a purchase order / customer order only if creation time is too long for the live slot.
- Use a disposable company and clearly fictional data. Do not create sample records in a real company.

## Script (about 12 minutes)

| Time | Action | What to explain |
| --- | --- | --- |
| 0:00–1:00 | Sign in as Super Admin and open Companies. Review the pending company and activate it with a reason. | New tenants are pending until platform review. Activation is an audited platform action; it does not grant the Super Admin operational membership. |
| 1:00–2:00 | Sign in as the Company Admin and select the activated company. Show the company and warehouse context. | The server verifies active membership, company status, and selected warehouse. |
| 2:00–3:00 | Show Team and role/warehouse assignments; return as a role with procurement access. | Effective permission overrides and assigned warehouses are enforced by the API. The Auditor is read-only. |
| 3:00–4:30 | Open Purchase Orders; create a PO for 100 units of the laptop SKU and submit it. | A PO records demand and does not increase inventory. |
| 4:30–6:00 | In Receiving, record 100 delivered; inspect 96 accepted and 4 rejected, with a reason. | The GRN tracks actual receipt; rejected stock is quarantined and not eligible for reservation. |
| 6:00–7:00 | Put away 96 accepted units into a valid location. Open Inventory and movements. | Putaway changes location/state; it is not a second receipt. Show the receipt and putaway movements. |
| 7:00–8:00 | Sign in as an authorized order user; create a customer order for 20 units and submit/reserve it. | Reservation reduces available stock but does not remove physical stock. |
| 8:00–9:30 | Assign a picker, confirm 20 picked, and pack the quantity. | Picking transfers reserved quantity to picked; packing is not a physical deduction. |
| 9:30–10:30 | Dispatch and show the shipment. | Dispatch performs the physical deduction once; the idempotent operation prevents a repeated request from deducting twice. |
| 10:30–11:00 | Confirm delivery. | Delivery records confirmation and does not deduct stock again. |
| 11:00–12:00 | Review inventory, movement report, quarantine quantity, then show an Auditor view and a denied unauthorized action. | Explain how the role matrix, tenant scope, and warehouse assignments constrain access. |
| 12:00–13:00 | Return to Super Admin and show company-wide user summaries and audit activity. | Super Admin has platform visibility through platform APIs, not ordinary company operations. |

## Expected quantities for the walkthrough

For the stated one-product scenario (receive 100, accept 96, reject 4, put away 96, reserve/pick/pack/dispatch 20, then confirm delivery), the intended figures are 76 available units and 4 rejected/quarantined units. Validate the displayed fields against the current data model before the event: the application separately tracks on-hand, available, and quarantined quantities, and the full numerical scenario has not been verified end-to-end against MongoDB in this checkout.

## Fallbacks

- If local transactions fail, stop the workflow demonstration; do not switch to an Atlas/production URI or alter the data to force success.
- If company activation is unavailable, stop and verify Super Admin access and the pending company state before the event. Do not manually edit MongoDB as a live-demo workaround.
- If an optional capability is absent, identify it as deferred rather than presenting a mock screen or invented workflow.


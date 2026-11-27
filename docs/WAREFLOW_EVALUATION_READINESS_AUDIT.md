# WareFlow Evaluation Readiness Audit

> **Follow-up status update — 2026-11-27:** The initial audit snapshot below is retained as historical evidence and several findings in it have since been addressed in the current working tree. Current code inspection confirms a Super Admin company listing/activation API with required reason, transaction-time Super Admin revalidation, atomic activation audit record, and a Companies review/activate UI; API tests cover activation, denial, pending selection, and post-activation selection. The root `frontend/src/pages/OtherPages.jsx` Hooks-order lint error, movement report type handling, and Super Admin company-summary ownership-scope findings are also no longer present as reported: current `npm run lint` exits 0, `movementReport.js` maps receipt/dispatch semantics, and `adminUserScope.js` resolves active memberships and scopes by company ID while retaining only explicitly legacy owner rows. Current verification on this date: backend **14 suites passed / 2 skipped; 273 tests passed / 13 skipped / 0 failed**; frontend lint **passed with warnings**; production build **passed**; `git diff --check` **passed**. The integration suites were skipped because the test URI variables were absent and no local MongoDB process/listener was active on port 27018. No database was contacted, and modern procurement/outbound transaction behavior and the complete numerical lifecycle remain unverified. See [test report](WAREFLOW_TEST_REPORT.md) and [known limitations](WAREFLOW_KNOWN_LIMITATIONS.md) for current detail. Do not use the historical initial status or test counts below as current results.

**Assessment date:** 2026-11-26  
**Scope:** Read-only inspection of the current working tree, safe local backend tests, frontend lint and production build. No database connection, migration, source-code change, or environment-file change was performed. The only file created for this audit is this report. Existing uncommitted changes were preserved.

## Overall readiness: NOT READY

The repository has substantial working WMS functionality and the frontend production build and mocked backend suite pass. It is not ready for an unqualified live evaluation yet. A new company is created in `pending` status, but there is no company-activation route or UI; the same user is then prevented from selecting that company. A fresh evaluator cannot onboard a usable tenant through the application. The frontend lint command also fails on a Hooks ordering violation. Further, tests do not establish current end-to-end behavior against a real database, and the documented local MongoDB URI does not explain the replica-set requirement for transaction workflows.

An evaluation can be staged with an already active company and a transaction-capable database, but that requires prior setup outside the ordinary new-company UI flow. This audit does not establish that the running application can authenticate or complete workflows against any database.

## Audit approach and repository state

- Reviewed the current source in `backend/server.js`, backend middleware, routes, services, models and tests; frontend entry points, API client, dashboard and workflow pages; and architecture/configuration documents.
- Inspected the current Git status. The working tree contains many pre-existing modified and untracked files. None were reset, staged, committed, or discarded.
- Ran the backend test suite, frontend lint, frontend production build, and `git diff --check`.
- Did not read or expose `backend/.env`; confirmed that safe example files exist.
- Did not contact MongoDB, Atlas, staging, or production. The two opt-in integration suites were skipped because their dedicated local test URI variables were not configured for this run.

## Prioritized findings

### F-01 — New companies cannot become operational through the application

**Severity: Critical for a fresh evaluation setup**  
**Files/functions:** `backend/routes/company.routes.js`, `POST /api/companies` and `POST /api/companies/:companyId/select`; `backend/routes/admin.routes.js`; `frontend/src/App.jsx`, `handleCreateCompany` and company selection; `frontend/src/pages/SuperAdminDashboard.jsx`.

**Evidence:** `POST /api/companies` creates the company with `status: 'pending'` and an active Company Admin membership. The company selection handler rejects every non-active company and returns `COMPANY_PENDING` for pending companies. No company activation/update handler exists in the company routes or the Super Admin admin routes, and the Super Admin dashboard has no company approval section. The frontend company creation flow attempts to select the just-created company, which is rejected by that backend check.

**Impact:** A new evaluator can register, create a company, and then become stuck outside the operational workspace. A preconfigured active company can avoid this during a prepared demo, but the onboarding path itself is incomplete.

**Recommended fix:** Add a narrowly scoped, audited Super Admin company activation/suspension endpoint and UI, with transaction-time actor revalidation and an audit reason. Until then, document a safe, controlled pre-demo tenant provisioning procedure; do not silently set newly created companies active.

**Existing test coverage:** Backend tests cover company and membership authorization, but this audit found no test demonstrating the complete company-create → platform-activation → select path. This finding is based on the mounted route implementation, not solely on tests.

### F-02 — Frontend lint fails on conditional React Hooks

**Severity: High**  
**File/function:** `frontend/src/pages/OtherPages.jsx`, `OtherPages({ activePage, permissions })`.

**Evidence:** The component returns `<ReportsPage />` at line 86 before its subsequent `useState`, `useCallback`, and `useEffect` calls. `npm run lint` reports multiple `react-hooks(rules-of-hooks)` errors for those hooks (lines 88–115) and exits with code 1. The Vite production build passes because it does not enforce this lint rule.

**Impact:** This violates React's hook-order requirement. The current parent usually keys page components by page, which may reduce exposure on current transitions, but the component remains invalid if its props change while mounted or it is reused differently.

**Recommended fix:** Split Reports into a separate page component or make hook invocation unconditional before rendering branches, then require lint to pass in the evaluation checklist.

**Existing test coverage:** No frontend test suite is configured in `frontend/package.json`; lint is the direct failing verification.

### F-03 — Default local MongoDB example does not communicate transaction requirement

**Severity: High for local live demonstrations; conditional on database topology**  
**Files/functions:** `backend/.env.example`; `backend/services/procurementService.js`; `backend/services/outboundService.js`; `backend/routes/ticket.routes.js` and other transaction-backed services.

**Evidence:** The example URI is `mongodb://127.0.0.1:27017/wms_f`, described as local MongoDB Community Server, with no replica-set query option or setup note. The purchase-to-receiving and outbound services use MongoDB sessions/transactions. A standalone local MongoDB instance does not support multi-document transactions; Atlas deployments use replica-set topology, and a local replica set was used for earlier opt-in integration verification.

**Impact:** Following the example literally with a standalone local server can allow initial connection but cause transaction-backed workflow actions to fail at runtime. This can break a live receiving or order demo even when the API starts.

**Recommended fix:** Document and verify a local single-node replica-set setup (including `rs.initiate()` and a replica-set URI), or clearly instruct evaluators to use a transaction-capable Atlas/dev deployment. Do not imply that the plain standalone example is sufficient for the full WMS.

**Existing test coverage:** Mock tests exercise service behavior. The local replica-set membership suite was historically verified as documented in Phase 3 records, but this audit run did not execute it. The live ticket suite is also opt-in and skipped this run. This does not establish real procurement/outbound transaction behavior.

### F-04 — Reports undercount receiving and outbound movement categories

**Severity: Medium**  
**Files/functions:** `backend/routes/report.routes.js`, `GET /api/reports/summary`; `frontend/src/pages/OtherPages.jsx`, `ReportsPage`.

**Evidence:** The movement model allows `receipt`, `quarantine`, `putaway`, `reserve`, `pick`, `release`, and `dispatch` in addition to `stock-in`, `stock-out`, and `adjustment`. The summary endpoint returns `stockIn` only from `byType['stock-in']` and `stockOut` only from `byType['stock-out']`; the UI labels those values “Stock received” and “Stock shipped”. New GRN receipts and outbound dispatches use the newer movement types, so they are not included in those displayed figures.

**Impact:** A live demo can show correct current balance while movement cards claim zero or incomplete received/shipped activity. The label can mislead evaluators about data completeness.

**Recommended fix:** Aggregate documented movement types into receipt/shipment lifecycle totals, or label the figures as legacy manual stock-in/stock-out. Add tests with receipt and dispatch movements.

**Existing test coverage:** Inventory service and balance tests cover movement behavior, but there is no verified report-summary test for the newer movement types.

### F-05 — Per-user Super Admin statistics are not company-wide tenant statistics

**Severity: Medium**  
**Files/functions:** `backend/routes/admin.routes.js`, `userStatsForIds`, `userReport`, `GET /users/:id/data/:resource`, `GET /users/:id/dashboard`.

**Evidence:** These views filter operational models by `ownerId` (the record creator/legacy owner). In the shared-database multi-tenant design, operational records are company-owned via `companyId` and may be created by multiple members. The global monitoring endpoints use global queries, while the per-user views use owner-only filters.

**Impact:** Super Admin user detail pages can undercount or omit warehouse data belonging to the selected user's company when other employees created the records. The values are not a reliable measure of that user's whole company.

**Recommended fix:** Decide whether the product means “records created by this user” or “all records in their company”. Label creator counts accordingly; for company operations, resolve active memberships and aggregate by authorized `companyId` with a clear company selector. Keep platform APIs separate from operational APIs.

**Existing test coverage:** The audit did not find coverage proving that records created by two members of the same company are correctly represented in the Super Admin detail view.

### F-06 — Broad end-to-end and role-matrix behavior is not verified against a live database

**Severity: Medium**  
**Files/tests:** `backend/test/outboundService.test.js`, `backend/test/procurementService.test.js`, `backend/test/api.test.js`, `backend/test/membershipTransaction.integration.test.js`, `backend/test/ticketFulfillment.integration.test.js`.

**Evidence:** The outbound and procurement service suites use test doubles/mocks for database operations. The membership and ticket replica-set suites are opt-in via `WAREFLOW_M3_TEST_URI` and `WAREFLOW_TICKET_TEST_URI`. Both suites were skipped in this audit run. The historical local membership replica-set result covers four membership transaction scenarios, not the full purchase-to-receiving and sales-to-delivery workflows.

**Impact:** Passing mocked tests does not establish MongoDB session propagation, transaction rollback, uniqueness/index behavior, or concurrent stock correctness for every current workflow. This is a verification limitation rather than proof of a current defect.

**Recommended fix:** Before the live demo, run the applicable integration suites against a disposable, explicitly loopback-only MongoDB replica set. Add replica-set integration coverage for complete GRN → inspection → putaway and order → reserve → pick → pack → dispatch → delivery, including rollback and duplicate/concurrent requests. Do not point these tests at Atlas or production.

**Existing test coverage:** 236 backend tests passed, including mock-based route/service coverage; 13 tests were skipped, including two opt-in suites. The exact result is below.

### F-07 — Migration safety depends on operational coordination beyond the app lock

**Severity: Medium / Informational operational limitation**  
**Files:** `backend/middleware/migrationWriteFreeze.js`; `backend/scripts/migrateCompanies.js`; `backend/docs/architecture/MIGRATION_STRATEGY.md`.

**Evidence:** The migration write-freeze middleware is mounted before the API route families in `backend/server.js` and uses a MongoDB-backed control lease to coordinate application instances. Architecture documentation explicitly excludes external/direct database writers from this mechanism and records recovery/lease limitations.

**Impact:** The app-level lock cannot prevent a script, Compass user, or other service from writing directly to MongoDB during a migration. It is not a database-wide write freeze.

**Recommended fix:** For any future real migration, follow the documented maintenance procedure: stop or fence every external writer, back up and verify restore, inspect lock state, then rehearse against a restored copy. This is not a request to run a migration during this evaluation audit.

**Existing test coverage:** Mock tests cover migration preflight and safeguards; no migration was run, and no live database lock behavior was tested here.

### F-08 — Frontend token is stored in localStorage

**Severity: Low / Medium security hardening**  
**File:** `frontend/src/api.js`, request interceptor.

**Evidence:** The request interceptor reads the JWT from `localStorage` key `wms.auth.token` and sends it as a bearer token. Local storage is accessible to JavaScript executing in the origin.

**Impact:** If an XSS vulnerability is introduced, an attacker could read a still-valid bearer token. This audit did not identify or demonstrate an XSS exploit.

**Recommended fix:** Consider moving session credentials to Secure, HttpOnly, SameSite cookies with CSRF protection, or retain bearer storage only with a documented threat decision and robust XSS controls/CSP.

**Existing test coverage:** No browser security or frontend auth-storage tests were found.

### F-09 — Duplicate frontend tree and stale setup documentation can confuse evaluation

**Severity: Low**  
**Files:** root `frontend/`; duplicate `backend/frontend/`; root/backend README files; `backend/package.json`.

**Evidence:** The actual documented frontend at root `frontend/` has its own Vite package scripts and is the one whose build passed. A second `backend/frontend/` tree also exists. Backend package scripts include `ownership:migrate:disabled`, while older README instructions refer to `npm run ownership:migrate`; architecture documents describe the more recent company/warehouse architecture and explicitly defer migration work.

**Impact:** An evaluator can edit, run, or build the wrong frontend copy or follow stale role/migration instructions.

**Recommended fix:** Declare root `frontend/` canonical, mark or remove the duplicate only after a deliberate review, and update READMEs to current scripts, role names, database topology requirements, and safe demo seed/setup instructions.

**Existing test coverage:** The root frontend build passes; no check confirms the two frontends remain in sync.

## Authentication, authorization, and tenant boundaries

### Functionality verified by source inspection

- `backend/middleware/auth.js` verifies signed JWTs, reloads the User on each authenticated request, rejects missing/inactive/deleted users, and enforces `mustChangePassword` route restrictions.
- `backend/middleware/roleCompatibility.js` centralizes canonical Super Admin compatibility for `super_admin` and stored legacy `superadmin` values.
- `backend/server.js` mounts `auth`, `tenantContext({ blockPending: true })`, and `authorizeOperationalRequest()` before the company operational route families. `/api/admin` is separately guarded by Super Admin role middleware.
- `backend/middleware/permissions.js` defines role grants, permission overrides, route-to-permission mapping, explicit deny handling, and fail-closed behavior for unmapped mutations; it rejects Super Admin from ordinary operational API requests.
- `backend/middleware/tenantContext.js` derives company scope from authenticated identity and verified membership, and checks the selected/assigned warehouse. `backend/middleware/ownershipPlugin.js` adds company and warehouse scope to supported Mongoose query/aggregation paths and injects trusted ownership fields on supported creates.
- `backend/routes/company.routes.js` implements membership creation, role and warehouse assignment changes, revocation/reactivation, transaction-time actor revalidation, revision checks, last-active-admin protection and transaction-scoped audit writes.
- The frontend sends active company/warehouse headers, but these headers are context selectors only; the backend derives and checks effective access. `frontend/src/App.jsx` includes request cancellation/context-reset behavior on switching, based on source inspection.

### Limitations of that verification

This is not proof that every route/role combination is safe in a live deployment. Mongoose plugins do not control direct collection calls or raw operations; the route/service must explicitly scope those. Backend tests cover selected routes and tenant cases, not a complete seven-role × every mutation matrix. The frontend has no automated interaction test suite. This audit does not claim the database, indexes, session expiry, or production topology are correct.

## Workflow coverage assessment

| Workflow | Source implementation observed | Verification status / limitation |
| --- | --- | --- |
| Company and warehouse membership | Company and membership routes, transaction/audit logic, frontend selectors/settings | Code and mocked route tests; activation of pending companies is missing; no full browser flow tested. |
| Purchase orders | `backend/services/procurementService.js`, `backend/routes/purchaseOrder.routes.js`, `frontend/src/pages/PurchaseOrders.jsx` | Draft/submission/receipt-related implementation exists; mock tests pass. No current live DB transaction verification for procurement. |
| Goods receiving and inspection | `backend/routes/grn.routes.js`, procurement service, `GoodsReceipt` model, `frontend/src/pages/Receiving.jsx` | Partial receipts, quality quantities, and quarantine code exist; actual transaction behavior not established in this audit. |
| Putaway and locations | Procurement service, `Putaway` and `Location` models, Receiving UI | Code exists; mock checks do not prove concurrent location-capacity enforcement against MongoDB. |
| Inventory adjustments and movements | `backend/services/inventoryService.js`, inventory routes and UI, pallet movement log and inventory operation records | Idempotency and tenant checks have unit/API coverage. Report movement totals omit newer workflow types; full ledger reconciliation not established. |
| Sales order to delivery | `backend/services/outboundService.js`, customer/order/shipment routes, `frontend/src/pages/Orders.jsx` | Create, reserve, pick, pack, dispatch, delivery, cancellation and idempotency logic exist. Tests use mocks; this audit did not run live transaction tests. |
| Transfers and returns | No complete transfer or returns route/service workflow was found; architecture docs also list these as deferred | Not implemented as end-to-end workflows; do not include them in a promised live demonstration. |
| Super Admin monitoring | `/api/admin` routes and separate dashboard | Global monitoring exists, but per-user resource views filter by ownerId and can omit other members' company-created records. No company activation workflow. |

## Dashboard, API and user-experience notes

- Main dashboard cards mostly consume `/api/reports/summary` and operational data loaded from APIs. This is code-backed, but live data accuracy depends on tenant scopes and movement-type aggregation. Super Admin global reports use all-tenant aggregates; per-user data is a separate owner-scoped view.
- The navigation is permission-aware at the frontend and routes switch page components. This improves usability but is not an authorization boundary; API middleware remains essential.
- Loading/error/empty states are present in the newer Inventory, Orders, Receiving, Purchase Orders and management pages. Browser-level interaction, responsive layout, and keyboard/accessibility behavior were not verified.
- `frontend/src/api.js` targets `VITE_API_URL` and defaults to `http://127.0.0.1:5000`; backend CORS defaults to localhost/127.0.0.1 port 5173. This matches the default Vite local setup. A non-default frontend host requires adding its exact origin to backend `CORS_ORIGINS`.
- Do not assume all buttons are functional just because the production bundle builds. No browser smoke test was performed. No transfer/return page/workflow is evidenced as complete.

## Startup configuration and safe demonstration commands

Environment templates inspected:

- `backend/.env.example`: `MONGODB_URI`, `SECRET_OR_KEY`, `SUPER_ADMIN_NAME`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`; optional `PORT`, `CORS_ORIGINS`, and seed-admin variables.
- `frontend/.env.example`: optional public `VITE_API_URL`, defaulting to `http://127.0.0.1:5000` in code.

Create a private `backend/.env` from the example, enter only credentials you control, and do not commit it. For full receiving and fulfillment demos, use Atlas or a local MongoDB replica set because those workflows use transactions. Do not use a production database for an evaluation demo. Ensure the database user has least-privilege access, the current developer IP is allowed if using Atlas, and the database is reachable before running the app. A new company created in the UI remains pending until an activation mechanism exists, so prepare an already active demo company through an approved setup path.

Start backend in one PowerShell terminal:

```powershell
cd "C:\Users\Radhe\OneDrive\Desktop\WMS\WMS F\backend"
npm run dev
```

Start frontend in a second PowerShell terminal:

```powershell
cd "C:\Users\Radhe\OneDrive\Desktop\WMS\WMS F\frontend"
npm run dev
```

Open the local Vite URL printed by the frontend (normally `http://localhost:5173`). Sign in with a provisioned account, select an active company and an authorized warehouse. The audit deliberately did not execute these commands because doing so would initiate a database connection, which was prohibited.

## Suggested 10-minute demonstration sequence

Use only prepared, non-production demo data in an active company and a transaction-capable database.

1. **0:00–1:00 — Sign in and scope:** sign in as a Company Admin; show company and warehouse selectors, then confirm the selected workspace.
2. **1:00–2:00 — Catalog and supplier:** show existing product/SKU and supplier reference records; create one only if the demo account has permission and the data is disposable.
3. **2:00–3:00 — Purchase order:** create and submit a small PO to the selected warehouse; explain that the PO itself does not add stock.
4. **3:00–4:30 — Receiving:** receive only part of the PO quantity and show the GRN/reference. Demonstrate retry behavior only if configured to safely reuse the same request key.
5. **4:30–5:30 — Inspection and quarantine:** split received quantity into accepted/rejected, record the reason, and show rejected stock excluded from available inventory.
6. **5:30–6:30 — Putaway:** put accepted stock into a valid location; show the stock movement and available quantity.
7. **6:30–8:30 — Customer order fulfillment:** create an order, reserve, pick, pack, dispatch, then show delivered status. Show that stock decreases at dispatch and not again at delivery.
8. **8:30–9:30 — Authorization:** show a read-only Auditor view or an assigned-warehouse restriction, and verify denied operations using the UI/API test account. Do not attempt cross-tenant writes against valuable data.
9. **9:30–10:00 — Reports and audit:** show current stock and recent movement history, while explaining that current summary movement cards need the F-04 correction before treating them as complete receipt/dispatch totals.

Avoid demonstrating company registration as a successful completed flow until F-01 is resolved. Transfers and returns should be explicitly described as deferred.

## Test and build results from this audit

Commands run locally; no database URI was supplied to either opt-in integration suite:

- Backend, from `backend/`: `npm test -- --runInBand` — **12 suites passed, 2 suites skipped, 236 tests passed, 13 skipped, 0 failed (249 total)**. The skipped suites are `membershipTransaction.integration.test.js` and `ticketFulfillment.integration.test.js`, gated by `WAREFLOW_M3_TEST_URI` and `WAREFLOW_TICKET_TEST_URI` respectively.
- Frontend, from `frontend/`: `npm run build` — **passed**, Vite 8.3.8 transformed 2,161 modules and emitted the production bundle.
- Frontend, from `frontend/`: `npm run lint` — **failed** with conditional-hook errors in `OtherPages.jsx`; additional warning-level hook dependency and set-state-in-effect findings were reported.
- `git diff --check` — **passed**; Git printed existing LF-to-CRLF working-copy notices, not whitespace errors.

Mock tests do not verify transaction semantics. Historical project documentation records a successful disposable local replica-set run for four membership transaction tests, but that is not a result of this audit run and does not cover procurement/outbound workflows. Backend startup, login, API-to-database integration, Atlas configuration, and a browser demonstration were not executed because this audit was prohibited from connecting to any database.

## Prioritized fix list (impact × effort)

1. **Close company onboarding:** implement audited Super Admin activation, then add tests for create → activate → select (high impact, moderate effort).
2. **Fix lint failure:** split Reports into a distinct component or make hook ordering unconditional; require `npm run lint` to pass (high impact, low effort).
3. **Prove demo database workflows:** run procurement and outbound transaction suites on a disposable local replica set; add missing receipt/putaway/order lifecycle integration cases (high impact, moderate effort).
4. **Correct movement reporting:** include receipt and dispatch lifecycle movement types or change labels to match the legacy types (medium impact, low effort).
5. **Clarify Super Admin statistics:** distinguish record creator totals from company-wide totals and scope the latter by company membership (medium impact, moderate effort).
6. **Make setup docs reproducible:** declare the canonical frontend, update stale scripts/role instructions, and document replica-set setup and active demo tenant preparation (medium impact, low effort).
7. **Plan session hardening and operational controls:** document/decide token storage and runbook requirements for external database writers before migrations (lower immediate demo impact; higher production relevance).

## Five most important findings

1. A new pending company cannot be activated from the app, so fresh onboarding stops before warehouse operations.
2. Frontend lint fails because `OtherPages` calls hooks after a conditional return.
3. The local MongoDB example does not describe replica-set setup, while core workflows require transactions.
4. Reports label legacy movement types as total received/shipped even though GRN and dispatch use different movement types.
5. Super Admin per-user summaries use creator `ownerId`, which can omit data owned by the user's wider company.

**Fix first:** implement a minimal, audited Super Admin company activation path and an end-to-end test. It is the direct blocker preventing a newly created tenant from being used in a live evaluation.

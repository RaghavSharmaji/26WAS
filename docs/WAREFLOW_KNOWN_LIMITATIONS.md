# WareFlow Known Limitations and Deferred Work

This list reflects the current repository source and the verification run on 2026-11-27. A missing feature is not represented as a completed workflow.

## Verification limitations

- No live database connection was made during the readiness run. Although the MongoDB executables are installed, no process/listener was running on the dedicated test port; service inspection was blocked by Windows permissions. The user must start a disposable local replica set in accordance with the setup guide before live transaction tests.
- Membership and legacy ticket transaction integration suites are opt-in and were skipped in the current run. There is no replica-set integration suite for modern procurement or outbound workflows. Mock tests cannot establish transaction commit/rollback, duplicate-key races, session propagation, or final database balance consistency.
- The requested 100-unit receiving through delivery scenario was not executed. The displayed balance and ledger have not been cross-checked against real database state.
- Frontend lint exits successfully but emits warnings about effects, hook dependencies, and an empty destructuring pattern. The frontend has no automated test script.
- The development package range is Node 18 or newer; current verification used Node 25.7.0. The project does not declare a tested MongoDB Server compatibility range. The earlier recorded MongoDB 9.0.4 local run is historical and only covered membership transactions.
- The backend README contains a prior npm-install advisory count (48 advisories, including critical/high); that historical count was not independently refreshed during this task. Dependencies were not changed. Recheck dependency advisories and plan upgrades before any public deployment.

## Product capabilities to treat as deferred or limited

- Stock transfers: no dedicated modern transfer route/service workflow was identified; do not demonstrate it as implemented.
- Customer returns: no returns route/model/workflow was identified.
- Subscription plans, billing and payments: not implemented as a usable SaaS billing workflow.
- Email invitations: membership creation operates on existing active accounts; no invitation delivery flow is present.
- Support tickets and advanced analytics: not verified as working product modules.
- Report export: do not promise a downloadable/export workflow unless one is added and tested; the current reports are API-backed views. The Super Admin Global Reports navigation now explicitly says detailed platform-wide report exports are unavailable; its Overview remains the platform metrics page.
- Cycle count and reconciliation: no complete verified end-to-end workflow was established in this readiness pass.
- Legacy singular routes are retained for compatibility alongside newer route families. A route-by-route deprecation plan has not been completed.

## Security/operational risks to disclose

- JWTs are stored in browser localStorage. This is a known XSS token-exposure risk; moving to HttpOnly cookies needs a coordinated CSRF/session design, so it was not changed as part of this readiness pass.
- The app-level migration write-freeze coordinates app instances only. Direct MongoDB/Compass scripts and unrelated services require separate operational write controls.
- Index audit tooling is read-only and was not run against a database in this task. Required physical index state is therefore unverified. The deployment plan notes Mongoose index auto-creation must be reviewed before a controlled rollout.
- The project contains a legacy duplicate `backend/frontend/` tree. Use the root `frontend/` as canonical; the duplicate was not removed.
- No demo seed script exists. Prepare fictional disposable-company records manually before evaluation.

## Staging/live-demo gate

Before a live workflow demo, start and health-check a disposable local replica set, run the two existing opt-in suites, and arrange dedicated integration coverage for PO/GRN, putaway, inventory idempotency, and modern outbound. Stop the demonstration if those transaction tests fail. Never use an Atlas or production URI to bypass the local setup.


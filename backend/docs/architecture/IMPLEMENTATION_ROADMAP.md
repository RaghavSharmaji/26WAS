# Implementation Roadmap

Phases are gated: complete and verify each phase before advancing. This is a plan only; no implementation is authorized by this audit deliverable.

## Phase 0 — Baseline and release safety

**Work:** choose canonical frontend location; capture Node/npm/MongoDB versions and lockfiles; inventory API consumers; baseline build/tests; add reproducible local/staging configuration guidance; define backup/restore and release rollback.

**Dependencies:** none.

**Verification:** clean install/build/test baseline; record current route contracts; restore a backup in isolated staging.

**Definition of done:** source-of-truth layout agreed; baseline CI and rollback evidence available; no environment secret committed.

## Phase 1 — Architecture and data ownership design

**Work:** approve target models, role matrix, migration mapping, workflow state machines, subscription entitlements, canonical API transition plan.

**Dependencies:** Phase 0 inventory.

**Verification:** stakeholder review; threat model and data mapping signed off.

**Definition of done:** no ambiguous ownership/role rules; every proposed collection maps to existing or justified new functionality.

## Phase 2 — Security and API baseline hardening

**Work:** audit each mounted route for authentication, validation, role checks and ownership scope; consolidate error/status behavior; rate limiting and auth lifecycle design; audit log coverage; fix confirmed route defects, including order submit and picker completion, with tests.

**Dependencies:** Phase 0; fixes should preserve API contracts or include adapters.

**Verification:** route-by-route authorization matrix, negative IDOR tests, input fuzz/validation tests, regression suite.

**Definition of done:** no unauthenticated tenant endpoint or untested privileged mutation; consistent safe errors; regressions pass.

## Phase 3 — Tenant and membership foundation

**Work:** Company, Membership, invitations, active company context, warehouse assignments, Company Admin and operational permissions; explicit scoped service/repository pattern. Keep ownerId compatibility temporarily.

**Dependencies:** approved Phase 1 policy and Phase 2 security baseline.

**Verification:** multiple-company membership tests; every endpoint cross-company/cross-warehouse access tests; inactive membership revocation tests.

**Definition of done:** new company flows work; no client-controlled company or warehouse ID grants access; tenant audit events are scoped.

## Phase 4 — Migration tooling and tenant-scoped master data

**Work:** non-destructive dry-run mapping/backfill for existing users/data; add companyId and warehouseId where appropriate; tenant compound indexes; convert catalog/master-data CRUD and frontend context.

**Dependencies:** Phase 3 schema and approved mapping/backup.

**Verification:** dry-run reports, migration on restored production-like backup, row/relationship/count reconciliation, duplicate-index preflight, rollback rehearsal.

**Definition of done:** all migrated records have reviewed tenant scope; old queries and new scoped queries agree; no orphan/cross-company relation.

## Phase 5 — Inventory ledger, balances, and receiving

**Work:** append-only movement service, balance projection, reservations/quality buckets as policy requires; receiving/putaway; compatibility adapters for pallet-based UI.

**Dependencies:** Phase 4 tenant data and confirmed transaction-capable MongoDB deployment.

**Verification:** concurrent stock tests, duplicate retries, transaction rollback, ledger-to-balance reconciliation, tenant/warehouse access negatives.

**Definition of done:** all inventory changes produce a traceable movement; no negative/duplicated stock under retry/concurrency; discrepancies are auditable.

## Phase 6 — Procurement, transfers, fulfillment, shipping, returns

**Work:** staged workflow modules and explicit state transitions; purchase orders, receipts, transfers, order allocation, pick/pack/ship/delivery, returns/disposition.

**Dependencies:** Phase 5 inventory primitives, Phase 3 permissions, entitlement policy.

**Verification:** workflow state/property tests; idempotent commands; failure injection and transaction/saga recovery; E2E warehouse role scenarios.

**Definition of done:** complete operational lifecycle works with audited stock deltas and enforced warehouse authorization.

## Phase 7 — Subscription and entitlements

**Work:** plan definitions/versioning, company subscription lifecycle, limits/feature gates, verified provider webhook handling or documented manual billing integration.

**Dependencies:** Phase 3 companies; plan model approved. May build in parallel with Phase 5 only after interfaces are agreed.

**Verification:** entitlement boundary tests, webhook signature/replay tests, grace/suspension scenarios.

**Definition of done:** backend gates all paid capabilities/limits; frontend reflects current entitlements without being trusted for enforcement.

## Phase 8 — Platform administration and reporting

**Work:** company-level Super Admin views, subscription/system metrics, audited support view, global activity and reports; remove user-only assumptions from current admin screens.

**Dependencies:** Phases 3–7 data contracts.

**Verification:** Super Admin vs Company Admin separation, support-view expiry/audit, aggregation tenant correctness and pagination limits.

**Definition of done:** platform admin can monitor/manage companies while tenant admins remain confined to their company.

## Phase 9 — Production readiness and controlled rollout

**Work:** performance/index tuning, security review, backup/restore, observability, deployment secrets, retention policy, load test, staged migration, canary/rollback.

**Dependencies:** all production functionality and migration gates.

**Verification:** restore drill, load/error budget, security review, end-to-end regression, data reconciliation and launch checklist.

**Definition of done:** documented operational ownership, measurable alerts, tested rollback, no unresolved critical/high security or data-integrity issues.

## Critical dependency chain

Baseline & API inventory → authorization baseline → Company/Membership/warehouse grants → reviewed migration → tenant-scoped master data → immutable inventory and receiving → operational workflows. Subscription gates depend on Company/Entitlement interfaces. Platform-wide administration and reports depend on tenant data contracts. Production migration is last and requires backup restore plus rollback rehearsal.

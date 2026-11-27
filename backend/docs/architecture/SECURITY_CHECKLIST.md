# Security Checklist

Use this as a phase gate. Status reflects the audit snapshot: **Not verified** means source inspection alone did not establish the control or it does not yet exist as a tenant-aware control. This is not a penetration test.

## Identity and authentication

- [ ] Passwords stored only as secure hashes; hash parameters reviewed and upgrade path available.
- [ ] Login, registration, reset, invitation, and verification inputs validated and rate limited.
- [ ] Secure password reset tokens are one-time, short-lived, and never logged.
- [ ] Session/token expiry, refresh, revocation, logout and password-change behavior tested.
- [ ] Account status and membership status checked on privileged requests.
- [ ] Secrets loaded from environment/secret manager, excluded from Git and logs; rotation procedure documented.
- [ ] No public route permits self-assignment of Super Admin, Company Admin, or arbitrary roles.

## Tenant and warehouse authorization

- [ ] Every tenant-owned record has validated `companyId`.
- [ ] Every warehouse-bound operation checks that warehouse belongs to active company and is assigned to actor.
- [ ] Cross-company IDs fail safely on reads, updates, deletes, exports and aggregates (IDOR tests).
- [ ] Company/warehouse scope comes from server-verified membership, not request body or client role claim.
- [ ] All plural, singular, legacy, admin, job, export and report routes are inventoried and covered.
- [ ] Populate/aggregate/raw collection/bulk-write paths preserve scope.
- [ ] Super Admin bypass is isolated, explicit, audited and unavailable to tenant roles.
- [ ] Support-view context is short-lived, read-only by default, visible and audited.

## Authorization and input handling

- [ ] Permission matrix is enforced in backend services for each action.
- [ ] State transitions validate prior state, actor permission, company, warehouse and subscription entitlement.
- [ ] Input schemas reject unexpected fields, privilege fields and invalid identifiers.
- [ ] Search/sort/filter fields are allow-listed; page size and aggregation cost are bounded.
- [ ] Errors do not leak secrets, hashes, database internals or stack traces.
- [ ] CORS allowlist, security headers, content limits and request timeouts are configured per environment.

## Inventory and audit integrity

- [ ] All stock changes append immutable movement records; corrections are compensating events.
- [ ] Concurrent updates cannot oversell or make balance negative.
- [ ] Idempotency protects receiving, allocation, transfer, shipment, return and webhook retries.
- [ ] Multi-document operations use transactions or tested recoverable workflows.
- [ ] Balance projection is reconciled against ledger and discrepancies alert.
- [ ] Audit records capture actor, scope, action, target, reason, time and request correlation.
- [ ] Audit and movement history cannot be edited/deleted by normal application roles.
- [ ] Sensitive data is excluded or redacted from audit details and logs.

## Data lifecycle and operations

- [ ] User/company deactivation revokes access and prevents background-job execution.
- [ ] Delete/cancel/retention policies preserve legal and operational history.
- [ ] Database account uses least privilege; network access and TLS are configured.
- [ ] Backups are encrypted, retention controlled, and restore drills are proven.
- [ ] Migration has dry run, explicit mapping, reconciliation, checkpoints, rollback and approval.
- [ ] Production secrets differ from development; rotation does not require source changes.
- [ ] Dependency lockfiles, vulnerability review and supported Node/MongoDB versions are maintained.
- [ ] Monitoring detects auth failures, tenant denials, inventory drift, transaction failures and unusual admin access.

## Verification required before commercial launch

1. Automated authorization tests for every API operation, including cross-company and cross-warehouse attempts.
2. MongoDB integration tests against a transaction-capable replica set and concurrent stock workloads.
3. UI E2E tests for company switching, warehouse scope, Company Admin and operational roles.
4. Security review of auth/session lifecycle, XSS/CSRF posture, CORS/headers, dependency risks and Super Admin support paths.
5. Restore and migration rollback drills using production-like data.
6. Independent review of unresolved high-risk findings before onboarding customer data.

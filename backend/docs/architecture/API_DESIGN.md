# Target API Design

This is a proposed contract, not a statement that endpoints already exist. Maintain existing API compatibility during incremental adoption; version or adapt only when an existing contract must change.

## API principles

- JSON REST under `/api`; consistent envelopes and status codes; validate path/query/body inputs.
- Authenticated user identity comes from validated session/JWT and database state.
- Company and warehouse selectors are explicit, but every selector and resource relationship is verified server-side.
- Pagination uses bounded `limit` and stable cursor or page semantics; sorting/filters are allow-listed.
- Mutating workflow commands accept an `Idempotency-Key` and return the prior result for a safe retry.
- Errors include stable machine code, safe message, and request ID; never expose stack traces, secrets, or raw database errors.
- Do not provide a generic endpoint that accepts arbitrary collection/model/resource names for tenant data.

## Authentication and context

Existing `/api/auth` endpoints can be evolved: login, logout, current user, password change. Add reviewed flows for invitation acceptance, email verification, session revocation, secure password reset, and membership/company selection. Example context endpoints:

- `GET /api/me`
- `GET /api/me/companies`
- `POST /api/session/company` — validates active membership and records selected company context.
- `GET /api/me/warehouses` — only warehouses allowed by current membership.

Do not accept role, owner, company, or allowed warehouse scope as authoritative request claims.

## Company administration

- `GET/ PATCH /api/company` — current company only.
- `GET/ POST /api/company/members`
- `PATCH /api/company/members/:membershipId` — role/status changes with audit.
- `POST /api/company/invitations` and invitation acceptance.
- `GET/ POST /api/company/warehouses`; `GET/PATCH/DELETE /api/company/warehouses/:id` with relationship validation and safeguards.
- Billing/plan APIs expose only the caller’s company subscription and permitted actions.

## Operational resource families

Preserve/adapt current product, category, supplier, warehouse, location, inventory, order and report APIs. Normalize to company scope and warehouse filters. Proposed commands:

- Catalog: `/api/items`, `/api/categories`, `/api/suppliers`, `/api/customers`.
- Procurement: `/api/purchase-orders`, `/api/receipts`, `/api/putaway-tasks`.
- Inventory: `GET /api/inventory/balances`, `GET /api/inventory/movements`, `POST /api/inventory/adjustments`, `/api/inventory/counts`.
- Transfers: `/api/transfers` and explicit submit/ship/receive/cancel commands.
- Fulfillment: `/api/orders`, `/api/pick-tasks`, `/api/packs`, `/api/shipments`, `/api/deliveries`, `/api/returns`.
- Reporting: `/api/reports/...` with tenant/warehouse scope enforced in services.

Use explicit action endpoints for state transitions rather than accepting arbitrary status replacement (e.g. `POST /orders/:id/allocate`, `/pick`, `/pack`, `/ship`, `/deliver`). Services validate current state, permissions, stock, and idempotency.

## Super Admin APIs

Keep platform APIs under `/api/platform` or retain `/api/admin` with an explicit compatibility plan. Separate platform-wide company/user/plan metrics from tenant-scoped company support operations. Require Super Admin capability, audited reason for support access, and read-only context by default. A support-view token/context must be short-lived, auditable, and unable to mutate without a separately authorized action.

Potential resources: companies, subscription plans/entitlements, platform metrics, security audit events, company support session. Avoid reusing tenant endpoints with an undocumented “admin=true” query parameter.

## Authorization contract per request

Controller validates input and calls a service with trusted actor + company + warehouse grants. Service scopes every database read/write by company, validates related records, checks action permission and entitlement, then performs transaction/idempotency as required. Tests attempt cross-company and cross-warehouse IDs for every read and mutation.

## Existing API transition

Current plural and singular routes overlap. Inventory endpoints have newer service-backed routes while legacy receiving/pallet/ticket/order flows remain. Before deprecation: inventory all frontend calls, document response/status differences, add contract tests, migrate one consumer, monitor usage, then retire only after proof no supported client depends on it. Never remove routes solely because they look duplicated.

# WareFlow — Warehouse Management System

WareFlow contains a React/Vite frontend and a Node.js/Express/Mongoose API. The API supports normal warehouse accounts and a separately protected Super Admin console.

## Development phases

1. Express API, MongoDB models, JWT authentication, owner-scoped warehouse records, reports, and tests.
2. React/Vite normal user dashboard and Super Admin administration console.

## Technology and structure

- Node.js, Express 4, Mongoose 6.13.8, MongoDB
- JWT bearer authentication; passwords hashed with bcrypt
- Jest and Supertest for automated tests

```text
server.js                  Express setup, API registration, MongoDB startup, health endpoint
routes/                    API route handlers and a shared CRUD router
middleware/                JWT authentication, async error forwarding, central error responses
model/                     Mongoose schemas and MongoDB relationships
services/inventoryService.js Atomic pallet quantity changes and movement recording
validators/records.js      Validation for products, locations, inventory, and master data
scripts/createAdmin.js     Create or promote the first administrator
helper/cleanItem.js        Parser for the legacy external catalog lookup
validation/                Older reusable login/registration validators
 test/                     Jest and Supertest tests
```

## Setup

Requirements: Node.js 18 or newer and a transaction-capable MongoDB deployment. For the canonical Windows setup, first use the root project guide and the local replica-set guide. Create `backend/.env` from its template only if it does not already exist; do not overwrite an existing local environment file:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm ci
npm run dev
```

The backend requires `MONGODB_URI`, `SECRET_OR_KEY`, `SUPER_ADMIN_NAME`, `SUPER_ADMIN_EMAIL`, and a private `SUPER_ADMIN_PASSWORD` of 12–128 characters. Replace the example password before startup. The first successful connection provisions one hashed Super Admin account; later restarts do not replace its password. To intentionally update that password, change `SUPER_ADMIN_PASSWORD` in `.env` and run `npm run superadmin:reset-password` from `backend`. Keep `.env` private; it is ignored by Git.

**Transaction-backed workflows need a MongoDB replica set or sharded cluster.** The standalone URI shown in `.env.example` is not enough for purchase receiving/putaway and multi-document fulfillment transactions. For beginner-friendly Windows PowerShell setup, safe local test database names, and current integration coverage, see [Local MongoDB Replica-Set Setup](../docs/LOCAL_MONGODB_REPLICA_SET_SETUP.md). The backend uses Mongoose 6.13.8 and MongoDB Node.js driver 4.17.2; this repository does not declare a MongoDB Server support range. MongoDB 9.0.4 is the version recorded in a previous local replica-set verification.

Start the frontend in a second terminal:

```powershell
cd ..\frontend
npm install
npm run dev
```

The frontend defaults to `http://127.0.0.1:5000/api`. Set `VITE_API_URL` only if your backend is on a different host or port.

### Existing database records and migration scripts

Do not run a migration as part of setup. The retired ownership migration is disabled. The company migration requires a separately reviewed mapping file, dry-run review, verified backup, write-freeze procedure, and explicit apply approval; its default execution is not an apply. See [Migration Strategy](docs/architecture/MIGRATION_STRATEGY.md). Never infer company ownership from record creator IDs or run a migration against Atlas/production without a separately approved plan.

To create the first administrator, set `WMS_ADMIN_NAME`, `WMS_ADMIN_EMAIL`, and a strong `WMS_ADMIN_PASSWORD` in your local `.env`, then run `npm run seed:admin`. The script creates an admin or promotes the matching existing account. It never prints the password. Public registration always creates a `staff` account; only administrators can delete master records and products/pallets where deletion is allowed.

## Authentication

- `POST /api/auth/register` creates a normal staff user and returns a JWT. Submitted role fields are ignored.
- `POST /api/auth/login` returns a JWT for valid credentials. `POST /api/auth` remains as a compatibility alias.
- Send the token as `Authorization: Bearer <token>` on protected endpoints. The older `x-auth-token` header is also accepted.
- `GET /api/auth/user` returns the current user's public profile.
- `POST /api/auth/logout` documents stateless logout; clients must discard their token.
- Normal authenticated users operate through an active company membership and effective permissions; warehouse-scoped roles are also restricted to assigned warehouses. Explicit deny overrides apply.
- Super Admin endpoints are under `/api/admin` and require the canonical `super_admin` role. Stored legacy `superadmin` values are normalized at the authorization boundary. Super Admin platform access does not confer operational company membership.
- The Super Admin UI includes global monitoring, account search/filter/pagination, account editing/status changes, soft deletion, temporary password resets, per-user data tabs, and a read-only user-dashboard preview.
- User deletion is soft deletion: records are preserved, and the account cannot sign in. Admin actions and sign-ins are recorded in `audit_logs`.
- Password-reset users must update their temporary password before the normal dashboard is shown.
- Password hashes are excluded from responses and normal user queries.

PowerShell login example:

```powershell
$login = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/auth/login' `
  -Method Post -ContentType 'application/json' `
  -Body (@{ email = 'admin@example.com'; password = 'your-local-password' } | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($login.token)" }
```

## API endpoints

All endpoints below use JSON. Resource read/create/update routes require a bearer token unless noted.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Public server/database health; `200` when connected and `503` otherwise |
| POST | `/api/auth/register` | Public staff registration |
| POST | `/api/auth/login` | Public login; `/api/auth` is a compatibility alias |
| GET | `/api/auth/user` | Current authenticated user |
| POST | `/api/auth/logout` | Stateless logout acknowledgement |
| GET, POST | `/api/products` | Search/list products (catalog items) or create one |
| GET, PUT, DELETE | `/api/products/:id` | Retrieve, update, or admin-delete a product |
| GET | `/api/products/sku/:skuNumber` | Retrieve by SKU |
| GET, POST | `/api/categories` | List or create categories |
| GET, PUT, DELETE | `/api/categories/:id` | Retrieve/update; admin delete only if unused |
| GET, POST | `/api/suppliers` | List or create suppliers |
| GET, PUT, DELETE | `/api/suppliers/:id` | Retrieve/update; admin delete only if unused |
| GET, POST | `/api/warehouses` | List or create warehouses |
| GET, PUT, DELETE | `/api/warehouses/:id` | Retrieve/update; admin delete only if no locations refer to it |
| GET, POST | `/api/locations` | List or create locations |
| GET, PUT, DELETE | `/api/locations/:id` | Retrieve/update; admin delete only if no pallet uses it |
| GET, POST | `/api/pallets` | List pallets or create one with an initial stock-in movement |
| GET, PUT, DELETE | `/api/pallets/:id` | Retrieve/update pallet metadata; admin delete only if safe |
| GET | `/api/inventory` | Available quantity grouped by SKU |
| POST | `/api/inventory/stock-in` | Add stock to a pallet or create a received pallet |
| POST | `/api/inventory/stock-out` | Remove available stock from one pallet |
| POST | `/api/inventory/adjust` | Set a pallet's counted available quantity |
| GET | `/api/inventory/movements` | Read the stock movement ledger; optional `skuNumber` and `limit` filters |
| GET | `/api/reports/low-stock` | Products with a positive reorder level at or below available stock |
| GET | `/api/reports/summary` | Product/warehouse/location counts, inventory totals, movement totals, recent movements |
| GET | `/api/reports/movements/summary` | Stock movement counts/quantities; optional ISO `from` and `to` dates |

Older singular routes (`/api/item`, `/api/location`, `/api/pallet`, `/api/receiving`, `/api/order`, `/api/ticket`, `/api/picker`) are retained for compatibility and require authentication. New integrations should use the consistent endpoints above. `/webs/item` is the legacy external catalog scraper and also requires authentication.

### Data fields and relationships

- **Product/catalog item:** `name`, `skuNumber` (unique), `size`, `department`; optional `description`, `ounce`, `reorderLevel`, `category` ID, and `suppliers` ID array.
- **Category:** unique `name`, optional `description`.
- **Supplier:** `name`, optional contact name/email/phone/address, active flag. Email is unique when supplied.
- **Warehouse:** `name`, unique uppercase `code`, optional address and active flag.
- **Location:** `zone`, numeric `row`, `location`, and `level`, unique `fullName`; optional `warehouse` ID and department. Status defaults to `empty`.
- **Pallet:** item reference, SKU, `cont` (received/corrected count), `contAvailable` (currently available count), optional location/status. Stock movement records are embedded in each pallet so the count and its movement append are committed in one atomic MongoDB document update.
- **User and membership:** user account with bcrypt password hash plus company-scoped `CompanyMembership` records containing role, status, warehouse assignments, permission overrides, and revision.
- **Company:** status-gated tenant (`pending`, `active`, `suspended`, or `deactivated`). A Super Admin activation requires a reason and writes an audit event transactionally.
- **Procurement and outbound:** purchase orders, goods receipts, putaways, customers, orders, and shipments are separate company-scoped records linked by MongoDB references. See the root [architecture guide](../docs/WAREFLOW_ARCHITECTURE.md) for the current relationship summary.

## PowerShell: create and view data

Keep one terminal running `npm run dev`; run these examples in another PowerShell window. Adapt example names/SKUs so they are unique in your database.

```powershell
# Check API and MongoDB
Invoke-RestMethod 'http://127.0.0.1:5000/api/health'

# Register a staff user, then use the returned token
$registration = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/auth/register' `
  -Method Post -ContentType 'application/json' `
  -Body (@{ name = 'Warehouse Staff'; email = 'staff@example.com'; password = 'change-this-password' } | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($registration.token)" }

# Create a category and supplier
$category = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/categories' `
  -Method Post -Headers $headers -ContentType 'application/json' `
  -Body (@{ name = 'Electronics'; description = 'Electronic goods' } | ConvertTo-Json)
$supplier = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/suppliers' `
  -Method Post -Headers $headers -ContentType 'application/json' `
  -Body (@{ name = 'Example Supply'; email = 'supply@example.com'; phone = '555-0100' } | ConvertTo-Json)

# Create warehouse and location
$warehouse = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/warehouses' `
  -Method Post -Headers $headers -ContentType 'application/json' `
  -Body (@{ name = 'Main Warehouse'; code = 'MAIN'; address = '1 Warehouse Road' } | ConvertTo-Json)
$location = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/locations' `
  -Method Post -Headers $headers -ContentType 'application/json' `
  -Body (@{ zone = 'A'; row = 1; location = 1; level = 1; fullName = 'A-01-01-01'; warehouse = $warehouse.data._id } | ConvertTo-Json)

# Create a catalog product and associate category/supplier
$product = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/products' `
  -Method Post -Headers $headers -ContentType 'application/json' `
  -Body (@{ name = 'Laptop'; skuNumber = 'LAP-001'; size = 1; department = 'Electronics'; reorderLevel = 5; category = $category.data._id; suppliers = @($supplier.data._id) } | ConvertTo-Json)

# Receive 20 units into a new pallet, then read inventory
$received = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/inventory/stock-in' `
  -Method Post -Headers $headers -ContentType 'application/json' `
  -Body (@{ skuNumber = 'LAP-001'; quantity = 20; reason = 'Initial receiving' } | ConvertTo-Json)
$palletId = $received.data.pallet._id
Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/inventory' -Headers $headers
Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/products/LAP-001' -Headers $headers

# Ship 3 units, adjust the counted stock to 15, and view movements/reports
Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/inventory/stock-out' `
  -Method Post -Headers $headers -ContentType 'application/json' `
  -Body (@{ palletId = $palletId; quantity = 3; reason = 'Customer order' } | ConvertTo-Json)
Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/inventory/adjust' `
  -Method Post -Headers $headers -ContentType 'application/json' `
  -Body (@{ palletId = $palletId; newQuantity = 15; reason = 'Cycle count correction' } | ConvertTo-Json)
Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/inventory/movements?skuNumber=LAP-001' -Headers $headers
Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/reports/low-stock' -Headers $headers
Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/reports/summary' -Headers $headers

# Update product by MongoDB ID; SKU remains unique
Invoke-RestMethod -Uri "http://127.0.0.1:5000/api/products/$($product.data._id)" `
  -Method Put -Headers $headers -ContentType 'application/json' `
  -Body (@{ description = 'Updated product description' } | ConvertTo-Json)
```

An insufficient stock-out returns HTTP `409`; invalid data/IDs return `400`; missing records return `404`; unauthenticated requests return `401`; non-admin delete requests return `403`; duplicate SKU/email/code/name values return `409`. Delete routes reject records still referenced by stock or other records. Use an admin bearer token for allowed deletes.

## Verification

Run the backend unit and API suite with `npm test -- --runInBand`. Most workflow/service tests use mocked models. Two opt-in replica-set suites are available: `test/membershipTransaction.integration.test.js` and `test/ticketFulfillment.integration.test.js`. They are skipped unless their dedicated loopback-only `WAREFLOW_M3_TEST_URI` and `WAREFLOW_TICKET_TEST_URI` variables are set. Follow the local replica-set guide before running them; they write fixtures and initialize indexes in dedicated test databases. The mocked procurement and modern outbound tests do not prove live MongoDB transaction behavior.

The API was also exercised against the configured local MongoDB using temporary records: registration, category/supplier/warehouse/location/product creation, duplicate SKU rejection, stock-in, stock-out, insufficient-stock rejection, adjustment, low-stock and movement reports, and health. Those uniquely tagged test records were removed afterward.

## Security and known limitations

- `.env` is ignored; `.env.example` contains placeholders only. Never commit local credentials.
- New resource endpoints require JWT authentication; delete operations require an admin role. Public registration cannot assign admin privileges.
- A single-pallet quantity adjustment and its embedded movement event use an atomic document update. Multi-document purchase/receiving/putaway and outbound fulfillment operations use MongoDB transactions and therefore need a transaction-capable replica-set or sharded deployment.
- The movement ledger is embedded per pallet; very long-lived/high-volume pallets may eventually need ledger archival or a replica-set transaction design.
- The local replica-set ticket integration suite covers `/api/ticket/create`; it does not cover the full modern sales-order-to-delivery lifecycle. Procurement/receiving/putaway and modern outbound transaction suites currently use mocks; see the setup guide for coverage details.
- MongoDB access uses Mongoose 6.13.8 and the MongoDB 4.17 driver to support Atlas connection strings on current Node.js versions. Some older routes retain legacy response conventions.
- The external scraper depends on a third-party catalog site and Puppeteer/Chromium. No category, supplier, warehouse, or inventory UI is included in this Phase 1 backend.
- `npm install` reports 48 dependency advisories in this legacy dependency tree (4 low, 10 moderate, 28 high, 6 critical). Review and upgrade dependencies before production deployment.

## Company application API

- `POST /api/companies/register` is public and accepts `company`, `administrator`, `warehouseRequirements`, and `acceptance` objects. It validates a strict field allowlist, hashes the initial administrator password with bcrypt, creates a `pending` company and active `company_admin` membership, and writes `company.registration.submitted` atomically. It never accepts a requested role, owner, company ID, or status. Existing administrator email accounts are rejected rather than silently linked.
- `GET /api/companies/registration/status` requires JWT authentication and returns only registrations whose applicant user ID matches the authenticated user. It omits business identifiers and other administrator details.
- `GET /api/admin/companies/:id/registration` and `POST /api/admin/companies/:id/registration/review` use the existing authenticated Super Admin mount. Reviews require an audit reason and are transactionally logged. `POST /api/admin/companies/:id/activate` requires registration status `verified` for new applications; legacy pending companies retain their prior activation path.
- `GET/PATCH /api/companies/:companyId/onboarding` require an active Company Admin tenant context. Completion for warehouse, location, product, supplier, and team steps is checked against company-scoped records. Optional checklist steps can be skipped and revisited. `GET/PATCH /api/companies/:companyId/settings` controls company currency, time zone, and measurement units for active Company Admins.

Accepted policy versions are `wareflow-terms-draft-1` and `wareflow-privacy-draft-1`. They are labels for draft documents, not legal approval. Email verification, OTP, secure document upload/storage, and government identifier verification are not configured.

The Company schema declares unique sparse registration indexes for reference, normalized company and administrator emails, GSTIN, PAN, CIN/LLPIN, and business-registration number, but Company `autoIndex` is disabled. The registration endpoint checks those indexes and fails closed with `REGISTRATION_INDEXES_NOT_READY` if any are missing. Since automatic index creation is off for the Company model, verify the existing unique slug and status indexes too, especially on a fresh database. Inspect duplicates and current index state before planned deployment. No index migration is bundled or executed here. Opt-in transaction tests live in `test/companyRegistration.integration.test.js`; use only the disposable loopback `WAREFLOW_COMPANY_REGISTRATION_TEST_URI` database, never Atlas or production.

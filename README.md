# Warehouse Management System — Phase 1 Backend

This repository contains the Node.js API and MongoDB persistence layer for a Warehouse Management System (WMS). It is a backend-only Phase 1 submission. The frontend and final integration are future phases.

## Development phases

1. **Phase 1 — Backend (implemented):** Express server, MongoDB models, authentication, product/item catalog, categories, suppliers, warehouses, locations, pallets, inventory movements, reports, validation, and API tests.
2. **Phase 2 — Frontend (future):** React pages, login, dashboard, and management screens that consume this API.
3. **Phase 3 — Integration and polish (future):** end-to-end workflows, deployment preparation, and further security/performance work.

## Technology and structure

- Node.js, Express 4, Mongoose 5, MongoDB
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

Requirements: Node.js 18 or newer and MongoDB. Create `.env` from the template only when it does not already exist, then replace the placeholder JWT secret with a strong random value:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm install
npm run dev
```

The server checks `MONGODB_URI` and `SECRET_OR_KEY`, connects to MongoDB, and only then listens. `PORT` defaults to `5000`. Keep the server terminal open while making requests from a second PowerShell window. `.env` is ignored by Git.

To create the first administrator, set `WMS_ADMIN_NAME`, `WMS_ADMIN_EMAIL`, and a strong `WMS_ADMIN_PASSWORD` in your local `.env`, then run `npm run seed:admin`. The script creates an admin or promotes the matching existing account. It never prints the password. Public registration always creates a `staff` account; only administrators can delete master records and products/pallets where deletion is allowed.

## Authentication

- `POST /api/auth/register` creates a staff user and returns a JWT.
- `POST /api/auth/login` returns a JWT for valid credentials. `POST /api/auth` remains as a compatibility alias.
- Send the token as `Authorization: Bearer <token>` on protected endpoints. The older `x-auth-token` header is also accepted.
- `GET /api/auth/user` returns the current user's public profile.
- `POST /api/auth/logout` documents stateless logout; clients must discard their token.
- Protected resource routes require authentication. Delete routes that can remove master data require the `admin` role.
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
- **User:** unique normalized email, bcrypt password hash, role (`staff` or `admin`), clearance, avatar, and status.

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

Run the automated suite with `npm test`. It covers authentication and response sanitization, protected routes and roles, category CRUD/conflicts, stock-out quantity checks, atomic ledger updates, concurrency retry, and input validation. API tests use mocked Mongo models; a live local MongoDB check is still needed for a particular environment.

The API was also exercised against the configured local MongoDB using temporary records: registration, category/supplier/warehouse/location/product creation, duplicate SKU rejection, stock-in, stock-out, insufficient-stock rejection, adjustment, low-stock and movement reports, and health. Those uniquely tagged test records were removed afterward.

## Security and known limitations

- `.env` is ignored; `.env.example` contains placeholders only. Never commit local credentials.
- New resource endpoints require JWT authentication; delete operations require an admin role. Public registration cannot assign admin privileges.
- Stock values and the corresponding movement event are updated atomically within one pallet document using a compare-and-set retry. This works on standalone MongoDB and avoids claiming multi-document transaction support.
- The movement ledger is embedded per pallet; very long-lived/high-volume pallets may eventually need ledger archival or a replica-set transaction design.
- Legacy multi-document order/ticket workflows remain for compatibility and are not guaranteed all-or-nothing across a multi-pallet order. The canonical inventory stock operations are single-pallet atomic operations.
- The repository retains old Mongoose 5-era route code and emits deprecation/circular-dependency warnings. The modern routes centralize validation/errors; legacy endpoints may have older response conventions.
- The external scraper depends on a third-party catalog site and Puppeteer/Chromium. No category, supplier, warehouse, or inventory UI is included in this Phase 1 backend.
- `npm install` reports 48 dependency advisories in this legacy dependency tree (4 low, 10 moderate, 28 high, 6 critical). Review and upgrade dependencies before production deployment.

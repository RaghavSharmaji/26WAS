# Warehouse Management System — Phase 1 Backend

A MongoDB and Express backend for warehouse operations. This submission contains **Phase 1 only**; frontend development and full integration remain future work.

## Development phases

1. **Phase 1 (implemented):** Express API, MongoDB persistence, authentication, inventory, receiving, locations, orders, tickets, and pallet operations.
2. **Phase 2 (future):** React interface, login and dashboard pages, and management screens.
3. **Phase 3 (future):** End-to-end integration, expanded tests, security/performance improvements, and deployment preparation.

## Technology and layout

- Node.js, Express 4, Mongoose 5, MongoDB
- JWT authentication and bcrypt password hashing
- `server.js` starts the API; `routes/` implements endpoints; `model/` defines persisted entities; `middleware/` handles JWT authentication; `validation/` and `helper/` hold shared validation/utilities.

```text
server.js
model/            User, Item, Location, Pallets, Order, Ticket, Product
routes/           auth, user, item, location, pallet, receiving, order, ticket, picker, web scraping
middleware/       JWT authentication
validation/       registration and login validation
helper/           item parsing helper
 test/            helper unit test
```

## Setup

Requirements: Node.js and a running MongoDB instance. Configure environment:

```powershell
Copy-Item .env.example .env
# Edit .env with your MongoDB URI and a strong random SECRET_OR_KEY
npm install
npm start
```

The server connects to MongoDB before listening. Default port is `5000`. `npm run dev` runs nodemon. `npm test` runs the included helper test.

## API

All resource routes are under `/api` except the legacy item lookup route `/webs/item`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API and database status |
| POST | `/api/user` | Register a user |
| POST | `/api/auth` | Login and receive JWT |
| GET | `/api/auth/user` | Authenticated user profile |
| POST | `/api/auth/logout` | Mark authenticated user logged out |
| GET, POST | `/api/item` | List or create items |
| GET | `/api/item/:skuNumber` | Find item by SKU |
| POST | `/api/item/update`, `/api/item/delete` | Update or delete item |
| GET, POST | `/api/location` | List or create locations |
| GET, POST, DELETE | `/api/location/available/all`, `/api/location/create`, `/api/location/delete/:locationFullName` | Location operations |
| GET, POST, DELETE | `/api/pallet` | List, create, update, or delete pallets (update uses POST `/update`) |
| POST | `/api/receiving/*` | Receiving and put-away operations |
| GET, POST | `/api/order` | List and create orders; submit via POST `/submit` |
| GET, POST, DELETE | `/api/ticket` | Ticket operations |
| POST | `/api/picker/*` | Picking operations |
| POST | `/webs/item` | Legacy external catalog lookup (requires network and Puppeteer/Chromium) |

### Terminal examples

```sh
curl http://localhost:5000/api/health
curl -X POST http://localhost:5000/api/user -H "Content-Type: application/json" -d '{"name":"Warehouse Admin","email":"admin@example.com","password":"change-this-password"}'
curl -X POST http://localhost:5000/api/auth -H "Content-Type: application/json" -d '{"email":"admin@example.com","password":"change-this-password"}'
curl -X POST http://localhost:5000/api/item/create -H "Content-Type: application/json" -d '{"name":"Sample item","size":1,"skuNumber":"SKU-001","department":"General"}'
curl http://localhost:5000/api/item
```

For protected routes send `-H "Authorization: Bearer <token>"`. A healthy server returns `200` with `{"success":true,"status":"ok"}`. If MongoDB is unavailable, health returns `503`; unknown routes return `404`. Request bodies should match the model fields. Existing routes are legacy and some use POST for update/delete actions.

## Data model overview

Users store unique email and a bcrypt hash; items have unique `skuNumber`; locations have unique `fullName`; pallets reference items and carry quantities/status/location; orders and tickets track fulfillment; products represent ticket pick records. These schemas are in `model/`. MongoDB persists records in the configured database; inspect them with `mongosh` or MongoDB Compass.

## Security and validation

- `.env` is ignored by Git; `.env.example` contains variable names and placeholders only.
- JWT signing uses `SECRET_OR_KEY`; passwords are hashed during registration.
- API input validation exists for authentication and Mongoose schema fields.
- The existing authorization and operation routes are legacy implementations and should be reviewed before production use.

## Verification and limitations

The API has a database-aware health endpoint; a live check connected to the default local MongoDB database and returned `200`. The existing automated test covers the item parsing helper. The project does not include a `.env` file, so set `MONGODB_URI` and `SECRET_OR_KEY` locally before startup. Inventory transaction atomicity, a formal role policy, and comprehensive route integration tests are not present yet. The legacy scraper depends on an external catalog and local Chromium support.

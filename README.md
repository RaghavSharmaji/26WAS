# WareFlow WMS

WareFlow is a React and Vite frontend backed by a Node.js, Express, Mongoose, and MongoDB API. The repository contains a multi-company warehouse application with company membership, warehouse assignments, role-based permissions, inventory, procurement, receiving, outbound order processing, and a separate Super Admin console.

## Repository layout

- `backend/` — Express API, Mongoose models, middleware, services, scripts, and Jest tests.
- `frontend/` — canonical React/Vite application. `backend/frontend/` is a legacy duplicate; use the root `frontend/` for development and builds.
- `docs/` — local MongoDB setup, user and demo guides, architecture, test results, limitations, and readiness audit.

## Prerequisites

- Node.js 18 or newer (the package declares this minimum; the verification run used Node 25.7.0).
- npm.
- A MongoDB replica set or sharded cluster for transaction-backed workflows. A standalone MongoDB server is not enough.
- MongoDB Community Server and `mongosh` for a local replica set. See [Local MongoDB Replica-Set Setup](docs/LOCAL_MONGODB_REPLICA_SET_SETUP.md).

## First-time local setup (Windows PowerShell)

Install dependencies in the two applications:

```powershell
Set-Location 'C:\Users\Radhe\OneDrive\Desktop\WMS\WMS F\backend'
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Configure the backend-only values described in `backend/.env.example`. At minimum set `MONGODB_URI`, `SECRET_OR_KEY`, `SUPER_ADMIN_NAME`, `SUPER_ADMIN_EMAIL`, and `SUPER_ADMIN_PASSWORD`. Use a private, strong password; never copy the example value into a shared or deployed environment. The local MongoDB connection must point to a replica set for receiving, putaway, inventory transactions, and order fulfillment.

Then install and configure the frontend:

```powershell
Set-Location 'C:\Users\Radhe\OneDrive\Desktop\WMS\WMS F\frontend'
npm ci
```

`frontend/.env.example` documents the public `VITE_API_URL` setting. Its default points to `http://127.0.0.1:5000`; do not put server secrets in the frontend environment.

## Start the application

Start a healthy local replica set first, following the setup guide. Then use two terminals:

```powershell
# Terminal 1
Set-Location 'C:\Users\Radhe\OneDrive\Desktop\WMS\WMS F\backend'
npm run dev
```

```powershell
# Terminal 2
Set-Location 'C:\Users\Radhe\OneDrive\Desktop\WMS\WMS F\frontend'
npm run dev
```

Open the Vite URL shown in Terminal 2, normally `http://localhost:5173`. Verify the API and database connection at `http://127.0.0.1:5000/api/health` (healthy response: HTTP 200).

On backend startup, the Super Admin account is provisioned from the backend environment if it does not already exist. The password is hashed and is not returned by an API. Startup does not reset an existing Super Admin password. For an intentional password update, edit the backend's local `.env` and run `npm run superadmin:reset-password` from `backend/`; sign in again afterward. Do not run any migration script as part of ordinary setup.

## Checks

```powershell
Set-Location 'C:\Users\Radhe\OneDrive\Desktop\WMS\WMS F\backend'
npm test -- --runInBand
Set-Location '..\frontend'
npm run lint
npm run build
```

Replica-set integration tests are opt-in and write only to the dedicated databases guarded by each suite. Follow the setup guide and confirm the disposable local database target before setting `WAREFLOW_M3_TEST_URI` or `WAREFLOW_TICKET_TEST_URI`. Ordinary Jest results do not establish live transaction behavior for procurement or modern outbound flows.

## Product walkthrough

- [User guide](docs/WAREFLOW_USER_GUIDE.md) explains normal and Super Admin workspaces.
- [10–15 minute demo guide](docs/WAREFLOW_DEMO_GUIDE.md) lists prerequisites and a scripted inbound/outbound scenario.
- [Architecture](docs/WAREFLOW_ARCHITECTURE.md) describes modules and record relationships observed in the source.
- [Test report](docs/WAREFLOW_TEST_REPORT.md) records the actual local verification run and skipped checks.
- [Known limitations](docs/WAREFLOW_KNOWN_LIMITATIONS.md) distinguishes deferred work and live database gaps.
- [Evaluation readiness audit](docs/WAREFLOW_EVALUATION_READINESS_AUDIT.md) contains the original audit and a dated follow-up.

## Security and data safety

Keep `backend/.env` private and out of Git. Never point a local test URI at Atlas, staging, production, or a database containing user data. Do not run the company or ownership migration commands without a reviewed backup, mapping, maintenance plan, and explicit approval. The application-level migration write freeze does not stop direct database clients or unrelated services.

## Company registration and onboarding

New companies apply at `/register/company`. The application creates a pending tenant, an initial Company Admin membership, a registration reference, and an audit event in one transaction. Applicants then sign in and view `/registration/status`. A Super Admin reviews the application in **Companies**, marks it under review, verifies or rejects it with a reason, and activates verified registrations with the existing audited activation action. Activation makes company selection available; it does not create warehouses, stock, or other operational records.

Company Admins see a setup checklist on the dashboard after selecting an active company. It links to existing warehouse, location, product, supplier, and team features. Estimates supplied on the application are planning metadata only. Registration does not verify email, GSTIN, PAN, CIN, or uploaded documents; secure document storage and verification integrations are not configured.

See [Company registration and onboarding](docs/COMPANY_REGISTRATION_AND_ONBOARDING.md), [draft Terms](docs/legal/TERMS_OF_SERVICE_DRAFT.md), and [draft Privacy Notice](docs/legal/PRIVACY_NOTICE_DRAFT.md). The legal documents are drafts and require review before commercial use.


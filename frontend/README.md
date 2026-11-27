# WMS F Frontend

React and Vite interface for the WMS backend.

## Run locally

The canonical frontend is this root `frontend/` directory. Start a healthy local MongoDB replica set and the backend first; transaction-backed receiving and order workflows do not work against a standalone MongoDB server. See [Local MongoDB Replica-Set Setup](../docs/LOCAL_MONGODB_REPLICA_SET_SETUP.md) and the root [README](../README.md). Then, from this directory:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm ci
npm run dev
```

The default API base is `http://127.0.0.1:5000`. Change `VITE_API_URL` in `.env` only if the backend runs at a different address. This variable is public browser configuration; do not put database credentials or JWT secrets in the frontend environment file.

The sign-in and sign-up forms use `/api/auth/login` and `/api/auth/register`. The JWT is currently stored in browser local storage and sent as a bearer token on protected requests. Company and warehouse selection are context selectors; the backend revalidates membership, status, permissions, and assignments. The root `frontend/` package exposes `npm run lint` and `npm run build`; it does not currently define an automated frontend test script.

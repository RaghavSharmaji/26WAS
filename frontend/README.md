# WMS F Frontend

React and Vite interface for the WMS backend.

## Run locally

Start the backend first in `backend` (`npm run dev`). Then, from this directory:

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

The default API base is `http://127.0.0.1:5000`. Change `VITE_API_URL` in `.env` only if the backend runs at a different address. This variable is public browser configuration; do not put database credentials or JWT secrets in the frontend environment file.

The sign-in and sign-up forms use `/api/auth/login` and `/api/auth/register`. The token is stored in browser local storage and sent as a bearer token on protected requests. Products, inventory, categories, suppliers, warehouses, locations, reports, and order status requests use the backend API.

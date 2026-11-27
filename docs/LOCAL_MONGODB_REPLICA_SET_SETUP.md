# Local MongoDB Replica-Set Setup (Windows PowerShell)

Use this guide when testing WareFlow workflows that write more than one MongoDB document in one operation. It is written for a local, throwaway development/test instance. It does not configure or connect to Atlas or production.

## What version and topology does this project use?

The backend pins Mongoose **6.13.8**; the installed Mongoose driver in this checkout is MongoDB Node.js driver **4.17.2**. The project does **not** pin or declare a supported MongoDB Server version range. A prior local verification in this project used MongoDB Server **9.0.4**, replica-set name **`wareflowTest`**, on loopback. That is the known-good recorded local setup, not a promise that every server/driver combination is supported. Reproduce it if you need the same baseline.

The opt-in tests require loopback hosts and separate database names:

- `wareflow_phase3_m3_test` via `WAREFLOW_M3_TEST_URI`
- `wareflow_ticket_test` via `WAREFLOW_TICKET_TEST_URI`

The integration test files do not verify the replica-set name in code; use `wareflowTest` here to match the recorded verification and set the URI `replicaSet` option. MongoDB transactions require a replica set or sharded cluster; a standalone `mongod` is not sufficient for WareFlow's multi-document transactional workflows. MongoDB documents how to initialize a replica set and inspect it with `rs.status()` and `rs.conf()` in its [replica-set setup guide](https://www.mongodb.com/docs/manual/tutorial/deploy-replica-set/). For the reproducible baseline, select MongoDB Community Server **9.0.4**, Windows x64, from the [official download page](https://www.mongodb.com/try/download/community); follow the [MongoDB 9.0 Windows installation guide](https://www.mongodb.com/docs/v9.0/tutorial/install-mongodb-on-windows/). Install [`mongosh`](https://www.mongodb.com/docs/mongodb-shell/install/) separately from MongoDB Server.

## 1. Check whether MongoDB tools or a server are already present

Run these read-only checks in PowerShell before starting anything:

```powershell
Get-Command mongod, mongosh -ErrorAction SilentlyContinue
Get-Process mongod -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime, Path
Get-Service MongoDB -ErrorAction SilentlyContinue | Select-Object Status, Name, DisplayName
Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

If `mongod` or `mongosh` is missing, install MongoDB Community Server 9.0.4 for Windows x64 and MongoDB Shell (`mongosh`) separately using the official links above. During setup, either add the Server `bin` directory to `PATH` or note the full path to `mongod.exe`; likewise note the `mongosh.exe` path. The usual Server path resembles `C:\Program Files\MongoDB\Server\9.0\bin\mongod.exe`, but use the actual version and install location on your computer.

Do not stop an existing MongoDB service or process as part of this setup. This guide uses port **27018** so it does not compete with a typical local development server on 27017. If port 27018 is already listening, do not terminate that process; pick another unused local port and substitute it consistently in every command and URI below. Never reuse an existing MongoDB data directory for disposable tests.

## 2. Create a new, dedicated local data directory

The commands below stop with an error if the proposed directory already exists. Choose another new path if it does.

```powershell
$mongoDataPath = Join-Path $env:LOCALAPPDATA 'WareFlow\MongoTest\wareflowTest'
if (Test-Path -LiteralPath $mongoDataPath) {
  throw "The data path already exists. Choose a new disposable path: $mongoDataPath"
}
New-Item -ItemType Directory -Path $mongoDataPath | Out-Null
```

This directory is for the local replica set only. The test suites write fixture documents and remove the fixtures they create. They also call model initialization, which may create indexes in the named test databases. Do not point either test URI at your regular `wms_f` database or any database containing real data.

## 3. Start one local replica-set member

First confirm the selected port is free (the example uses 27018):

```powershell
$port = 27018
$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw "Port $port is already in use. Choose another unused port; do not stop the existing process." }
```

Open a dedicated PowerShell window and run `mongod` in the foreground. Keep this window open while using WareFlow. With MongoDB 9.0 installed in the usual location:

```powershell
$mongodExe = 'C:\Program Files\MongoDB\Server\9.0\bin\mongod.exe'
$mongoDataPath = Join-Path $env:LOCALAPPDATA 'WareFlow\MongoTest\wareflowTest'
& $mongodExe --dbpath $mongoDataPath --replSet wareflowTest --bind_ip 127.0.0.1 --port 27018 --logpath "$mongoDataPath\mongod.log"
```

If `mongod` is on `PATH`, you can use `mongod` instead of `$mongodExe`. The process is bound to loopback only. Leave it running and use a second PowerShell window for the next steps.

## 4. Initialize the replica set once

In the second PowerShell window:

```powershell
mongosh 'mongodb://127.0.0.1:27018/?directConnection=true'
```

At the `mongosh` prompt, initialize a single-member local set:

```javascript
rs.initiate({
  _id: 'wareflowTest',
  members: [{ _id: 0, host: '127.0.0.1:27018' }]
})
```

Run `rs.initiate()` only once for this new data directory. If MongoDB reports that the set is already initialized, do not reinitialize it; inspect it with the health checks below.

## 5. Check replica-set health

In `mongosh`, run:

```javascript
rs.status().myState
rs.status().members.map(member => ({ name: member.name, stateStr: member.stateStr, health: member.health }))
db.adminCommand({ hello: 1 })
```

For this one-member setup, `myState` should be `1`, the member should show `PRIMARY` and health `1`, and `hello` should show `setName: 'wareflowTest'` and `isWritablePrimary: true`. If the member is still `STARTUP`/`SECONDARY`, wait a few seconds and check again. Do not run integration tests until it is primary and healthy.

Exit the shell with `exit` or `Ctrl+D`; this does not stop the `mongod` process.

## 6. Configure the backend connection

The backend reads `MONGODB_URI` from `backend/.env`. Keep all database credentials in the backend only. For the local replica set, the URI should use the local member and replica-set name:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27018/wms_f?replicaSet=wareflowTest
```

This is an example for a **local development database**. It does not include credentials because the local disposable server above has no authentication configured and listens only on loopback. Follow the existing backend `.env.example` for `SECRET_OR_KEY`, Super Admin values, port, and CORS configuration. Do not put MongoDB credentials or `SECRET_OR_KEY` in `frontend/.env`; `VITE_API_URL` is the only public API address setting.

The existing backend `.env.example` uses port 27017 and no `replicaSet` query. That plain URI may connect to a standalone local MongoDB, but it is not sufficient for the multi-document transaction workflows or these opt-in integration suites. For this setup, configure `MONGODB_URI` as above in your own local `backend/.env`; this task did not edit any environment files.

## 7. Start WareFlow

Backend, in one PowerShell window:

```powershell
Set-Location 'C:\Users\Radhe\OneDrive\Desktop\WMS\WMS F\backend'
npm run dev
```

Frontend, in a separate PowerShell window:

```powershell
Set-Location 'C:\Users\Radhe\OneDrive\Desktop\WMS\WMS F\frontend'
npm run dev
```

Open the Vite URL printed in the frontend terminal (normally `http://localhost:5173`). Verify the backend health endpoint at `http://127.0.0.1:5000/api/health`. Keep MongoDB bound to `127.0.0.1`; do not expose this unauthenticated throwaway database to another machine or the Internet.

## 8. Run backend tests

The ordinary test suites use mocks and do not need a MongoDB connection. From `backend`:

```powershell
npm test -- --runInBand
```

To run the focused procurement and modern outbound unit suites only:

```powershell
npm test -- --runInBand test/procurementService.test.js test/outboundService.test.js
```

These focused tests mock transaction/session behavior. They are useful for service logic but do not prove that MongoDB commits/rolls back the operations.

## 9. Run opt-in replica-set integration tests

Only use the newly created local data directory and the healthy `wareflowTest` replica set above. Both test files reject a non-loopback host and require the expected dedicated database name. The tests create fixture users, companies, memberships, warehouses, inventory/orders and related records; cleanup deletes the test fixtures by their generated IDs. `Model.init()` may create declared indexes in these test databases. The suites do not drop databases. Keep these database names separate from `wms_f` and from any real/shared database.

In a fresh PowerShell window, from the backend directory, run one suite at a time:

```powershell
$env:WAREFLOW_M3_TEST_URI = 'mongodb://127.0.0.1:27018/wareflow_phase3_m3_test?replicaSet=wareflowTest'
npm test -- --runInBand test/membershipTransaction.integration.test.js
Remove-Item Env:WAREFLOW_M3_TEST_URI
```

Then run the ticket integration suite:

```powershell
$env:WAREFLOW_TICKET_TEST_URI = 'mongodb://127.0.0.1:27018/wareflow_ticket_test?replicaSet=wareflowTest'
npm test -- --runInBand test/ticketFulfillment.integration.test.js
Remove-Item Env:WAREFLOW_TICKET_TEST_URI
```

The test files also check that the URI database name contains the exact expected identifier and that the hostname is `127.0.0.1`, `localhost`, or `::1`. Do not set either variable to Atlas, staging, production, or your normal `wms_f` database. If a test fails before its cleanup runs, inspect only the dedicated disposable test database and clean up the generated test fixtures before reuse; do not run broad `deleteMany({})` or database-drop commands against a shared database.

## 10. Stop the local MongoDB process safely

Return to the PowerShell window where `mongod` is running and press **Ctrl+C** once. Wait for the process to shut down cleanly. Do not use `Stop-Service MongoDB` or kill a process by PID for this foreground setup. If you started MongoDB another way, first confirm which process/data directory it uses and stop only the instance you intentionally started for this disposable test.

Do not delete the data directory while `mongod` is running. This guide does not automatically remove the disposable data directory; if you later choose to remove it, first verify the exact path and that it is the throwaway `wareflowTest` directory—not an existing local development data directory.

## Integration coverage: what is and is not verified

### Existing opt-in real MongoDB suites

- `test/membershipTransaction.integration.test.js` has five replica-set tests for membership update plus audit commit, audit-failure rollback, actor becoming inactive, concurrent last-Company-Admin removal, and concurrent stale-revision updates.
- `test/ticketFulfillment.integration.test.js` has eight replica-set tests for its legacy `/api/ticket/create` fulfillment path: successful fulfillment, insufficient SKU quantity behavior, rollback after inventory update failure, ticket-save rollback, duplicate request, concurrent duplicate fulfillment, cross-company denial, and unassigned-warehouse denial.

### Missing live integration coverage

There is currently no replica-set integration suite for the modern purchase-to-receiving or outbound workflow. In particular, the following are only covered by mocked tests or are not verified live in the repository:

- Purchase-order creation/submission transaction behavior.
- Partial and complete GRN receiving, duplicate receipt handling, excess-receipt rejection, quality inspection, and quarantine.
- Putaway, location capacity, duplicate/concurrent putaway, and ledger-to-balance consistency.
- Modern sales-order reservation, picking/short-pick release, packing, dispatch, delivery, and cancellation/release.
- Manual stock-in idempotency, duplicate-key/index races, and app-wide migration write-freeze behavior across instances.

`test/procurementService.test.js` and `test/outboundService.test.js` contain useful mocked scenarios for many of those cases, but mocks are not evidence of MongoDB transaction isolation, rollback, unique-index races, or persistence consistency. Do not describe those workflows as live-database verified until dedicated local replica-set integration tests pass.

## Verification and current machine state

This documentation task did not start or stop MongoDB and did not run integration tests. At inspection time, `mongod` and `mongosh` were not found on `PATH`; the read-only process/service/listener checks found no `mongod` process, MongoDB service, or listener on port 27018. No server version was queried from an installed binary on this machine.

The previously recorded MongoDB 9.0.4 local membership-test run is historical project evidence only. It does not establish that a replica set is running now, that this machine currently has that version installed, or that procurement and modern outbound workflows have live integration coverage.

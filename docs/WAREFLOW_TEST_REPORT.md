# WareFlow Test and Quality Report

**Run date:** 2026-11-27 (Asia/Calcutta)  
**Scope:** Current working tree; no database connection or migration.

## Commands and results

| Check | Result | Details |
| --- | --- | --- |
| `backend: npm test -- --runInBand` | Passed | 14 suites passed, 2 suites skipped; 273 tests passed, 13 skipped, 0 failed. |
| `frontend: npm run lint` | Passed with warnings | Exit code 0; no lint errors. Oxlint reports React effect/dependency warnings; the initial empty parameter destructure warning was corrected before the final run. |
| `frontend: npm run build` | Passed | Vite transformed 2,161 modules and produced a production bundle. |
| `git diff --check` | Passed | No whitespace errors. Git emitted line-ending conversion notices for existing edited files. |
| Frontend automated tests | Not configured | `frontend/package.json` has no test script and no frontend test directory was found. |
| Backend application startup | Not executed | Requires configured local backend environment and a reachable MongoDB. No startup/database claim is made. |

## Test type and coverage

The 273 passed backend tests are Jest unit, mocked service, API/Supertest, and script tests. These establish tested code paths under mocks; they are not all database integration tests.

Two replica-set suites were skipped because the opt-in environment variables were not configured and no MongoDB process/listener was active on the dedicated test port:

- `backend/test/membershipTransaction.integration.test.js` — five live replica-set tests, gated by `WAREFLOW_M3_TEST_URI` and a loopback-only `wareflow_phase3_m3_test` database.
- `backend/test/ticketFulfillment.integration.test.js` — eight live replica-set tests, gated by `WAREFLOW_TICKET_TEST_URI` and a loopback-only `wareflow_ticket_test` database.

There is no live replica-set integration suite in this checkout for the modern PO/GRN/inspection/putaway or modern reserve/pick/pack/dispatch/delivery/cancellation services. Those service tests are mocked. The numerical end-to-end scenario has not been verified against actual MongoDB state.

## Machine facts observed

- Node.js: `v25.7.0`; npm: `11.10.1`.
- MongoDB Server executable and `mongosh` were found at the paths documented in the local setup guide.
- No `mongod` process or listener on port 27018 was observed at the time of checking. Service state could not be read because Windows denied Service Control Manager access; no service was started.
- The test-specific MongoDB URI variables were absent.

For exact isolated replica-set setup and test commands, follow [Local MongoDB Replica-Set Setup](LOCAL_MONGODB_REPLICA_SET_SETUP.md). Do not set these variables to Atlas, production, or the normal application database.


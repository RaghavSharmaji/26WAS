# Company registration and onboarding

## Lifecycle

`Registration → Pending review → Under review → Verified or rejected → Super Admin activation → Company selection → Warehouse setup → Operations`

Registration creates one user account for the named initial administrator, one pending Company, an active Company Admin membership, and a submission audit record in one MongoDB transaction. It does not create a warehouse, employees, products, suppliers, inventory, or orders. Warehouse counts, SKU counts, and order volumes are planning estimates only.

## Applicant steps

1. Open `/register/company` from the login page.
2. Enter registered company identity, contact and address details. GSTIN, PAN, CIN/LLPIN and business registration number are optional. India PAN/GSTIN values receive format checks, not government verification.
3. Create the initial Company Admin account. Passwords must be 12–128 characters and contain lowercase, uppercase, a digit, and a symbol. If that administrator email already has an account, registration is rejected. Sign in to the existing account and use the established company/membership process instead; registration will not alter existing credentials or memberships.
4. Enter warehouse requirements and preferences. Defaults for India are INR, Asia/Kolkata, and metric. These are not real warehouse records.
5. Acknowledge the draft terms and privacy notice and confirm accuracy. Submission receives a `WF-...` reference.
6. Sign in with the administrator account. A pending applicant is directed to `/registration/status`; this endpoint only returns applications tied to the authenticated user ID. Review feedback appears there.

Email verification and OTP are not configured; account and application email status remains `pending`. This is explicitly shown and no email is treated as verified.

## Super Admin review

1. Open **Companies** in the existing Super Admin dashboard.
2. Filter by company status and application review status.
3. Open **Review application** to see the submitted details. Business identifiers and initial administrator contacts are available only from the platform-admin review API; applicants never receive these values from the status API.
4. Enter a reason and mark the application **under review**, **verified**, or **rejected**. Each transition is allowlisted, transactionally revalidated against an active Super Admin user, and recorded in AuditLog. A rejected application remains inaccessible and cannot be activated.
5. A verified registration can then be activated using the existing separate activation action and its own required reason. The API rejects activation of a registration that has not been verified. Activation does not add a Super Admin membership or operational access.

Existing legacy pending companies without a registration subdocument retain the earlier audited activation path.

## After activation

The initial Company Admin signs in again, selects the active company, and uses the dashboard setup checklist. The checklist reuses existing pages for warehouses, locations, products, suppliers, and team membership. Counts are queried using the selected company ID. Warehouse setup and profile/role confirmation are required to finish the checklist; optional operational steps can be skipped and revisited. Company preferences (currency, IANA time zone, and metric/imperial units) can be updated by the Company Admin from the checklist. Employees are added using existing Company Membership APIs; there is no email invitation system.

## API summary

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/api/companies/register` | Public | Validate and submit application, create administrator/company/membership/audit transactionally |
| GET | `/api/companies/registration/status` | Authenticated applicant | Read only own application reference/status/feedback |
| GET | `/api/admin/companies` | Super Admin | Search and filter companies; optional `reviewStatus` filter |
| GET | `/api/admin/companies/:id/registration` | Super Admin | Read application details for review |
| POST | `/api/admin/companies/:id/registration/review` | Super Admin | `{status, reason}` transition to under_review, verified, or rejected |
| POST | `/api/admin/companies/:id/activate` | Super Admin | Existing separate activation workflow; registration must be verified |
| GET | `/api/companies/:companyId/onboarding` | Active Company Admin | Read company setup checklist |
| PATCH | `/api/companies/:companyId/onboarding` | Active Company Admin | `{step, action}` where action is `complete`, `skip`, or `unskip` |
| GET/PATCH | `/api/companies/:companyId/settings` | Active Company Admin | Read or update company currency, time zone, and measurement units |

No caller-provided owner ID, company ID, membership role, or company status is accepted during public registration. Public status output omits identifiers and administrator PII. Company-specific onboarding requests require selected company context and active Company Admin role.

## Index deployment note

The Company model declares seven unique sparse single-field registration indexes: `registration.reference`, `registration.companyEmail`, `registration.administrator.email`, `registration.gstin`, `registration.pan`, `registration.cin`, and `registration.businessRegistrationNumber`. Optional identifier fields are omitted when empty so sparse indexes do not collide on empty strings. `Company` automatic index creation is disabled to avoid production-side schema index changes, and registration checks that all seven registration indexes are deployed; otherwise it fails closed with `REGISTRATION_INDEXES_NOT_READY`. This setting also means the existing Company `slug` unique index and `status` index must already exist or be deployed manually on a fresh database. Before rollout, use a read-only duplicate/index audit, review legacy data, and deploy indexes separately during maintenance. This task did not connect to a database or create indexes. The existing User unique email constraint remains relevant.

After duplicate preflight and approval, the corresponding manual `mongosh` commands are:

```javascript
db.companies.createIndex({ "registration.reference": 1 }, { unique: true, sparse: true });
db.companies.createIndex({ "registration.companyEmail": 1 }, { unique: true, sparse: true });
db.companies.createIndex({ "registration.administrator.email": 1 }, { unique: true, sparse: true });
db.companies.createIndex({ "registration.gstin": 1 }, { unique: true, sparse: true });
db.companies.createIndex({ "registration.pan": 1 }, { unique: true, sparse: true });
db.companies.createIndex({ "registration.cin": 1 }, { unique: true, sparse: true });
db.companies.createIndex({ "registration.businessRegistrationNumber": 1 }, { unique: true, sparse: true });
```

On a new database only, also verify/deploy the existing Company indexes if absent:

```javascript
db.companies.createIndex({ slug: 1 }, { unique: true });
db.companies.createIndex({ status: 1 });
```

These are deployment instructions only; do not run them until the target database is confirmed, duplicate combinations are resolved, and a backup/maintenance plan is approved.

## Remaining external configuration

- Review and approve the draft legal documents before commercial use.
- Configure email verification/OTP and notification delivery if required.
- Configure secure private file storage before accepting registration documents. The form does not upload files or expose public document URLs.
- Define operational retention, deletion, privacy request, support, and service-level procedures.
- Audit and deploy the new unique indexes before production use; do not enable automatic index creation as a shortcut.
- No government verification service is connected; submitted identifiers are not verified.

## Local walkthrough

1. Start a disposable local transaction-capable MongoDB replica set using [the local setup guide](LOCAL_MONGODB_REPLICA_SET_SETUP.md), then start the backend and frontend using the root README commands.
2. Open the frontend login page and select **Apply for a company workspace**.
3. Submit a unique test company and administrator email with all acknowledgements.
4. Sign in with the administrator email/password; confirm the registration status page shows the generated reference and `pending` status, and that the company cannot access operational APIs.
5. Sign in as the configured Super Admin, open Companies, inspect application details, mark under review, then verify with a reason.
6. Activate the verified company with a separate reason.
7. Sign in as the Company Admin and select the active company. Use the onboarding links to create actual company records in existing pages.

Do not use real customer data for this walkthrough. The opt-in real transaction test is `backend/test/companyRegistration.integration.test.js`; it requires `WAREFLOW_COMPANY_REGISTRATION_TEST_URI` pointing to a disposable loopback replica-set database whose name includes `wareflow_company_registration_test`. Without that variable Jest skips the suite. Mocked API tests do not establish live transaction behavior.

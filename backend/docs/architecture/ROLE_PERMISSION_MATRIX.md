# Role and Permission Matrix

This is the target authorization contract. The current implementation only has `superadmin`, `admin`, and `staff` user roles and per-user ownership; these target permissions do not exist until implemented and tested.

| Capability | Super Admin | Company Admin | Warehouse Manager | Operational Staff | Read-only Auditor |
|---|---|---|---|---|---|
| Manage platform settings/plans | All companies | No | No | No | No |
| Create/suspend companies | Yes, audited | No | No | No | No |
| View platform-wide metrics | Yes, audited | No | No | No | No |
| Manage company profile/members | Support/admin as policy permits, audited | Own company | No | No | Read own company if assigned |
| Invite/deactivate company users | No routine company admin by default | Own company | Assigned warehouse only if delegated | No | No |
| Assign warehouse access | Platform support only, audited | Own company warehouses | Assigned warehouses if delegated | No | No |
| Manage subscription/entitlements | Platform-level | View/manage own billing according to plan | No | No | Read if permitted |
| Manage catalog/categories/suppliers/customers | Platform support only, audited | Own company | Own company or assigned warehouse per policy | Read/use; no master edits by default | Read assigned scope |
| Manage warehouses/locations | Platform support only, audited | Own company | Assigned warehouse(s) | Use assigned locations | Read assigned scope |
| Purchase orders and receiving | Cross-company only via audited support path | Own company | Assigned warehouse | Execute assigned receiving tasks | Read assigned scope |
| Inventory adjustments | Audited support only | Own company with reason/approval policy | Assigned warehouse with permission | No direct adjustment unless specifically granted | Read assigned scope |
| Transfers | Cross-company support only | Own company | From/to warehouses only if authorized at both ends | Execute assigned task steps | Read assigned scope |
| Customer orders and fulfillment | Audited support only | Own company | Assigned warehouse | Pick/pack/ship assigned work | Read assigned scope |
| Returns and disposition | Audited support only | Own company | Assigned warehouse | Receive/inspect assigned returns | Read assigned scope |
| Reports | Platform reports, audited | Company-wide | Assigned warehouse(s) | Operational task views | Assigned read scope |
| Audit logs | Platform security/admin logs | Own-company logs, appropriately redacted | Assigned operational logs | Own relevant events if allowed | Assigned read scope |
| Delete company/user/data | Platform policy + safeguards, audited | Manage company users; retention policy applies | No | No | No |

## Enforcement rules

- Permissions are enforced in backend middleware/services for every operation; hiding a button is not authorization.
- Company Admin is not a global `admin` role. It must be tied to an active membership and a company scope.
- Warehouse access is evaluated against the target record’s warehouse. For a transfer, actor must have authority for both source and destination warehouses, or workflow must use an explicitly authorized central dispatcher.
- Read, create, update, delete, approve, adjust, export, and cross-tenant support access are distinct permissions where risk warrants.
- Company and warehouse identifiers from request bodies/query strings are selectors only; the server verifies membership and record relationships before use.
- Super Admin cross-tenant operations require a separate explicit policy, audit entry, reason, and least privilege. Read-only support view is the default.
- Deactivation revokes active access promptly; outstanding sessions and jobs must be invalidated or rechecked.
- All role changes and permission grants are audited with actor, target, old/new values, reason, and timestamp.

## Current-to-target mapping

- Existing `superadmin` maps to platform Super Admin after provisioning review.
- Existing `admin` must not automatically become Company Admin until an explicit company mapping and owner approval are established.
- Existing `staff` maps to a company membership role only through reviewed ownership migration; warehouse assignments need explicit mapping.
- A normal user may need an initial Company Admin membership for their current personal workspace, but that conversion must be an explicit migration rule, not an inferred privilege escalation.

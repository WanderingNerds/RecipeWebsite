# REW-71 Admin Feedback Management QA

## Scope

This report covers the restarted implementation built from the clean merged REW-70 baseline. Results from the earlier scrapped REW-71 attempt are historical only and are not counted as current acceptance evidence.

## Current results

- Final reviewer: approved; no blocking code-review findings remain.
- Full Node suite in a listener-capable environment: 185/185 passed, zero skipped.
- `git diff --check`: passed.
- HTTP and security smoke: passed.
- CSRF: tokenless/invalid unsafe requests rejected and paired urlencoded/JSON requests accepted through real router chains.
- Multipart: validation runs after Multer exposes `_csrf`; invalid token rejected and valid token accepted.
- Authentication/logout: isolated auth-client configuration, admin/regular denial behavior, caller-bound POST logout, refresh claim checks, and GET logout removal pass.
- Fetch wrapper: same-origin unsafe requests receive CSRF; safe overrides and cross-origin requests do not.
- Migration semantics/contracts: intake owner/new/unassigned policy, admin claim policies, workflow-column-only grants, real-profile checks, OLD/NEW active-assignee enforcement, and non-duplicated migration 014 indexes pass static/contract checks.

## Blocked live acceptance

The configured Supabase project does not contain the required REW-70/REW-71 tables or migrations 014/015, and safe admin, regular-user, active-profile, and inactive-profile fixtures are unavailable. Therefore live database and browser acceptance did not run and is not marked passed.

After deployment, verify direct RLS/grant behavior for ordinary/admin users, forced intake fields, immutable submission content, inactive/new/unchanged assignment behavior, status changes, token refresh/logout, queue/detail/filter rendering, and desktop/mobile keyboard behavior.

# Admin Help & Feedback Management (REW-71 restart)

This is the current implementation rebuilt from the clean merged REW-70 baseline. The earlier local REW-71 attempt was intentionally discarded; its review findings were retained as constraints, not treated as shipped code or QA evidence.

## Routes

| Method | Route | Authentication and behavior |
| --- | --- | --- |
| `GET` | `/admin/login` | Public administrator sign-in form. |
| `POST` | `/admin/login` | CSRF-protected and limited to 10 attempts per 15 minutes. A fresh non-persisting Supabase client signs in, then verifies `app_metadata.role === "admin"`. Failure and non-admin denial use the same generic message and clear local/new auth state. Success sets secure cookies and redirects with 303. |
| `POST` | `/admin/logout` | Binds the caller's access/refresh tokens to a fresh client before sign-out, always clears local cookies, and redirects with 303. There is no GET logout route. |
| `GET` | `/admin/feedback` | Requires `requireAdmin`. Lists newest-first. `?status=` accepts `all`, `unresolved` (default: `new` plus `in_progress`), or `done`; invalid filters default to unresolved. |
| `GET` | `/admin/feedback/:id` | Requires an admin and UUID. Shows escaped submission details, active profiles, and any inactive current assignee. Missing rows return 404. |
| `POST` | `/admin/feedback/:id` | Requires admin, CSRF, UUID, allowlisted status, and blank/UUID assignee. Newly selected profiles must be active. Updates only status/assignment and redirects with 303. |

## Authorization and session isolation

`requireAdmin` verifies the access token through Supabase on every protected request. A successful refresh rotates cookies and rechecks the refreshed user's trusted claim. Anonymous users are redirected to `/admin/login`; verified regular users receive a 403 redirect without protected content.

Every admin login, refresh, and logout uses a fresh client configured with `persistSession: false`, `autoRefreshToken: false`, and `detectSessionInUrl: false`. Data reads/updates use a separate client scoped to the verified request token, preserving Supabase RLS. Navigation visibility is only a convenience and public registration cannot set the trusted claim.

## Database enforcement

- Migration 015 creates `admin_profiles` and adds nullable `assignee_id` plus `new`, `in_progress`, and `done` workflow states.
- The replaced intake policy requires the caller's own user ID, `new` status, and no assignment.
- Admin RLS checks signed `app_metadata.role`; authenticated UPDATE grants include only `status` and `assignee_id`.
- Non-null assignment must reference a real profile. An OLD/NEW-aware trigger requires `active = TRUE` only when assignment changes, so a status-only save may retain an inactive current assignee.
- Migration 014's chronological/status indexes are reused; migration 015 adds only the assignee index.

## CSRF behavior

Unsafe non-multipart requests are protected application-wide by double-submit CSRF validation. Server-rendered forms submit `_csrf`; same-origin fetch requests receive `x-csrf-token` through the shared wrapper. Multipart routes defer validation until after Multer parses `_csrf`. The CSRF cookie is HTTP-only, `SameSite=Lax`, and secure in production.

## Deployment and live acceptance

Apply migrations 014 and 015 in order. Provision admin/regular users plus active and inactive admin profiles in a safe environment. Refresh the admin token after setting `app_metadata.role = "admin"`.

Local/static QA passes 185/185 with zero skips in a listener-capable environment. CSRF, auth isolation, logout, fetch, multipart, migration smoke, and contract checks pass. Live Supabase/browser acceptance is blocked because the configured project lacks the required tables/migrations and safe fixtures; live QA is not claimed.

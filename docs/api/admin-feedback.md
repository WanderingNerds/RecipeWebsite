# Admin Help & Feedback Management (REW-71 restart)

This is the current implementation rebuilt from the clean merged REW-70 baseline. The earlier local REW-71 attempt was intentionally discarded; its review findings were retained as constraints, not treated as shipped code or QA evidence.

## Routes

| Method | Route | Authentication and behavior |
| --- | --- | --- |
| `GET` | `/admin/login` | Public administrator sign-in form. |
| `POST` | `/admin/login` | CSRF-protected and limited to 10 attempts per 15 minutes. A fresh non-persisting Supabase client signs in, then verifies `app_metadata.role === "admin"`. Failure and non-admin denial use the same generic message and clear local/new auth state. Success sets secure cookies and redirects with 303. |
| `POST` | `/admin/logout` | Binds the caller's access/refresh tokens to a fresh client before sign-out, always clears local cookies, and redirects with 303. There is no GET logout route. |
| `GET` | `/admin/feedback` | Requires `requireAdmin`. Lists newest-first. `?status=` accepts `all`, `unresolved` (default: `new` plus `in_progress`), or `done`; invalid filters default to unresolved. |
| `GET` | `/admin/feedback/:id` | Requires an admin and UUID. Shows escaped submission details and exactly Unassigned, Andrew, and Victoria as assignment choices when each explicitly recognized profile is uniquely active. Missing rows return 404. |
| `POST` | `/admin/feedback/:id` | Requires admin, CSRF, UUID, allowlisted status, and blank/UUID assignee. A selected profile must be active and match an explicit server-side name for Andrew or Victoria. Updates only status/assignment and redirects with 303. |

## Assignment notifications (REW-78)

Andrew maps server-side to `carroll.andrew@gmail.com`; Victoria maps server-side to `vhobbs1895@gmail.com`. Active profiles stored as either `Andrew` or `Andrew Carroll` render as Andrew; profiles stored as either `Victoria` or `Victoria Johnson` render as Victoria. These are explicit exact aliases—substring or fuzzy matching is not used—and multiple matching active rows are rejected as ambiguous. The browser submits only a profile UUID and cannot override either address. A transition from unassigned or the other person sends one plain-text email to the newly assigned person after the database update succeeds. Unassignment, same-assignee saves, validation failures, profile lookup failures, and database failures send no email.

Migration 016 provisions the two required `admin_profiles` rows from existing Supabase Auth users by exact case-insensitive email. It requires their trusted Auth role to already be `admin`, sets canonical short display names and `active = TRUE`, and safely repairs those fields on repeated runs. It does not grant administrator access or change RLS.

The email identifies the ticket by subject and UUID and links to `${APP_URL}/admin/feedback/:id`. Links are built only from server environment configuration, never request host headers. Delivery uses Resend and requires `RESEND_API_KEY` and `ASSIGNMENT_EMAIL_FROM`; requests time out after five seconds. Provider, network, timeout, or configuration failure does not roll back the saved assignment. It produces a non-sensitive administrator warning and safe metadata-only server log.

Deployment smoke test: configure the three variables, verify the Resend sender, assign a test ticket to Andrew and Victoria in turn, and confirm each recipient receives only their reassignment with the correct direct link. Then confirm same-assignee saves and Unassigned send nothing. Temporarily use an invalid provider key to confirm the assignment remains saved while the delivery warning appears.

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

Apply migrations 014, 015, and 016 in order. Set the trusted `app_metadata.role = "admin"` on Andrew and Victoria's existing Auth users before migration 016; the migration only provisions their assignment profiles and does not grant access. Provision additional safe regular/inactive fixtures separately for acceptance testing, then refresh the admin token after changing Auth metadata.

Local/static QA passes 185/185 with zero skips in a listener-capable environment. CSRF, auth isolation, logout, fetch, multipart, migration smoke, and contract checks pass. Live Supabase/browser acceptance is blocked because the configured project lacks the required tables/migrations and safe fixtures; live QA is not claimed.

# Release Notes: REW-54 - Replace Resend Confirmation Link with Forgot Password Account Recovery

**Date:** 2026-09-06
**Jira Issue:** [REW-54](https://wanderingnerds.atlassian.net/browse/REW-54)
**Branch:** `REW-54-forgot-password-account-recovery`
**Pipeline:** Planner → Developer → Reviewer (approved, non-blocking follow-ups only) → QA. See QA's report for pass/fail detail on the plan's acceptance criteria (`docs/plans/rew-54-forgot-password-account-recovery.md`).

---

## Summary

QA found that the Sign In page's only account-recovery affordance was "Need a new confirmation email? Resend it" — a user who forgot their password had no way to reset it. This release replaces that link with "Forgot Password?", which opens a new centralized account-recovery page (`/auth/forgot-password`). From a single email field, the user can either request a password-reset email (new, built on Supabase Auth's `resetPasswordForEmail`) or resend the confirmation email (existing functionality, unchanged, just re-entered from the new page). A new route pair, `GET`/`POST /auth/reset-password`, handles the emailed recovery link and the "set a new password" form. No database changes were required — this is built entirely on Supabase Auth's existing password-recovery and OTP-verification APIs.

---

## User-Facing Changes

- The Sign In page no longer shows "Need a new confirmation email? Resend it." In the same position, it now shows "Forgot Password?"
- Clicking "Forgot Password?" opens `/auth/forgot-password`, a single page with one email field and two actions: "Send Password Reset Email" and "Resend Confirmation Email."
- Logging in with an unconfirmed email now redirects to `/auth/forgot-password?email=...` (pre-filled) instead of the old standalone resend page.
- The old `/auth/resend-confirmation` URL still works — it now redirects to `/auth/forgot-password`, forwarding the `email` query parameter, so nothing that linked to the old page breaks.
- Clicking the password-reset link in the email leads to `/auth/reset-password`, where the user sets a new password (minimum 8 characters, must be confirmed). On success, they're signed out of the recovery session and sent to `/auth/login` to sign in with the new password.
- An expired or already-used reset link shows "This password reset link is invalid or has expired. Please request a new one." and returns the user to the recovery page rather than erroring or granting access.
- Requesting a password reset for an email that isn't registered shows the same generic success message as for a registered email — no account-enumeration leak, matching the existing resend-confirmation behavior.
- Sign In and Create an Account are otherwise unaffected — "Welcome back," Email, Password, Sign in button, and "New here? Create an account" behave exactly as before.

---

## Technical Changes

### `src/utils/authUtils.js`
- New exported constant `RECOVERY_OTP_TYPE = "recovery"`, kept separate from `ALLOWED_OTP_TYPES` (`["signup", "email"]`) so a password-recovery OTP can never be accepted by `/auth/callback` and log a user straight into `/dashboard` — it must always land on the "set a new password" form.
- New co-located test, `src/utils/authUtils.test.js`, asserts `RECOVERY_OTP_TYPE` is not included in `ALLOWED_OTP_TYPES`.

### `src/routes/authRoutes.js`
- `POST /login`'s unconfirmed-email branch now redirects to `/auth/forgot-password?email=...` instead of `/auth/resend-confirmation?email=...`.
- New `GET /auth/forgot-password` (`redirectIfAuthenticated`): renders the recovery page, optionally pre-filled from `?email=`.
- New `POST /auth/forgot-password` (`redirectIfAuthenticated`): calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${APP_URL}/auth/reset-password\` })`; always shows the same enumeration-safe generic success flash and redirects to `/auth/login`, regardless of whether the email exists or Supabase errors.
- `GET /auth/resend-confirmation` now `302` redirects to `/auth/forgot-password` (forwarding `?email=`) instead of rendering its own page. `POST /auth/resend-confirmation` is unchanged.
- New `GET /auth/reset-password`: validates `token_hash` + `type === "recovery"`, calls `verifyOtp()`; on success sets auth cookies plus a short-lived (1 hour), httpOnly `recovery-session` marker cookie and renders the "set a new password" form; on failure flashes an invalid/expired message and redirects to `/auth/forgot-password`.
- New `POST /auth/reset-password` (`requireAuth`): requires the `recovery-session` marker cookie; validates the new password (same `>= 8` character / match rule as registration); updates it via a **freshly-instantiated per-request Supabase client** (`createSupabaseClient(req.accessToken)`, not the shared module-level singleton) using `setSession()` then `auth.updateUser({ password })`; on success clears auth + marker cookies and redirects to `/auth/login`.

### `src/middleware/authMiddleware.js`
- `requireAuth` now attaches `req.refreshToken` on every success path, not just the token-refresh branch. This fixes a bug where a stale/rotated refresh-token cookie could be paired with a freshly-refreshed access token, causing spurious "session expired" failures — surfaced during development of the password-reset flow, which depends on both tokens being consistent for `setSession()`.

### Views
- `views/auth/login.ejs` — "Need a new confirmation email? Resend it" replaced with "Forgot Password?" in the same position; rest of the page unchanged.
- `views/auth/forgot-password.ejs` (new) — single email field, two `formaction` submit buttons (no JavaScript required) posting to `/auth/forgot-password` and `/auth/resend-confirmation` respectively, plus a "Back to Sign In" link.
- `views/auth/reset-password.ejs` (new) — Password + Confirm Password fields, "Update Password" button.
- `views/auth/resend-confirmation.ejs` — removed (superseded by `forgot-password.ejs`).

### Database
None. Entirely built on Supabase Auth's managed `resetPasswordForEmail`, `verifyOtp`, and `updateUser` APIs — no new tables, columns, or RLS changes.

---

## Known Non-Blocking Follow-Ups (flagged by Reviewer, not fixed in this pass)

1. **`recovery-session` marker cookie is presence-only**, not a random single-use token tied to the specific OTP verification, and it isn't cleared on login/register. On a shared/public browser, a stale marker cookie could theoretically let a subsequent *authenticated* user's own password-change request skip the "came from a recovery email" check within the 1-hour cookie lifetime. Recommended follow-up: make it a random, server-verified single-use token, cleared on login/register too.
2. **No route-specific rate limiting** on `/auth/forgot-password` or `/auth/resend-confirmation` — only the app-wide general limiter (100 req/15 min/IP, production only) applies. Pre-existing gap for resend-confirmation, now doubled in surface. Recommended as a follow-up ticket.
3. **CSRF protection remains globally disabled** app-wide (pre-existing, `src/app.js`, unrelated to this ticket). The new forms include `_csrf` hidden fields for when it's re-enabled, but the field is currently a no-op.

---

## Breaking Changes

None for end users. `GET /auth/resend-confirmation` changes from rendering a page to issuing a `302` redirect — any external bookmark/link to that exact URL still resolves correctly, just via an extra hop.

---

## Deployment

**Required infrastructure step (not part of this code change):** In the Supabase Dashboard, under **Settings > Authentication > URL Configuration > Redirect URLs**, add `${APP_URL}/auth/reset-password` alongside the existing `${APP_URL}/auth/callback` entry, for both the development and production `APP_URL` values. Without this, Supabase will reject or silently mis-redirect the password-reset link.

- No database migrations.
- No new environment variables (reuses the existing `APP_URL`).
- No new external services or middleware changes.

---

## Testing

`npm test`: 79/79 passing (78 pre-existing + 1 new test in `src/utils/authUtils.test.js` asserting `RECOVERY_OTP_TYPE` is excluded from `ALLOWED_OTP_TYPES`). This repo has no request-level/integration test harness for routes, so the acceptance criteria in `docs/plans/rew-54-forgot-password-account-recovery.md` (AC1–AC10, plus the additional bullet items) require manual/QA verification against a real or dev Supabase project. See the QA agent's report for the executed checklist and results.

---

## Documentation

- `docs/api/email-confirmation.md` — retitled to cover both REW-41 and REW-54; added a password-recovery flow diagram, formal endpoint documentation for `GET`/`POST /auth/forgot-password` and `GET`/`POST /auth/reset-password` (request/response/error tables matching the existing style), a "Known Limitations / Non-Blocking Follow-Ups" section, updated Configuration/Redirect-URL guidance, updated Related Files (including the `authMiddleware.js` fix and the new `authUtils.test.js`), and an expanded Testing Checklist.
- `docs/api/README.md` — Authentication endpoint table updated with the new `/auth/forgot-password` and `/auth/reset-password` routes and the changed behavior of `GET /auth/resend-confirmation`; Detailed Documentation list entry updated.
- `README.md` — new feature bullet under "Authentication" describing the Forgot Password / Account Recovery flow; Supabase Setup section's Redirect URLs guidance updated to include `/auth/reset-password` alongside `/auth/callback`. (These edits were already present in the branch at documentation time — verified against the current code and left as-is.)
- `docs/RELEASE_NOTES_REW-54.md` (this file) — full release notes.
- No `database/README.md` changes — no schema/data changes.
- No `design_handoff_recipe_form/README.md` changes — this change does not touch the recipe form.
- Confluence: recommended target is the existing "REW-41: Fix Broken Email Confirmation Link" page (see `docs/confluence/REW-41-email-confirmation-fix.md` for this repo's markdown mirror), which should be updated in place rather than forked, plus a new dedicated "Release: REW-54 - Forgot Password Account Recovery" page. **Atlassian MCP tools were not available as callable tools in this documentation session** (consistent with the same gap noted in the REW-52/REW-53 documentation sessions) — see `docs/confluence/REW-54-forgot-password-account-recovery.md` for the drafted section content and standalone release-notes page content, ready to post once access is available. No attempt was made to comment on or transition the REW-54 Jira issue for the same reason; see `docs/confluence/JIRA_COMMENT_REW-54.md` for the drafted comment.

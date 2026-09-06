# REW-41: Fix Broken Email Confirmation Link

**Space:** Recipe Website
**Status:** Complete
**Jira Issues:** [REW-41], [REW-54]

**Update (REW-54, 2026-09-06):** The standalone Resend Confirmation page and link have been superseded by a new centralized account-recovery page, `/auth/forgot-password`, which also adds a self-service "forgot password" flow. See the new "REW-54: Forgot Password / Account Recovery" section below — this page now documents both tickets since REW-54 directly extends and partially supersedes the REW-41 implementation.

---

## Overview

This page documents the implementation of the email confirmation fix (REW-41), plus the Forgot Password / Account Recovery flow (REW-54) that later replaced its standalone resend page. Users were previously unable to complete registration because confirmation emails contained broken links. This fix implements proper email confirmation handling with a callback endpoint, resend functionality, and improved security. REW-54 then added password-reset self-service and folded the resend action into one centralized recovery page.

---

## Problem

After user registration, Supabase Auth sends a confirmation email containing a verification link. This link was broken because:

1. No callback handler existed at `/auth/callback` to process the confirmation
2. The `emailRedirectTo` parameter was not set in the signup flow
3. Users had no way to request a new confirmation email if the link expired

---

## Solution Architecture

```
User Registration Flow:
+------------------+     +------------------+     +------------------+
|   /auth/register | --> |  Supabase Auth   | --> |   User Email     |
|   (signup call)  |     | (sends email)    |     | (confirmation)   |
+------------------+     +------------------+     +------------------+
                                                          |
                                                          v
+------------------+     +------------------+     +------------------+
|   /dashboard     | <-- | /auth/callback   | <-- |  Click Link      |
| (authenticated)  |     | (verifyOtp)      |     |  in email        |
+------------------+     +------------------+     +------------------+
```

---

## Implementation Details

### 1. Callback Handler (`/auth/callback`)

Processes email confirmation redirects from Supabase:

- Extracts `token_hash` and `type` from query parameters
- Validates `type` is in allowed list (`signup`, `email`)
- Calls `supabase.auth.verifyOtp()` for secure validation
- Sets HTTP-only session cookies on success
- Redirects to dashboard or shows error

**Security:** Only accepts specific OTP types to prevent callback misuse.

### 2. Resend Confirmation (`/auth/resend-confirmation`)

Allows users to request a new confirmation email:

- GET: **Changed in REW-54** — no longer shows its own form; now `302` redirects to `/auth/forgot-password` (forwarding `?email=`), since that page's "Resend Confirmation Email" action covers the same need.
- POST: Unchanged — still calls `supabase.auth.resend()` API directly.
- Does not reveal if email exists (security)

### 3. SignUp Flow Update

Added `emailRedirectTo` option:

```javascript
const appUrl = process.env.APP_URL || "http://localhost:3000";
const emailRedirectTo = `${appUrl}/auth/callback`;

await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo,
  },
});
```

### 4. Login Flow Enhancement

Detects unconfirmed email and redirects:

```javascript
if (error.message.toLowerCase().includes("email not confirmed")) {
  return res.redirect(`/auth/forgot-password?email=${encodeURIComponent(email)}`); // updated in REW-54; previously /auth/resend-confirmation
}
```

### 5. Auth Utilities (`src/utils/authUtils.js`)

Extracted cookie management for reuse:

| Function | Purpose |
|----------|---------|
| `setAuthCookies(res, session)` | Sets HTTP-only auth cookies |
| `clearAuthCookies(res)` | Clears auth cookies on logout |
| `ALLOWED_OTP_TYPES` | Valid OTP types for callback (`signup`, `email`) |
| `RECOVERY_OTP_TYPE` (REW-54) | The `"recovery"` OTP type used by password-reset links; kept separate from `ALLOWED_OTP_TYPES` so `/auth/callback` never accepts a recovery token |

---

## REW-54: Forgot Password / Account Recovery

QA found that the Sign In page's only account-recovery affordance was "Need a new confirmation email? Resend it" — there was no way for a user who forgot their password to reset it. This work replaces that link with "Forgot Password?", which opens a new centralized account-recovery page (`GET /auth/forgot-password`). That page collects one email address and offers two actions from a single form (via HTML `formaction`, no JavaScript required):

- **Send Password Reset Email** — new functionality, built on Supabase Auth's `resetPasswordForEmail()` API. Submits to `POST /auth/forgot-password`. Enumeration-safe: always shows the same generic success message ("If an account exists with this email, a password reset link has been sent.") regardless of whether the email exists or Supabase returns an error.
- **Resend Confirmation Email** — the pre-existing functionality documented above under "Resend Confirmation," reused unchanged and simply re-entered from this page instead of its own dedicated page.

A new route pair, `GET`/`POST /auth/reset-password`, handles the incoming Supabase recovery-link click (`type=recovery` OTP verification, mirroring the `verifyOtp()` pattern used by `/auth/callback` for signup confirmation) and the subsequent "set a new password" form submission:

- `GET /auth/reset-password` validates `token_hash` and `type === "recovery"`, calls `verifyOtp()`. On success it sets auth session cookies plus a short-lived (1 hour), httpOnly `recovery-session` marker cookie, and renders the "set a new password" form. On failure/expiry it flashes an error and redirects back to `/auth/forgot-password`.
- `POST /auth/reset-password` requires `requireAuth` and the `recovery-session` marker cookie (so an already-logged-in user can't reach it without going through the recovery-email link). It validates the new password (same `>= 8` character rule as registration), updates it via a **freshly-instantiated per-request Supabase client** (`createSupabaseClient(req.accessToken)`, not the shared module-level singleton) using `setSession()` then `updateUser({ password })`, then clears the session/marker cookies and redirects to `/auth/login` so the user signs in fresh.

**Also fixed as part of REW-54:** `src/middleware/authMiddleware.js`'s `requireAuth` now attaches `req.refreshToken` on every success path (previously only on the token-refresh branch). This closed a bug where a stale/rotated refresh-token cookie could be paired with a freshly-refreshed access token, causing spurious "session expired" failures — surfaced while building the password-reset flow, which needs both tokens to be consistent for `setSession()`.

**New Supabase Dashboard configuration required:** add `{APP_URL}/auth/reset-password` to **Settings > Authentication > URL Configuration > Redirect URLs**, alongside the existing `{APP_URL}/auth/callback` entry — see the updated Configuration section below.

**Known non-blocking follow-ups (flagged in review, tracked as future work, not fixed in REW-54):**
1. The `recovery-session` marker cookie is presence-only rather than a random, single-use, server-verified token tied to the specific OTP verification, and it isn't cleared on login/register.
2. Neither `/auth/forgot-password` nor `/auth/resend-confirmation` has route-specific rate limiting (only the app-wide general limiter applies).
3. CSRF protection remains globally disabled app-wide (pre-existing, unrelated to REW-54) — the new forms include `_csrf` fields for when it's re-enabled.

---

## Configuration

### Environment Variable

| Variable | Production | Development |
|----------|------------|-------------|
| `APP_URL` | `https://your-domain.com` | `http://localhost:3000` (default) |

### Supabase Dashboard

In **Settings > Authentication > URL Configuration**:

1. **Site URL**: `https://your-domain.com`
2. **Redirect URLs**:
   - `https://your-domain.com/auth/callback`
   - `http://localhost:3000/auth/callback`
   - `https://your-domain.com/auth/reset-password` (REW-54)
   - `http://localhost:3000/auth/reset-password` (REW-54)

---

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `src/routes/authRoutes.js` | Modified (REW-41, REW-54) | Added callback, resend routes; updated login (REW-41); added `/auth/forgot-password` + `/auth/reset-password`, changed `GET /auth/resend-confirmation` to a redirect (REW-54) |
| `src/middleware/authMiddleware.js` | Modified (REW-41, REW-54) | Uses setAuthCookies utility (REW-41); `requireAuth` now attaches `req.refreshToken` on every success path (REW-54 bug fix) |
| `src/utils/authUtils.js` | Modified (REW-41 new, REW-54 modified) | Cookie utilities and OTP types (REW-41); added `RECOVERY_OTP_TYPE` constant (REW-54) |
| `src/utils/authUtils.test.js` | New (REW-54) | Unit test asserting `RECOVERY_OTP_TYPE` is excluded from `ALLOWED_OTP_TYPES` |
| `views/auth/resend-confirmation.ejs` | New (REW-41), Removed (REW-54) | Resend form UI; superseded by `forgot-password.ejs` |
| `views/auth/forgot-password.ejs` | New (REW-54) | Centralized recovery page — email field + reset/resend actions |
| `views/auth/reset-password.ejs` | New (REW-54) | "Set a new password" form shown after a valid recovery link |
| `views/auth/login.ejs` | Modified (REW-41, REW-54) | Added resend link (REW-41); replaced with "Forgot Password?" link (REW-54) |
| `README.md` | Modified (REW-41, REW-54) | Documented APP_URL (REW-41); added Forgot Password feature bullet and reset-password redirect URL (REW-54) |
| `docs/api/email-confirmation.md` | Modified (REW-54) | Added password-recovery flow diagram, endpoint docs, and known-limitations section |

---

## Security Measures

1. **OTP Type Whitelist**: Only `signup` and `email` types allowed for `/auth/callback`; `recovery` type is handled exclusively by `/auth/reset-password` (REW-54)
2. **HTTP-only Cookies**: Session tokens not accessible to JavaScript
3. **Secure Flag**: Cookies secure in production
4. **SameSite Lax**: CSRF protection for cookies
5. **Email Enumeration Prevention**: Generic responses on resend and on password-reset requests (REW-54)
6. **Recovery-session marker cookie (REW-54)**: `POST /auth/reset-password` requires a short-lived, httpOnly `recovery-session` cookie set only by a successful `GET /auth/reset-password` verification, so an already-logged-in user can't reach the password-update endpoint without the recovery-email link. *Known limitation:* this cookie is presence-only, not a random single-use token — see follow-ups above.

---

## Testing Notes

| Test Case | Expected Result | Status |
|-----------|-----------------|--------|
| Register new user | Confirmation email sent | Pass |
| Click confirmation link | User logged in, redirected to dashboard | Pass |
| Expired link | Error message, redirect to login | Pass |
| Invalid token | Generic error, redirect to login | Pass |
| Resend confirmation | New email sent | Pass |
| Login unconfirmed | Redirect to `/auth/forgot-password` with email pre-filled (REW-54) | Pass |
| Forgot Password page renders (REW-54) | One email field, two actions | Pass (code review); manual/QA verification against a live Supabase project recommended before production sign-off |
| Send Password Reset Email (REW-54) | Generic success message shown regardless of registered/unregistered email | Pass (code review); manual/QA verification recommended |
| Reset-password link verification (REW-54) | Valid link renders "set a new password" form; expired/invalid link redirects with error | Pass (code review); manual/QA verification recommended |
| Set new password end-to-end (REW-54) | Old password stops working, new password works at `/auth/login` | Pass (code review); manual/QA verification recommended |
| `npm test` regression | 79/79 passing (78 pre-existing + 1 new) | Pass |

*Note: this repo has no request-level/integration test harness for routes, so the REW-54 rows above reflect code-review verification of the implementation logic. A full manual/QA pass against a real or dev Supabase project (per `docs/plans/rew-54-forgot-password-account-recovery.md`'s acceptance criteria) is recommended before/alongside production release if not already completed.*

---

## Deployment Checklist

- [ ] Set `APP_URL` environment variable in Vercel
- [ ] Update Supabase URL Configuration (add `/auth/reset-password` alongside `/auth/callback`, REW-54)
- [ ] Deploy application
- [ ] Test registration flow end-to-end
- [ ] Verify existing users can still log in
- [ ] Test Forgot Password flow end-to-end (request reset email, click link, set new password, sign in with new password) (REW-54)
- [ ] Verify old `/auth/resend-confirmation` bookmarks/links still resolve via redirect (REW-54)

---

## Related Pages

- [Authentication System Overview]
- [Supabase Integration Guide]
- [Environment Variables Reference]
- Release: REW-54 - Forgot Password Account Recovery (new page, see `docs/confluence/REW-54-forgot-password-account-recovery.md`)

---

**Last Updated:** 2026-09-06
**Author:** Documentation Team (REW-54 update)

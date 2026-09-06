# Email Confirmation & Account Recovery Flow (REW-41, REW-54)

This document describes the email confirmation system for user registration, including the callback handler, resend functionality, and security considerations. It also covers the Forgot Password / Account Recovery flow (REW-54) that supersedes the standalone resend-confirmation page.

---

## Overview

When a user registers, Supabase Auth sends a confirmation email containing a verification link. This link redirects to the `/auth/callback` endpoint, which validates the token and establishes a user session.

---

## Flow Diagram

```
1. User registers at /auth/register
   |
   v
2. Supabase sends confirmation email with link to:
   {APP_URL}/auth/callback?token_hash=xxx&type=signup
   |
   v
3. User clicks link in email
   |
   v
4. /auth/callback validates token via verifyOtp()
   |
   +-- Success --> Set session cookies --> Redirect to /dashboard
   |
   +-- Failure --> Flash error --> Redirect to /auth/login
```

### Password Recovery Flow Diagram (REW-54)

```
1. User clicks "Forgot Password?" on /auth/login
   (or is redirected there automatically on an "email not confirmed" login attempt)
   |
   v
2. GET /auth/forgot-password renders the recovery page (one email field)
   |
   v
3. User submits "Send Password Reset Email" --> POST /auth/forgot-password
   |
   v
4. Supabase sends a password-reset email with link to:
   {APP_URL}/auth/reset-password?token_hash=xxx&type=recovery
   (generic success message shown regardless of whether the email exists)
   |
   v
5. User clicks link in email --> GET /auth/reset-password
   |
   +-- Valid token  --> verifyOtp() sets session + recovery-session marker
   |                    cookie --> render "set a new password" form
   |
   +-- Invalid/expired --> Flash error --> Redirect to /auth/forgot-password
   |
   v
6. User submits new password --> POST /auth/reset-password (requireAuth +
   recovery-session cookie)
   |
   +-- Success --> updateUser() via per-request Supabase client --> clear
   |               session cookies --> Redirect to /auth/login
   |
   +-- Failure --> Re-render form with inline error
```

---

## Endpoints

### GET /auth/callback

Handles the email confirmation redirect from Supabase.

**Authentication:** None required (public endpoint)

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token_hash` | string | Yes | The OTP token hash from the confirmation email |
| `type` | string | Yes | The OTP type (must be `signup` or `email`) |

**Success Response:**
- Sets HTTP-only session cookies (`sb-access-token`, `sb-refresh-token`)
- Flash message: "Email confirmed successfully!"
- Redirects to `/dashboard`

**Error Responses:**

| Scenario | Flash Message | Redirect |
|----------|---------------|----------|
| Missing or invalid parameters | "Invalid confirmation link. Please request a new confirmation email." | `/auth/login` |
| Token expired or invalid | "Email confirmation failed. The link may have expired." | `/auth/login` |
| Server error | "An error occurred during email confirmation. Please try again." | `/auth/login` |

**Security Notes:**
- Only allows `type` values of `signup` or `email` (defined in `ALLOWED_OTP_TYPES`)
- Uses Supabase's `verifyOtp()` for secure server-side validation
- Does not expose token details in error messages

---

### GET /auth/resend-confirmation

**Updated in REW-54:** This standalone page has been superseded by the centralized account-recovery page. This route now `302` redirects to `/auth/forgot-password`, forwarding any `?email=` query parameter, so old links still go somewhere sensible instead of 404ing.

**Authentication:** Redirects authenticated users to home page

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | No | Forwarded to `/auth/forgot-password?email=...` |

**Response:** `302` redirect to `/auth/forgot-password` (with `?email=` if present)

---

### POST /auth/resend-confirmation

Sends a new confirmation email to the specified address.

**Authentication:** Redirects authenticated users to home page

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | The email address to send confirmation to |
| `_csrf` | string | Yes | CSRF token |

**Success Response:**
- Flash message: "Confirmation email sent! Please check your inbox." or "If an account exists with this email, a confirmation link has been sent."
- Redirects to `/auth/login`

**Error Response:**
- Flash message: "Email is required" (if email not provided)
- Flash message: "An error occurred. Please try again." (on server error)
- Redirects to `/auth/resend-confirmation`

**Security Notes:**
- Does not reveal whether an email address exists in the system
- Uses the same `emailRedirectTo` URL construction as registration
- Rate limited per general API rate limits

---

## Login Flow Integration

When a user attempts to log in with an unconfirmed email:

1. Login detects "email not confirmed" error from Supabase
2. Redirects to `/auth/forgot-password?email={email}` (updated in REW-54; previously `/auth/resend-confirmation`)
3. User sees the centralized recovery page, pre-filled, with a "Resend Confirmation Email" action alongside "Send Password Reset Email"
4. After sending, user is redirected to login page

---

## Forgot Password / Account Recovery (REW-54)

`/auth/resend-confirmation` is no longer a standalone destination page. It has been folded into a new centralized account-recovery page, `/auth/forgot-password`, which offers both recovery actions from a single email field:

- **Send Password Reset Email** — posts to `/auth/forgot-password`, which calls Supabase's `resetPasswordForEmail(email, { redirectTo: \`${APP_URL}/auth/reset-password\` })`. Like `POST /auth/resend-confirmation`, this always shows the same generic, enumeration-safe success message ("If an account exists with this email, a password reset link has been sent.") and redirects to `/auth/login`, regardless of whether the email exists or Supabase returns an error.
- **Resend Confirmation Email** — posts to the existing, unchanged `POST /auth/resend-confirmation` endpoint.

The password reset link Supabase emails the user leads to `GET /auth/reset-password?token_hash=...&type=recovery`, which validates the token with `verifyOtp()` (using a new `RECOVERY_OTP_TYPE = "recovery"` constant kept separate from `ALLOWED_OTP_TYPES`, so a recovery token can never be accepted by `/auth/callback` and log a user straight into the dashboard). On success it sets session cookies and renders the "set a new password" form (`auth/reset-password.ejs`); on failure/expiry it flashes "This password reset link is invalid or has expired. Please request a new one." and redirects back to `/auth/forgot-password`.

`POST /auth/reset-password` (requires the recovery-granted session) validates the new password (same `>= 8` character rule as registration), then updates it via a **freshly-instantiated Supabase client scoped to the request** (not the shared module-level client) using `setSession()` followed by `auth.updateUser({ password })`. On success it clears the recovery session cookies and redirects to `/auth/login` so the user signs in fresh with the new password.

**Supabase Dashboard requirement:** `${APP_URL}/auth/reset-password` must be added to Supabase's allow-listed Redirect URLs (Settings > Authentication > URL Configuration), alongside the existing `${APP_URL}/auth/callback` entry — see the updated Configuration section below.

### GET /auth/forgot-password

Renders the centralized account-recovery page.

**Authentication:** Redirects already-authenticated users to home page (`redirectIfAuthenticated`)

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | No | Pre-fills the email field (e.g. when arriving from the login page's unconfirmed-email redirect) |

---

### POST /auth/forgot-password

Sends a Supabase password-reset email.

**Authentication:** Redirects already-authenticated users to home page (`redirectIfAuthenticated`)

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | The email address to send the password-reset link to |
| `_csrf` | string | Yes | CSRF token (currently a no-op; see Security Notes in `README.md`) |

**Response (always, regardless of outcome):**
- Flash message: "If an account exists with this email, a password reset link has been sent."
- Redirects to `/auth/login`

**Error Response:**
- Flash message: "Email is required" (if email not provided) — redirects to `/auth/forgot-password`

**Security Notes:**
- Enumeration-safe: identical response whether or not the email exists, and even if Supabase returns an error (logged server-side only).
- Builds `redirectTo` as `${APP_URL}/auth/reset-password`, mirroring the `emailRedirectTo` pattern used for signup.

---

### GET /auth/reset-password

Verifies the Supabase password-recovery OTP from the emailed link and, on success, renders the "set a new password" form.

**Authentication:** None required to reach the route (it *establishes* the recovery session); publicly reachable but only functions with a valid `token_hash`/`type=recovery` pair from Supabase.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token_hash` | string | Yes | The OTP token hash from the password-reset email |
| `type` | string | Yes | Must equal `recovery` (`RECOVERY_OTP_TYPE`) — any other value is rejected |

**Success Response:**
- Sets HTTP-only session cookies (`sb-access-token`, `sb-refresh-token`) via `verifyOtp()`'s returned session
- Sets a short-lived (1 hour), httpOnly `recovery-session` marker cookie proving this session originated from a verified recovery link
- Renders `auth/reset-password.ejs` (no redirect)

**Error Responses:**

| Scenario | Flash Message | Redirect |
|----------|---------------|----------|
| Missing `token_hash` or `type !== "recovery"` | "This password reset link is invalid or has expired. Please request a new one." | `/auth/forgot-password` |
| `verifyOtp()` fails or returns no session | Same as above | `/auth/forgot-password` |
| Server error | Same as above | `/auth/forgot-password` |

---

### POST /auth/reset-password

Sets the new password on the recovery-granted session.

**Authentication:** `requireAuth` (valid `sb-access-token`/`sb-refresh-token` cookies from the `GET` step above) **and** the `recovery-session` marker cookie must be present — an already-logged-in user's normal session cannot reach this endpoint without having gone through the recovery-link verification first.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `password` | string | Yes | New password, minimum 8 characters (same rule as registration) |
| `confirmPassword` | string | Yes | Must match `password` |
| `_csrf` | string | Yes | CSRF token (currently a no-op) |

**Success Response:**
- Clears auth cookies and the `recovery-session` marker cookie
- Flash message: "Password updated successfully! Please sign in with your new password."
- Redirects to `/auth/login`

**Error Responses:**

| Scenario | Behavior |
|----------|----------|
| Missing `recovery-session` cookie | Flash "invalid or has expired" message, redirect to `/auth/forgot-password` |
| Missing/mismatched/too-short password | Re-renders `auth/reset-password.ejs` with an inline error (no redirect, to preserve the recovery session) |
| Session expired (`setSession` fails) | Re-renders with "Your session has expired. Please request a new password reset link." |
| Supabase `updateUser()` rejects (e.g. stricter project password policy) | Re-renders with Supabase's own error message |

**Implementation note:** Uses a freshly-instantiated Supabase client (`createSupabaseClient(req.accessToken)`, `src/config/supabase.js`) scoped to this request for `setSession()`/`updateUser()`, rather than the shared module-level `supabase` singleton, to avoid mutating session state on a client shared across concurrent requests.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_URL` | Yes (production) | `http://localhost:3000` | Base URL for email confirmation links |

### Supabase Dashboard Configuration

1. **Settings > Authentication > URL Configuration**
   - **Site URL**: Set to your production URL (e.g., `https://your-domain.com`)
   - **Redirect URLs**: Add all allowed callback and password-reset URLs:
     - Production: `https://your-domain.com/auth/callback`, `https://your-domain.com/auth/reset-password`
     - Development: `http://localhost:3000/auth/callback`, `http://localhost:3000/auth/reset-password`

---

## Utility Functions

### setAuthCookies(res, session)

Sets HTTP-only authentication cookies.

**Location:** `src/utils/authUtils.js`

**Parameters:**
- `res` - Express response object
- `session` - Supabase session object containing `access_token` and `refresh_token`

**Cookie Settings:**
| Cookie | Max Age | HttpOnly | Secure | SameSite |
|--------|---------|----------|--------|----------|
| `sb-access-token` | 1 hour | Yes | Yes (production) | lax |
| `sb-refresh-token` | 7 days | Yes | Yes (production) | lax |

### clearAuthCookies(res)

Clears authentication cookies on logout or session invalidation.

**Location:** `src/utils/authUtils.js`

### ALLOWED_OTP_TYPES

Array of valid OTP types for the callback handler.

**Location:** `src/utils/authUtils.js`

**Values:** `["signup", "email"]`

### RECOVERY_OTP_TYPE (REW-54)

The OTP type used for password recovery links. Kept intentionally separate from `ALLOWED_OTP_TYPES` so `/auth/callback` never accepts a recovery-type token; recovery tokens are only ever handled by `/auth/reset-password`.

**Location:** `src/utils/authUtils.js`

**Value:** `"recovery"`

---

## Error Handling

The callback handler catches and logs all errors to prevent exposing sensitive information:

```javascript
} catch (error) {
  console.error("Auth callback error:", error);
  req.flash("error", "An error occurred during email confirmation. Please try again.");
  return res.redirect("/auth/login");
}
```

---

## Known Limitations / Non-Blocking Follow-Ups (REW-54)

Flagged during review, not fixed in this ticket:

- **`recovery-session` marker cookie is presence-only.** It proves *a* recovery link was verified recently, but it's not a random, single-use token tied to the specific OTP verification, and it isn't cleared on login/register. On a shared/public browser, a stale marker cookie could theoretically let a *different* logged-in user's own password-change request skip the "came from a recovery email" check within the 1-hour cookie lifetime (they'd still need to be authenticated as themselves — this doesn't let one account touch another's password). Recommended follow-up: make it a random, server-verified single-use token, and clear it on login/register too.
- **No route-specific rate limiting** on `/auth/forgot-password` or `/auth/resend-confirmation` — only the app-wide general limiter (100 req/15 min/IP, production only) applies. This is a pre-existing gap for resend-confirmation; adding the new reset-request endpoint doubles the surface. Recommended as a follow-up ticket.
- **CSRF protection is globally disabled** (`src/app.js`, pre-existing, unrelated to this ticket — `doubleCsrfProtection` is commented out pending a library debugging fix). The new forms include `_csrf` hidden fields for when it's re-enabled, but the field is currently a no-op.

---

## Related Files

| File | Description |
|------|-------------|
| `src/routes/authRoutes.js` | Route handlers for callback, forgot-password, reset-password, and resend |
| `src/utils/authUtils.js` | Cookie utilities and OTP type validation (`ALLOWED_OTP_TYPES`, `RECOVERY_OTP_TYPE`); see `authUtils.test.js` for the co-located test asserting the two stay disjoint |
| `src/config/supabase.js` | `createSupabaseClient(accessToken)` — used by `POST /auth/reset-password` for a per-request client instance |
| `src/middleware/authMiddleware.js` | `requireAuth` gates `POST /auth/reset-password`; also fixed in REW-54 to attach `req.refreshToken` on every success path (previously only set on the token-refresh branch), preventing a stale/rotated refresh-token cookie from being paired with a freshly-refreshed access token and causing spurious "session expired" failures during password reset |
| `views/auth/forgot-password.ejs` | Centralized account-recovery page (REW-54; supersedes `resend-confirmation.ejs`) |
| `views/auth/reset-password.ejs` | "Set a new password" form shown after a valid recovery link (REW-54) |
| `views/auth/login.ejs` | Contains link to the Forgot Password page (REW-54) |

---

## Testing Checklist

- [ ] New user registration sends confirmation email with correct callback URL
- [ ] Clicking confirmation link validates token and logs user in
- [ ] Expired confirmation links show appropriate error message
- [ ] Invalid/malformed tokens are rejected
- [ ] Resend confirmation sends new email
- [ ] Unconfirmed user login redirects to `/auth/forgot-password` with email pre-filled (updated in REW-54)
- [ ] Production callback URL uses APP_URL environment variable
- [ ] Development callback URL defaults to localhost:3000
- [ ] Forgot Password page renders with one email field and both actions (REW-54)
- [ ] "Send Password Reset Email" triggers a Supabase reset email and shows the generic success message regardless of whether the email is registered (REW-54)
- [ ] Reset-password link verifies successfully and renders the "set a new password" form; an expired/reused link redirects to `/auth/forgot-password` with an error (REW-54)
- [ ] Submitting a new password (matching, ≥8 characters) succeeds, clears the recovery session, and redirects to `/auth/login`; the old password no longer works and the new one does (REW-54)
- [ ] `POST /auth/reset-password` without a valid `recovery-session` cookie is rejected (REW-54)

---

**Jira Issues:** REW-41, REW-54
**Status:** Complete

# Email Confirmation & Account Recovery Flow (REW-41, REW-54, REW-57)

This document describes the email confirmation system for user registration, including the callback handler, resend functionality, and security considerations. It also covers the Forgot Password / Account Recovery flow (REW-54) that supersedes the standalone resend-confirmation page, and the REW-57 hardening that makes the reset-password link robust to email-template and redirect-URL-allow-list misconfiguration.

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

### Password Recovery Flow Diagram (REW-54, updated REW-57)

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
4. PREREQUISITE (REW-57): the Supabase "Reset Password" email template must
   be the one in docs/email-templates/reset-password.html, which links via
   {{ .TokenHash }} -- NOT the Supabase default {{ .ConfirmationURL }}.
   Supabase sends a password-reset email with link to:
   {SiteURL}/auth/reset-password?token_hash=xxx&type=recovery
   (generic success message shown regardless of whether the email exists)
   |
   v
5. User clicks link in email --> GET /auth/reset-password
   |
   +-- token_hash + type=recovery --> verifyOtp() sets session +
   |   recovery-session marker cookie --> render state: "form"
   |
   +-- error/error_code in query --> render state: "error" (mapped,
   |   fixed copy -- raw error_description is never displayed)
   |
   +-- no query params, valid recovery session already set --> render
   |   state: "form" (how the fragment bridge below returns, and how a
   |   refresh of the form keeps working)
   |
   +-- no query params, no recovery session --> render state: "checking"
       (see "Implicit-flow fragment recovery" below); never redirects to
       Home or dead-ends silently
   |
   v
6. User submits new password --> POST /auth/reset-password (requireAuth +
   recovery-session cookie)
   |
   +-- Success --> updateUser() via per-request Supabase client --> clear
   |               session cookies --> Redirect to /auth/login
   |
   +-- Missing recovery-session cookie / expired setSession --> render
   |   state: "error" inline (never redirects to /auth/forgot-password,
   |   which combined with redirectIfAuthenticated used to bounce a
   |   still-logged-in user to Home -- REW-57)
   |
   +-- Validation failure (password rules) --> render state: "form" with
       inline error, recovery session preserved so the user can retry
```

### Implicit-flow fragment recovery (REW-57)

Two defence-in-depth mechanisms exist in case the Task-4 email template or the Supabase Redirect URL allow-list is ever misconfigured again, so the reported "reset link opens Home" bug cannot recur even in that scenario:

- **Home-route guard** (`src/routes/index.js`): if `GET /` is requested with both `token_hash` and `type` query params (i.e. a `redirect_to` fell back to the Site URL, which is Home), it 302s to `/auth/reset-password` (for `type=recovery`) or `/auth/callback` (for `type=signup`/`email`), forwarding only those two whitelisted params. Any other `type`, or extra params, are dropped and Home renders normally -- this can never become an open redirect, since only two fixed internal paths are ever targeted.
- **Fragment-to-cookie bridge** (`public/js/auth-recovery.js` + `POST /auth/reset-password/session`): if the email template still uses Supabase's default `{{ .ConfirmationURL }}`, the browser receives the session as a URL **hash fragment** (`#access_token=...&refresh_token=...&type=recovery`), which the server never sees. `auth-recovery.js` is loaded on every page via `views/layouts/main.ejs`; it reads `window.location.hash`, immediately strips it via `history.replaceState`, and either:
  - forwards a reported `error`/`error_code` to `/auth/reset-password?error_code=...` (code constrained to `[a-z_]+`), or
  - `fetch`-POSTs the `access_token`/`refresh_token`/`type` to `POST /auth/reset-password/session`, which validates them (see Security Notes below) and responds with a same-origin `redirect` path to navigate to.

Both mechanisms only ever navigate to fixed internal paths (`/auth/reset-password`, `/auth/callback`, or a `redirect` value produced by our own bridge endpoint) — never to a value taken from user input.

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

Verifies the Supabase password-recovery OTP from the emailed link and renders one of three states — it **never redirects to Home and never dead-ends** (REW-57).

**Authentication:** None required to reach the route (it *establishes* the recovery session); publicly reachable, but only the `token_hash`/`type=recovery` branch actually verifies anything.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token_hash` | string | No | The OTP token hash from the password-reset email (Task 2 template path) |
| `type` | string | No | Must equal `recovery` (`RECOVERY_OTP_TYPE`) when `token_hash` is present — any other value is rejected |
| `error` / `error_code` | string | No | Set by Supabase in some flows, or by `public/js/auth-recovery.js` when it reads a fragment error, to report a failure via query string |

**Render states** (`views/auth/reset-password.ejs`, local `state`):

| State | When | Content |
|-------|------|---------|
| `form` | Valid `token_hash`/`type=recovery` just verified, or a still-valid `recovery-session` + `sb-access-token` pair already exists (e.g. returning from the fragment bridge, or a page refresh) | The "set a new password" form |
| `error` | Missing/invalid `token_hash`/`type`; `verifyOtp()` failed; `error`/`error_code` present; or a `recovery-session` cookie exists but its access token is no longer valid | Heading "This reset link is invalid or has expired", a fixed message from `getRecoveryErrorMessage(code)`, a "Request a new reset email" button to `/auth/forgot-password`, and "Back to Sign In" |
| `checking` | No query params and no existing recovery session yet | "Verifying your reset link…" plus `/js/auth-recovery.js` (reads a URL hash fragment, if any) and a `<noscript>` fallback showing the same error content as the `error` state |

**Cookie hygiene:** every branch that renders `error` first clears `sb-access-token`, `sb-refresh-token`, and `recovery-session`, so an abandoned or expired recovery attempt never leaves stale cookies that could later trigger a `redirectIfAuthenticated` bounce to Home.

**Error copy:** always fixed strings produced by `getRecoveryErrorMessage(code)` (`src/utils/authUtils.js`) — Supabase's raw `error_description` query value is never read or displayed.

---

### POST /auth/reset-password/session

The implicit-flow fragment-to-cookie bridge (REW-57). Called by `public/js/auth-recovery.js` when it finds `access_token`/`refresh_token`/`type=recovery` in the URL hash fragment (i.e. the email template still used Supabase's default `{{ .ConfirmationURL }}`, or `redirect_to` fell back to the Site URL). Turns those browser-supplied tokens into httpOnly session cookies — the highest-risk surface added by this ticket, so every check below is mandatory:

**Authentication:** None (it establishes the recovery session) — protected instead by the checks below.

**Request Body** (JSON or form-encoded):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `access_token` | string | Yes | From the URL fragment |
| `refresh_token` | string | Yes | From the URL fragment |
| `type` | string | Yes | Must equal `recovery` |
| `_csrf` | string | No | Included for parity with other forms; currently a no-op (CSRF globally disabled) |

**Validation, in order (all must pass):**
1. `type` must equal `recovery`.
2. `access_token`/`refresh_token` must be non-empty strings.
3. The request's `Origin` header (falling back to `Referer`) must match `getAppUrl()` — same-origin check, since global CSRF protection is disabled.
4. `access_token` must be accepted by `supabase.auth.getUser(access_token)`.
5. (Recommended) the token's `amr` claim must include an entry with `method: "recovery"` (`hasRecoveryAmrClaim`), so an ordinary login token can't be replayed here to reach the password-change form without a real recovery email.

**Success Response:** `200 { "redirect": "/auth/reset-password" }`; sets `sb-access-token`, `sb-refresh-token`, and `recovery-session` cookies.

**Failure Response:** `401 { "redirect": "/auth/reset-password?error_code=invalid_link" }`; no cookies set. Token values are never logged, on success or failure.

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
| Missing `recovery-session` cookie | Renders `state: "error"` inline (REW-57: no longer redirects to `/auth/forgot-password`, which — combined with `redirectIfAuthenticated` — could bounce an already-logged-in user to Home) |
| Missing/mismatched/too-short password | Re-renders `state: "form"` with an inline error (no redirect, to preserve the recovery session) |
| Session expired (`setSession` fails) | Clears `sb-access-token`/`sb-refresh-token`/`recovery-session`, then renders `state: "error"` with "Your session has expired. Please request a new password reset link." |
| Supabase `updateUser()` rejects (e.g. stricter project password policy) | Re-renders `state: "form"` with Supabase's own error message |

**Implementation note:** Uses a freshly-instantiated Supabase client (`createSupabaseClient(req.accessToken)`, `src/config/supabase.js`) scoped to this request for `setSession()`/`updateUser()`, rather than the shared module-level `supabase` singleton, to avoid mutating session state on a client shared across concurrent requests.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_URL` | Yes (production) | `http://localhost:3000`, or `https://` + `VERCEL_PROJECT_PRODUCTION_URL` when running on Vercel without `APP_URL` set | Base URL for email confirmation and password-reset links, resolved by `getAppUrl()` (`src/utils/authUtils.js`). **Never** derived from the request's `Host`/`X-Forwarded-Host` headers (header-injection risk for emailed links). When `NODE_ENV=production` and `APP_URL` is unset, a one-time `console.warn` is logged naming the fallback used (REW-57) so a misconfigured deploy is visible in logs instead of silently emitting `localhost` links. |

### Supabase Dashboard Configuration

1. **Settings > Authentication > URL Configuration**
   - **Site URL**: Set to your production URL (e.g., `https://your-domain.com`)
   - **Redirect URLs**: Add all allowed callback and password-reset URLs:
     - Production: `https://your-domain.com/auth/callback`, `https://your-domain.com/auth/reset-password`
     - Development: `http://localhost:3000/auth/callback`, `http://localhost:3000/auth/reset-password`
2. **Authentication > Email Templates > Reset Password** — must be the template in `docs/email-templates/reset-password.html`, which links via `{{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery`. **Important:** the allow-list in step 1 alone is not sufficient — if this template still uses Supabase's default `{{ .ConfirmationURL }}`, the link goes through Supabase's own verify endpoint first, which delivers the session as a URL hash fragment that this server-rendered app cannot read from a redirect alone (see "Implicit-flow fragment recovery" above for the defence-in-depth that still recovers this case, and REW-57 for the root-cause writeup).

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

### getAppUrl(env) (REW-57)

Resolves the app's own base URL for building emailed links. See Environment Variables above for the fallback order. Never derives the URL from request headers.

**Location:** `src/utils/authUtils.js`

### getRecoveryErrorMessage(code) (REW-57)

Maps a Supabase/forwarded `error_code` to fixed, safe copy (`otp_expired` → expired-link message; anything else, including no code, → generic invalid/expired message). Never echoes Supabase's raw `error_description`.

**Location:** `src/utils/authUtils.js`

### getEmailLinkForwardPath(query) (REW-57)

Used by the Home-route guard (`src/routes/index.js`) to decide whether a misdirected email link (`?token_hash=...&type=...` landing on `/`) should be forwarded to `/auth/reset-password` or `/auth/callback`. Returns one of those two fixed paths carrying only the whitelisted `token_hash`/`type` params, or `null`. Cannot become an open redirect — the base path is never derived from the request.

**Location:** `src/utils/authUtils.js`

### isSameOriginRequest(headers, appUrl) / hasRecoveryAmrClaim(accessToken) (REW-57)

Used by `POST /auth/reset-password/session` — see that endpoint's Validation steps above.

**Location:** `src/utils/authUtils.js`

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

## Known Limitations / Non-Blocking Follow-Ups (REW-54, REW-57)

Flagged during review, not fixed in this ticket:

- **`recovery-session` marker cookie is presence-only.** It proves *a* recovery link was verified recently, but it's not a random, single-use token tied to the specific OTP verification, and it isn't cleared on login/register. On a shared/public browser, a stale marker cookie could theoretically let a *different* logged-in user's own password-change request skip the "came from a recovery email" check within the 1-hour cookie lifetime (they'd still need to be authenticated as themselves — this doesn't let one account touch another's password). Recommended follow-up: make it a random, server-verified single-use token, and clear it on login/register too.
- **No route-specific rate limiting** on `/auth/forgot-password`, `/auth/resend-confirmation`, or the new `/auth/reset-password/session` bridge — only the app-wide general limiter (100 req/15 min/IP, production only) applies. The bridge does a Supabase `getUser()` call per request. Recommended as a follow-up ticket.
- **CSRF protection is globally disabled** (`src/app.js`, pre-existing, unrelated to this ticket — `doubleCsrfProtection` is commented out pending a library debugging fix). Forms and the bridge fetch include `_csrf` fields for when it's re-enabled, but the field is currently a no-op. The bridge's same-origin `Origin`/`Referer` check (REW-57) is an added, independent defence, not a replacement for CSRF.
- **`hasRecoveryAmrClaim` is best-effort.** It inspects the `amr` claim on an already-`getUser()`-validated token; if a future Supabase/GoTrue version stops setting `amr` on recovery sessions, this check would start rejecting legitimate recovery links. Verify against a real reset email if that ever happens, rather than silently disabling the check.
- **`confirm-signup.html` has the same `{{ .ConfirmationURL }}` mismatch** that caused REW-57 for `reset-password.html`, so `/auth/callback` can in principle hit the same implicit-flow fragment case. Not fixed here beyond the generic Home-route guard and fragment forwarding (which happen to help it too) — tracked as a separate follow-up ticket.

---

## Related Files

| File | Description |
|------|-------------|
| `src/routes/authRoutes.js` | Route handlers for callback, forgot-password, reset-password (three-state), the `POST /auth/reset-password/session` fragment bridge, and resend |
| `src/routes/index.js` | Home route; forwards misdirected email links (`?token_hash=...&type=...`) via `getEmailLinkForwardPath` (REW-57) |
| `src/utils/authUtils.js` | Cookie utilities, OTP type validation (`ALLOWED_OTP_TYPES`, `RECOVERY_OTP_TYPE`), and the REW-57 helpers `getAppUrl`, `getRecoveryErrorMessage`, `getEmailLinkForwardPath`, `isSameOriginRequest`, `hasRecoveryAmrClaim`; see `authUtils.test.js` for unit tests of all of the above |
| `src/config/supabase.js` | `createSupabaseClient(accessToken)` — used by `POST /auth/reset-password` for a per-request client instance |
| `src/middleware/authMiddleware.js` | `requireAuth` gates `POST /auth/reset-password`; also fixed in REW-54 to attach `req.refreshToken` on every success path (previously only set on the token-refresh branch), preventing a stale/rotated refresh-token cookie from being paired with a freshly-refreshed access token and causing spurious "session expired" failures during password reset |
| `views/auth/forgot-password.ejs` | Centralized account-recovery page (REW-54; supersedes `resend-confirmation.ejs`) |
| `views/auth/reset-password.ejs` | Three states — `form` / `error` / `checking` (REW-57) |
| `views/auth/login.ejs` | Contains link to the Forgot Password page (REW-54) |
| `views/layouts/main.ejs` | Loads `/js/auth-recovery.js` on every page (REW-57) |
| `public/js/auth-recovery.js` | Reads a URL hash fragment left by an implicit-flow recovery link, strips it, and forwards errors or posts tokens to the bridge endpoint (REW-57) |
| `docs/email-templates/reset-password.html` | Reset-password email template; links via `{{ .TokenHash }}`/`{{ .SiteURL }}`, not `{{ .ConfirmationURL }}` (REW-57) |

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
- [ ] Reset-password link with `token_hash`/`type=recovery` verifies successfully and renders the "set a new password" form (REW-57)
- [ ] An expired/reused/tampered reset link renders the inline "invalid or expired" error state (not a redirect to `/auth/forgot-password`, and never Home) with a working "Request a new reset email" action (REW-57)
- [ ] `/auth/reset-password?error_code=otp_expired` shows the expired-link copy; an unknown `error_code` shows the generic copy; `error_description` is never rendered (REW-57)
- [ ] Submitting a new password (matching, ≥8 characters) succeeds, clears the recovery session, and redirects to `/auth/login`; the old password no longer works and the new one does (REW-54)
- [ ] `POST /auth/reset-password` without a valid `recovery-session` cookie renders the inline error state, not a redirect (updated in REW-57)
- [ ] With the Reset Password template temporarily set to `{{ .ConfirmationURL }}` in a dev project, clicking the emailed link still completes the reset via the fragment bridge, and the fragment is removed from the address bar (REW-57)
- [ ] `?token_hash=...&type=recovery` on `/` forwards to `/auth/reset-password`; `type=signup`/`email` forwards to `/auth/callback`; any other `type` renders Home normally and forwards nothing (REW-57)
- [ ] `POST /auth/reset-password/session` rejects a non-`recovery` type, a cross-origin `Origin`, and an invalid/expired `access_token`, without setting cookies (REW-57)
- [ ] Password-reset emails sent from production contain the production origin, never `localhost` (REW-57)

---

**Jira Issues:** REW-41, REW-54, REW-57
**Status:** Complete

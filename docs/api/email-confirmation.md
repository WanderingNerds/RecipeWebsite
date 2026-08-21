# Email Confirmation Flow (REW-41)

This document describes the email confirmation system for user registration, including the callback handler, resend functionality, and security considerations.

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

Displays a form for requesting a new confirmation email.

**Authentication:** Redirects authenticated users to home page

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `email` | string | No | Pre-fills the email field (typically passed from login redirect) |

**Response:** Renders `auth/resend-confirmation.ejs` view

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
2. Redirects to `/auth/resend-confirmation?email={email}`
3. User sees pre-filled form to request new confirmation
4. After sending, user is redirected to login page

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_URL` | Yes (production) | `http://localhost:3000` | Base URL for email confirmation links |

### Supabase Dashboard Configuration

1. **Settings > Authentication > URL Configuration**
   - **Site URL**: Set to your production URL (e.g., `https://your-domain.com`)
   - **Redirect URLs**: Add all allowed callback URLs:
     - Production: `https://your-domain.com/auth/callback`
     - Development: `http://localhost:3000/auth/callback`

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

## Related Files

| File | Description |
|------|-------------|
| `src/routes/authRoutes.js` | Route handlers for callback and resend |
| `src/utils/authUtils.js` | Cookie utilities and OTP type validation |
| `src/middleware/authMiddleware.js` | Uses `setAuthCookies` for session refresh |
| `views/auth/resend-confirmation.ejs` | Resend confirmation form |
| `views/auth/login.ejs` | Contains link to resend confirmation page |

---

## Testing Checklist

- [ ] New user registration sends confirmation email with correct callback URL
- [ ] Clicking confirmation link validates token and logs user in
- [ ] Expired confirmation links show appropriate error message
- [ ] Invalid/malformed tokens are rejected
- [ ] Resend confirmation sends new email
- [ ] Unconfirmed user login redirects to resend page with email pre-filled
- [ ] Production callback URL uses APP_URL environment variable
- [ ] Development callback URL defaults to localhost:3000

---

**Jira Issue:** REW-41
**Status:** Complete

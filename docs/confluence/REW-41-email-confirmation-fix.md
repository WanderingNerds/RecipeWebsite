# REW-41: Fix Broken Email Confirmation Link

**Space:** Recipe Website
**Status:** Complete
**Jira Issue:** [REW-41]

---

## Overview

This page documents the implementation of the email confirmation fix (REW-41). Users were previously unable to complete registration because confirmation emails contained broken links. This fix implements proper email confirmation handling with a callback endpoint, resend functionality, and improved security.

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

- GET: Shows form with optional pre-filled email
- POST: Calls `supabase.auth.resend()` API
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
  return res.redirect(`/auth/resend-confirmation?email=${encodeURIComponent(email)}`);
}
```

### 5. Auth Utilities (`src/utils/authUtils.js`)

Extracted cookie management for reuse:

| Function | Purpose |
|----------|---------|
| `setAuthCookies(res, session)` | Sets HTTP-only auth cookies |
| `clearAuthCookies(res)` | Clears auth cookies on logout |
| `ALLOWED_OTP_TYPES` | Valid OTP types for callback |

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

---

## Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `src/routes/authRoutes.js` | Modified | Added callback, resend routes; updated login |
| `src/middleware/authMiddleware.js` | Modified | Uses setAuthCookies utility |
| `src/utils/authUtils.js` | New | Cookie utilities and OTP types |
| `views/auth/resend-confirmation.ejs` | New | Resend form UI |
| `views/auth/login.ejs` | Modified | Added resend link |
| `README.md` | Modified | Documented APP_URL |

---

## Security Measures

1. **OTP Type Whitelist**: Only `signup` and `email` types allowed
2. **HTTP-only Cookies**: Session tokens not accessible to JavaScript
3. **Secure Flag**: Cookies secure in production
4. **SameSite Lax**: CSRF protection for cookies
5. **Email Enumeration Prevention**: Generic responses on resend

---

## Testing Notes

| Test Case | Expected Result | Status |
|-----------|-----------------|--------|
| Register new user | Confirmation email sent | Pass |
| Click confirmation link | User logged in, redirected to dashboard | Pass |
| Expired link | Error message, redirect to login | Pass |
| Invalid token | Generic error, redirect to login | Pass |
| Resend confirmation | New email sent | Pass |
| Login unconfirmed | Redirect to resend with email pre-filled | Pass |

---

## Deployment Checklist

- [ ] Set `APP_URL` environment variable in Vercel
- [ ] Update Supabase URL Configuration
- [ ] Deploy application
- [ ] Test registration flow end-to-end
- [ ] Verify existing users can still log in

---

## Related Pages

- [Authentication System Overview]
- [Supabase Integration Guide]
- [Environment Variables Reference]

---

**Last Updated:** 2026-08-21
**Author:** Documentation Team

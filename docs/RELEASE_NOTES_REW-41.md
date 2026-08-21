# Release Notes: REW-41 Fix Broken Email Confirmation Link

**Release Date:** 2026-08-21
**Jira Issue:** REW-41
**Type:** Bug Fix

---

## Summary

This release fixes broken email confirmation links in the user registration flow. Previously, confirmation emails contained links pointing to an incorrect domain or missing callback handler. Users can now successfully confirm their email addresses and complete registration.

---

## Problem Statement

Users were unable to confirm their email addresses after registration because:
1. The email confirmation link pointed to an incorrect URL
2. No callback handler existed to process the confirmation token
3. Users had no way to request a new confirmation email

---

## Solution

### 1. Email Confirmation Callback Handler

Added `/auth/callback` route that:
- Receives Supabase email confirmation redirects
- Validates `token_hash` and `type` query parameters
- Uses `verifyOtp()` to securely validate tokens server-side
- Sets HTTP-only session cookies on successful confirmation
- Redirects users to the dashboard after confirmation

### 2. Resend Confirmation Feature

Added `/auth/resend-confirmation` routes:
- GET route displays a form with email pre-filled (from login redirect)
- POST route calls Supabase `auth.resend()` API
- Security: does not reveal whether an email address exists

### 3. SignUp Flow Update

Updated registration to include:
- `emailRedirectTo` option using `APP_URL` environment variable
- Confirmation emails now link to the correct production domain

### 4. Login Flow Enhancement

Updated login to:
- Detect "email not confirmed" errors from Supabase
- Redirect to resend confirmation page with email pre-filled
- Provide clear messaging to users

### 5. Code Improvements

- Extracted cookie-setting logic to `src/utils/authUtils.js`
- Added type validation for OTP tokens (security improvement)
- Consistent flash messages across auth flows

---

## Files Changed

| File | Change |
|------|--------|
| `src/routes/authRoutes.js` | Added callback route, resend routes, updated login flow |
| `src/middleware/authMiddleware.js` | Uses `setAuthCookies` utility |
| `src/utils/authUtils.js` | NEW: `setAuthCookies`, `clearAuthCookies`, `ALLOWED_OTP_TYPES` |
| `views/auth/resend-confirmation.ejs` | NEW: Resend confirmation email page |
| `views/auth/login.ejs` | Added resend confirmation link |
| `README.md` | Documented `APP_URL` and Supabase configuration |

---

## Configuration Changes

### New Environment Variable

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `APP_URL` | Yes (production) | `http://localhost:3000` | Production domain for email callback URLs |

**Example:**
```
APP_URL=https://your-production-domain.com
```

### Supabase Dashboard Configuration

Update the following in **Settings > Authentication > URL Configuration**:

1. **Site URL**: Set to your production URL
   ```
   https://your-production-domain.com
   ```

2. **Redirect URLs**: Add your callback URLs
   ```
   https://your-production-domain.com/auth/callback
   http://localhost:3000/auth/callback
   ```

---

## API Changes

### New Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/auth/callback` | Email confirmation callback | No |
| GET | `/auth/resend-confirmation` | Resend confirmation form | No |
| POST | `/auth/resend-confirmation` | Process resend request | No |

See [Email Confirmation API Documentation](api/email-confirmation.md) for complete details.

---

## Security Considerations

1. **OTP Type Validation**: Only `signup` and `email` OTP types are allowed, preventing misuse of the callback endpoint
2. **HTTP-only Cookies**: Session tokens are stored in HTTP-only cookies, not accessible to JavaScript
3. **Secure Cookies**: Cookies use `secure: true` in production
4. **Email Enumeration Prevention**: Resend endpoint does not reveal if an email exists
5. **Server-side Validation**: Token validation happens server-side via Supabase `verifyOtp()`

---

## Breaking Changes

**None.** This release is fully backward compatible.

---

## Database Changes

**None.** This release does not modify the database schema.

---

## Deployment Notes

### Prerequisites
1. Set `APP_URL` environment variable in production
2. Configure Supabase redirect URLs in dashboard

### Deployment Steps
1. Set environment variables (Vercel dashboard or `.env`)
2. Deploy application code
3. Update Supabase URL Configuration with callback URLs
4. Test registration flow end-to-end

### Verification Steps
1. Register a new test account
2. Check email for confirmation link
3. Confirm link points to correct domain with `/auth/callback`
4. Click link and verify redirect to dashboard
5. Test resend functionality from login page

---

## Rollback Plan

If issues arise:
1. Revert the `authRoutes.js` changes
2. Remove `authUtils.js` file
3. Remove `resend-confirmation.ejs` view
4. Revert `login.ejs` changes
5. Note: Users will be unable to confirm email until fix is redeployed

---

## Testing Performed

- [x] New user registration sends confirmation email
- [x] Confirmation email contains correct callback URL
- [x] Clicking confirmation link logs user in
- [x] Expired links show appropriate error
- [x] Invalid tokens are rejected with generic error
- [x] Resend confirmation sends new email
- [x] Login with unconfirmed email redirects to resend page
- [x] Email pre-fills on resend page from login redirect
- [x] APP_URL correctly builds callback URLs
- [x] localhost fallback works for development

---

## Related Documentation

- [Email Confirmation API](api/email-confirmation.md)
- [README - Environment Configuration](../README.md)

---

**Jira Issue:** REW-41
**Status:** Complete and Tested

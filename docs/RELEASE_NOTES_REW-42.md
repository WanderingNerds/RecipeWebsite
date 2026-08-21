# Release Notes: REW-42 Brand Account Emails

**Release Date:** 2026-08-21
**Jira Issue:** REW-42

---

## Summary

Implemented branded HTML email templates for all Supabase Auth authentication emails. Emails now reflect the Potluck brand identity with consistent colors, typography, and warm, human messaging.

---

## What Changed

### Branded Email Templates

All authentication-related emails now use the Potluck brand design:

- **Signup confirmation** - Welcomes new users with branded styling
- **Password reset** - Clear password reset instructions
- **Magic link sign-in** - Passwordless login with branded appearance
- **Email change confirmation** - Confirms email address changes

### Design Elements

- Cream background (#f5ead8) matching website theme
- Terracotta accent color (#c67139) for buttons and wordmark
- Caprasimo font for headings and buttons
- Figtree font for body text
- Pill-shaped call-to-action buttons
- Table-based layout for Outlook compatibility

### Subject Lines

| Email Type | Subject |
|------------|---------|
| Signup | Welcome to Potluck - confirm your email |
| Reset | Reset your Potluck password |
| Magic Link | Your Potluck sign-in link |
| Email Change | Confirm your new email address |

---

## User Impact

- **Improved brand recognition** - Users receive emails that match the Potluck website design
- **Clearer messaging** - Warm, human tone replaces generic technical language
- **Better accessibility** - Fallback links for email clients that do not render buttons
- **Mobile-friendly** - Responsive design works on all devices

---

## Technical Details

- Templates stored in `docs/email-templates/` for version control
- Uses Supabase Go template syntax for dynamic content
- Inline CSS for email client compatibility
- MSO conditionals for Outlook font fallbacks

---

## Configuration Required

This feature requires manual configuration in the Supabase Dashboard:

1. Navigate to Authentication > Email Templates
2. Apply each HTML template to the corresponding email type
3. Update subject lines
4. Set sender name to "Potluck"
5. Set sender email to branded address

See `docs/email-templates/README.md` for detailed instructions.

---

## Files Added

- `docs/email-templates/confirm-signup.html`
- `docs/email-templates/reset-password.html`
- `docs/email-templates/magic-link.html`
- `docs/email-templates/change-email.html`
- `docs/email-templates/README.md`
- `docs/plans/REW-42-brand-account-emails.md`

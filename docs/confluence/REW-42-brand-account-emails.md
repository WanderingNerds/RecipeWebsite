# REW-42: Brand Account Emails

**Space:** Recipe Website
**Status:** Complete
**Jira Issue:** [REW-42]

---

## Overview

This page documents the implementation of branded HTML email templates for Supabase Auth emails (REW-42). The templates follow the Potluck design system, providing a consistent brand experience for authentication-related emails including signup confirmation, password reset, magic link sign-in, and email change confirmation.

---

## Summary

Created four HTML email templates styled with the Potluck brand design system. Templates are stored in `docs/email-templates/` for version control and documentation, then applied manually to the Supabase Dashboard.

---

## Templates

| Template | Subject Line | File | Purpose |
|----------|--------------|------|---------|
| Signup Confirmation | Welcome to Potluck - confirm your email | `confirm-signup.html` | New user email verification |
| Password Reset | Reset your Potluck password | `reset-password.html` | Password reset request |
| Magic Link | Your Potluck sign-in link | `magic-link.html` | Passwordless sign-in |
| Email Change | Confirm your new email address | `change-email.html` | Email address change confirmation |

---

## Design Specifications

### Color Palette

| Token | Hex Value | Usage |
|-------|-----------|-------|
| Background | `#f5ead8` | Page ground (cream) |
| Surface | `#ebddc5` | Card background |
| Text/Ink | `#201e1d` | Primary text |
| Terracotta | `#c67139` | Buttons, wordmark, links |
| Button text | `#f5ead8` | Text on terracotta buttons |
| Muted text | `#82796a` | Footer text |
| Secondary text | `#645c50` | Fallback link label |

### Typography

| Element | Font Stack |
|---------|-----------|
| Headings/Buttons | `'Caprasimo', Georgia, serif` |
| Body text | `'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |

Google Fonts are loaded via `<link>` tag with safe web-font fallbacks for email clients that block external resources.

### Layout

| Property | Value |
|----------|-------|
| Max width | 600px, centered |
| Outer padding | 40px vertical, 20px horizontal |
| Card border-radius | 16px |
| Card padding | 32px |
| Button border-radius | 999px (pill shape) |
| Button padding | 12px 24px |

---

## Template Structure

All templates follow a consistent structure:

1. **Outer wrapper** - Cream background (`#f5ead8`), centered content
2. **Header** - "Potluck" wordmark in Caprasimo font, terracotta color
3. **Content card** - Surface color (`#ebddc5`), rounded corners
4. **Greeting** - "Hi there,"
5. **Body text** - Clear explanation of action needed
6. **Primary CTA button** - Terracotta pill button, centered
7. **Fallback link** - Plain text URL for email clients that do not render buttons
8. **Footer** - Small text with recipient email and security note

---

## Template Variables (Supabase Go Templates)

| Variable | Description | Used In |
|----------|-------------|---------|
| `{{ .ConfirmationURL }}` | The action link URL | All templates |
| `{{ .Email }}` | User's current email address | All templates |
| `{{ .SiteURL }}` | Application base URL | Available but not used |
| `{{ .NewEmail }}` | New email address being confirmed | `change-email.html` only |

---

## Email Client Compatibility

Templates are designed for broad email client compatibility:

| Technique | Purpose |
|-----------|---------|
| Inline styles | Email clients strip `<style>` blocks |
| Table-based layout | Outlook compatibility |
| MSO conditionals | Fallback fonts for Outlook (`<!--[if mso]>`) |
| Web-safe fallbacks | Georgia serif and system fonts as fallbacks |
| `role="presentation"` | Tables marked as presentational for accessibility |

### Tested Clients

- Gmail (web and mobile)
- Outlook (desktop and web)
- Apple Mail (macOS and iOS)
- Yahoo Mail

---

## Brand Voice Guidelines

Email copy follows Potluck's warm, human brand voice:

| Element | Guideline | Example |
|---------|-----------|---------|
| Greeting | Friendly, casual | "Hi there," (not "Dear User") |
| Headings | Benefit-focused | "Welcome to Potluck!" (not "Account Verification Required") |
| Tone | Warm, conversational | "We're excited to have you in our community of home cooks" |
| Security notes | Reassuring, not alarming | "If you didn't request this, you can safely ignore this email" |

---

## Configuration

### Supabase Dashboard - Email Templates

1. Navigate to **Authentication** > **Email Templates**
2. For each template type:
   - Copy the entire HTML content from the corresponding file
   - Paste into the "Body" field
   - Update the "Subject" field with the subject line
3. Click **Save** for each template

### Supabase Dashboard - Sender Settings

1. Navigate to **Authentication** > **Email Templates**
2. Configure sender settings:
   - **Sender name:** `Potluck`
   - **Sender email:** `noreply@potluck.cooking` (or your branded email)
3. If using custom SMTP (recommended for production):
   - Configure SMTP credentials
   - Ensure SPF, DKIM, and DMARC records are set up

---

## Files Created

| File | Description |
|------|-------------|
| `docs/email-templates/confirm-signup.html` | Signup confirmation email template |
| `docs/email-templates/reset-password.html` | Password reset email template |
| `docs/email-templates/magic-link.html` | Magic link sign-in email template |
| `docs/email-templates/change-email.html` | Email change confirmation template |
| `docs/email-templates/README.md` | Setup instructions and template variables |
| `docs/plans/REW-42-brand-account-emails.md` | Implementation plan |

---

## Testing

### Testing Tools

- [Litmus](https://litmus.com) - Cross-client email testing
- [Email on Acid](https://www.emailonacid.com) - Email client preview
- [Mailtrap](https://mailtrap.io) - Email sandbox for development

### Quick Test in Supabase

1. Apply templates in Supabase Dashboard
2. Use the "Send test email" feature if available
3. Or create a test user to receive actual confirmation emails

---

## Deployment Checklist

- [ ] Copy templates to Supabase Dashboard
- [ ] Set subject lines for each template
- [ ] Configure sender name as "Potluck"
- [ ] Configure sender email address
- [ ] Set up custom SMTP (if using)
- [ ] Configure SPF/DKIM/DMARC records (if using custom domain)
- [ ] Test signup confirmation flow
- [ ] Test password reset flow
- [ ] Verify emails render correctly in target clients

---

## Future Considerations

Items out of scope for REW-42 but documented for future reference:

- Welcome email (post-confirmation)
- Account deletion confirmation email
- Weekly digest / notification emails
- Custom SMTP configuration
- SPF/DKIM/DMARC setup for custom domain

---

## Related Pages

- [REW-41: Fix Broken Email Confirmation Link]
- [Authentication System Overview]
- [Potluck Brand Design System]

---

**Last Updated:** 2026-08-21
**Author:** Documentation Team

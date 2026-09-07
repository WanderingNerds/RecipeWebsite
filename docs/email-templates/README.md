# Potluck Branded Email Templates

This directory contains HTML email templates for Supabase Auth emails, styled with the Potluck brand design system.

## Templates

| File | Subject Line | Purpose |
|------|--------------|---------|
| `confirm-signup.html` | Welcome to Potluck - confirm your email | New user email confirmation |
| `reset-password.html` | Reset your Potluck password | Password reset request |
| `magic-link.html` | Your Potluck sign-in link | Passwordless sign-in |
| `change-email.html` | Confirm your new email address | Email address change confirmation |

## Template Variables (Supabase Go Templates)

These templates use Supabase's Go template syntax. Available variables:

| Variable | Description | Used In |
|----------|-------------|---------|
| `{{ .ConfirmationURL }}` | Supabase's own `/auth/v1/verify` link (implicit flow). Supabase verifies the token itself and 302s the browser to `redirect_to` with the session delivered as a URL **hash fragment** (`#access_token=...&type=...`), never as query params. A server-rendered app like this one cannot read that fragment, so **do not use this variable for `reset-password.html`** — see the note below. | `confirm-signup.html`, `magic-link.html`, `change-email.html` (out of scope for REW-57) |
| `{{ .TokenHash }}` | The raw OTP token hash, without Supabase's own verify/redirect hop. Used to build a direct link to this app's own handler (`/auth/reset-password?token_hash=...&type=recovery`), which reads it as a normal query parameter and calls `verifyOtp()` server-side. | `reset-password.html` (REW-57) |
| `{{ .Email }}` | User's current email address | All templates |
| `{{ .SiteURL }}` | Application base URL (the project's configured Site URL) | `reset-password.html` (REW-57) |
| `{{ .RedirectTo }}` | The `redirectTo` value passed to `resetPasswordForEmail()` (i.e. `APP_URL` from this app). An alternative base for the reset-password link when a per-environment (rather than fixed Site URL) link is preferred; if `redirect_to` isn't allow-listed it falls back to the Site URL root with the query string intact, which the app's Home-route guard (`src/routes/index.js`) forwards to `/auth/reset-password`. | Not currently used; documented as an option |
| `{{ .NewEmail }}` | New email address being confirmed | `change-email.html` only |

> **Why `reset-password.html` uses `{{ .TokenHash }}` instead of `{{ .ConfirmationURL }}` (REW-57):** this app's `/auth/reset-password` handler expects `token_hash`/`type` as query parameters so it can verify the OTP server-side. `{{ .ConfirmationURL }}` instead sends the browser through Supabase's own verify endpoint, which delivers the session in a URL fragment that Express never sees — and if the `redirect_to` it computes isn't on the Supabase Redirect URL allow-list, it falls back further to the Site URL (the Home page), which was the reported bug. Building the link from `{{ .SiteURL }}/auth/reset-password?token_hash={{ .TokenHash }}&type=recovery` avoids both failure modes. The app also ships defence-in-depth (a fragment-to-cookie bridge and a Home-route guard) in case this template or the allow-list is ever misconfigured again, but the template fix above is the actual root-cause fix.

## Design System

### Colors (Inline CSS - no CSS variables in email)

| Token | Hex | Usage |
|-------|-----|-------|
| Background | `#f5ead8` | Page ground (cream) |
| Surface | `#ebddc5` | Card background |
| Text/Ink | `#201e1d` | Primary text |
| Terracotta | `#c67139` | Buttons, wordmark, links |
| Button text | `#f5ead8` | Text on terracotta buttons |
| Muted text | `#82796a` | Footer text |
| Secondary text | `#645c50` | Fallback link label |

### Typography

- **Heading font**: `'Caprasimo', Georgia, serif` - Used for wordmark, headings, and button labels
- **Body font**: `'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Google Fonts are loaded via `<link>` tag, with safe fallbacks for email clients that block external resources

### Layout Specifications

- **Max width**: 600px, centered
- **Outer padding**: 40px vertical, 20px horizontal
- **Card border-radius**: 16px
- **Card padding**: 32px
- **Button border-radius**: 999px (pill shape)
- **Button padding**: 12px 24px

## How to Apply in Supabase Dashboard

1. Log in to your Supabase project dashboard
2. Navigate to **Authentication** > **Email Templates**
3. For each template type (Confirm signup, Reset password, Magic Link, Change Email Address):
   - Copy the entire HTML content from the corresponding `.html` file
   - Paste into the "Body" field
   - Update the "Subject" field with the subject line from the table above
4. Click **Save** for each template

### Setting Sender Email

1. Navigate to **Authentication** > **Email Templates**
2. Under "SMTP Settings" or email configuration:
   - Set the sender name to `Potluck`
   - Set the sender email to your branded email (e.g., `hello@potluck.cooking` or `noreply@potluck.cooking`)
3. If using a custom SMTP provider (recommended for production):
   - Configure your SMTP credentials
   - Ensure SPF, DKIM, and DMARC records are set up for your domain

## Email Client Compatibility

These templates are designed for broad email client compatibility:

- **Inline styles**: All CSS is inline (email clients strip `<style>` blocks)
- **Table-based layout**: Used for Outlook compatibility
- **MSO conditionals**: Fallback fonts for Outlook (`<!--[if mso]>`)
- **Web-safe fallbacks**: Georgia serif and system fonts as fallbacks
- **role="presentation"**: Tables are marked as presentational for accessibility

## Testing

Before deploying to production, test emails in:

1. **Email testing tools**: [Litmus](https://litmus.com), [Email on Acid](https://www.emailonacid.com), or [Mailtrap](https://mailtrap.io)
2. **Major email clients**: Gmail, Outlook, Apple Mail, Yahoo Mail
3. **Mobile clients**: iOS Mail, Gmail app, Outlook app

### Quick Test in Supabase

1. After saving templates, use the "Send test email" feature if available
2. Or create a test user with your email to receive actual confirmation emails

## Brand Voice Guidelines

The email copy follows Potluck's warm, human brand voice:

- **Greeting**: "Hi there," (not "Dear User" or "Hello")
- **Tone**: Friendly and conversational
- **Headings**: Benefit-focused ("Welcome to Potluck!" not "Account Verification Required")
- **Security notes**: Reassuring but not alarming
- **Footer**: Acknowledges the email might be unexpected, provides safe ignore option

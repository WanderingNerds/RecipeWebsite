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
| `{{ .ConfirmationURL }}` | The action link URL (confirm, reset, etc.) | All templates |
| `{{ .Email }}` | User's current email address | All templates |
| `{{ .SiteURL }}` | Application base URL | Available but not used |
| `{{ .NewEmail }}` | New email address being confirmed | `change-email.html` only |

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

# REW-42: Brand Account Emails Implementation Plan

## Summary

Create branded HTML email templates for Supabase Auth emails following the Potluck design system. Since email templates are configured in Supabase Dashboard (not code), templates are saved to `docs/email-templates/` for documentation and version control.

## Scope

### In Scope
- Create 4 branded HTML email templates
- Create README documentation with template variables and application instructions
- Follow Potluck design system with inline CSS
- Ensure email client compatibility (Outlook, Gmail, Apple Mail, etc.)

### Out of Scope
- Supabase Dashboard configuration (manual step, documented in README)
- SMTP/custom domain setup (infrastructure, not code)
- Transactional emails beyond auth flows (welcome series, notifications)

## Templates Created

| Template | Subject | File |
|----------|---------|------|
| Signup confirmation | Welcome to Potluck - confirm your email | `confirm-signup.html` |
| Password reset | Reset your Potluck password | `reset-password.html` |
| Magic link | Your Potluck sign-in link | `magic-link.html` |
| Email change | Confirm your new email address | `change-email.html` |

## Design Specifications

### Colors (Inline - email clients don't support CSS variables)
- Background: `#f5ead8` (cream)
- Card surface: `#ebddc5`
- Text color: `#201e1d` (ink)
- Button fill: `#c67139` (terracotta)
- Button text: `#f5ead8` (cream)
- Muted text: `#82796a`

### Typography
- Heading font: `'Caprasimo', Georgia, serif`
- Body font: `'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Google Fonts loaded with safe fallbacks

### Layout
- Max width: 600px, centered
- Card: 16px border-radius, 32px padding
- Button: pill-shaped (999px radius), 12px 24px padding

## Template Structure

1. **Outer wrapper** - Cream background (`#f5ead8`), centered content
2. **Header** - "Potluck" wordmark in Caprasimo, terracotta color
3. **Content card** - Surface color (`#ebddc5`), rounded corners
4. **Greeting** - "Hi there,"
5. **Body text** - Clear explanation of action needed
6. **Primary CTA button** - Terracotta, pill-shaped, centered
7. **Fallback link** - Plain text URL for email clients that don't render buttons
8. **Footer** - Small text with security note

## Template Variables (Supabase Go Templates)

- `{{ .ConfirmationURL }}` - Action link URL
- `{{ .Email }}` - User's email address
- `{{ .SiteURL }}` - App base URL (available but not used)
- `{{ .NewEmail }}` - New email (for change email flow)

## Email Client Compatibility

- Inline styles on all elements
- Table-based layout for Outlook
- MSO conditionals for Outlook font fallbacks
- `role="presentation"` on tables for accessibility
- Web-safe font fallbacks

## Files Created

```
docs/email-templates/
  confirm-signup.html
  reset-password.html
  magic-link.html
  change-email.html
  README.md
```

## Application Instructions

See `docs/email-templates/README.md` for detailed instructions on:
1. Applying templates in Supabase Dashboard
2. Setting sender email address
3. Testing in email clients

## Testing

1. Open each HTML file in a browser to preview
2. Use email testing tools (Litmus, Mailtrap) for client compatibility
3. Apply to Supabase staging project and send test emails
4. Verify on Gmail, Outlook, Apple Mail

## Follow-up Tasks (Out of Scope)

- Configure custom SMTP for production
- Set up SPF/DKIM/DMARC records
- Add branded welcome email (post-confirmation)
- Add account deletion confirmation email

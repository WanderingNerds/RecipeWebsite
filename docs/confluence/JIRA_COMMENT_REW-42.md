# Jira Comment for REW-42

*Post this comment to the REW-42 Jira issue after deploying:*

---

## Implementation Complete

Branded HTML email templates for Supabase Auth have been created and documented.

**What was implemented:**
- Created 4 branded email templates following Potluck design system
- Templates: signup confirmation, password reset, magic link, email change
- Table-based layout for Outlook compatibility
- Inline CSS with web-safe font fallbacks
- Documentation for applying templates in Supabase Dashboard

**Templates:**

| Email Type | Subject Line |
|------------|--------------|
| Signup Confirmation | Welcome to Potluck - confirm your email |
| Password Reset | Reset your Potluck password |
| Magic Link | Your Potluck sign-in link |
| Email Change | Confirm your new email address |

**Documentation:**
- Confluence: [REW-42: Brand Account Emails] *(link to be added after posting)*
- Template README: `docs/email-templates/README.md`

**Configuration Required (Supabase Dashboard):**
1. Apply templates in Authentication > Email Templates
2. Set sender name to "Potluck"
3. Set sender email to branded address (e.g., `noreply@potluck.cooking`)
4. Configure custom SMTP for production (optional but recommended)

**Design Specs Applied:**
- Background: #f5ead8 (cream)
- Card surface: #ebddc5
- Button: #c67139 (terracotta), pill-shaped
- Fonts: Caprasimo (headings), Figtree (body)

---

*This comment should be posted after the Confluence page is created, with the actual link substituted.*

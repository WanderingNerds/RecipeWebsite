# Jira Comment for REW-41

*Post this comment to the REW-41 Jira issue after deploying:*

---

## Implementation Complete

The email confirmation flow has been fixed and deployed.

**What was fixed:**
- Added `/auth/callback` endpoint to handle email confirmation redirects
- Implemented resend confirmation functionality at `/auth/resend-confirmation`
- Updated signup to include correct `emailRedirectTo` URL using `APP_URL` env var
- Enhanced login to detect unconfirmed emails and guide users to resend

**Documentation:**
- Confluence: [REW-41: Fix Broken Email Confirmation Link] *(link to be added after posting)*
- API Docs: `docs/api/email-confirmation.md`
- Release Notes: `docs/RELEASE_NOTES_REW-41.md`

**Configuration Required:**
- Set `APP_URL` environment variable in production
- Update Supabase Dashboard redirect URLs

**Testing:**
All test cases passing. See Confluence page for full test matrix.

---

*This comment should be posted after the Confluence page is created, with the actual link substituted.*

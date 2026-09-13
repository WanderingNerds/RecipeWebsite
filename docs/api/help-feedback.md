# Help & Feedback (REW-70)

Both HTML routes require `requireAuth`.

| Method | Behavior |
| --- | --- |
| `GET /help-feedback` | Renders the form; name defaults to account `name`, then `full_name`, and email defaults to the account email. |
| `POST /help-feedback` | Trims and validates fields, inserts through an authenticated Supabase client, flashes confirmation, and returns `303 /help-feedback`. |

Categories are `Question`, `Issue report`, `Feedback`, `Help request`, and `Other`. All fields are required strings. Maximum lengths are name 120, email 254, subject 200, and message 5,000 characters; email also receives server-side format validation. Invalid input returns 400 with escaped values preserved. Storage failures return 500 with a generic message and log only safe metadata.

`user_id` comes from `req.user.id`, never the body. Migration 015 replaces migration 014's intake policy after adding assignment: authenticated INSERT requires `auth.uid() = user_id`, status `new`, and `assignee_id IS NULL`. Ordinary users have no SELECT, UPDATE, or DELETE policy or lookup endpoint.

The form includes `_csrf` and is protected by application-wide CSRF enforcement.

Local automated checks pass. Pending acceptance: deploy migrations 014/015; verify owner/mismatched-owner and forced-assignee/status intake, ordinary/admin RLS, account-delete `NO ACTION`, real storage and refresh safety, and desktop/mobile/keyboard browser behavior.

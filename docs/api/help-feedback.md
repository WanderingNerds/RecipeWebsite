# Help & Feedback (REW-70)

Both HTML routes require `requireAuth`.

| Method | Behavior |
| --- | --- |
| `GET /help-feedback` | Renders the form; name defaults to account `name`, then `full_name`, and email defaults to the account email. |
| `POST /help-feedback` | Trims and validates fields, inserts through an authenticated Supabase client, flashes confirmation, and returns `303 /help-feedback`. |

Categories are `Question`, `Issue report`, `Feedback`, `Help request`, and `Other`. All fields are required strings. Maximum lengths are name 120, email 254, subject 200, and message 5,000 characters; email also receives server-side format validation. Invalid input returns 400 with escaped values preserved. Storage failures return 500 with a generic message and log only safe metadata.

`user_id` comes from `req.user.id`, never the body. Migration 014 permits authenticated INSERT only when `auth.uid() = user_id` and status is `new`; ordinary users have no SELECT, UPDATE, or DELETE policy or lookup endpoint. REW-71 owns administrator access.

The form includes `_csrf`, but global CSRF enforcement remains disabled in `src/app.js`.

Local automated checks pass. Pending acceptance: live migration; owner/mismatched-owner and ordinary-user RLS checks; account-delete `NO ACTION`; real storage and refresh safety; desktop/mobile/keyboard browser checks.

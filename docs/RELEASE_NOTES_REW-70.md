# Release Notes: REW-70 - Create Help & Feedback Page and Dashboard Card

**Date:** 2026-09-13  
**Jira:** [REW-70](https://wanderingnerds.atlassian.net/browse/REW-70) — In Progress  
**Branch:** `REW-70-create-help-feedback-page`

Authenticated users now have a fifth Dashboard Quick Action linking to `/help-feedback`. The page explains administrator review and collects category, subject, message, and editable contact snapshots, with account defaults and safe value preservation after validation errors.

The **What happens next?** notice and form now use the defined shared `--space-6` token for inner padding and separation. The notice's final paragraph margin is reset so wrapped explanatory copy maintains a consistent inset.

The server validates every field, writes through the user's Supabase client, and uses Post/Redirect/Get. Migration 014 creates durable intake, queue indexes, initial `new` status, and owner-bound INSERT-only RLS. Ordinary users cannot list, update, or delete submissions; REW-71 owns admin workflow.

No dependencies, environment variables, or Vercel configuration changed. Apply migration 014 after migration 013. Global CSRF remains disabled; the form retains the `_csrf` contract.

Review is **Approved with follow-ups; blocker closed**. Focused route/utils/view tests pass 13/13, full tests pass 166/166, and `git diff --check` passes. Source inspection confirms the corrected spacing rules apply at all widths. Browser-level desktop/mobile verification of wrapped notice copy remains pending, so live QA is not claimed; see [validation](qa/rew-70-help-feedback.md).

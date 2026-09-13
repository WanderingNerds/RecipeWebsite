# Release: REW-70 - Create Help & Feedback Page and Dashboard Card

## Jira issue

[REW-70](https://wanderingnerds.atlassian.net/browse/REW-70)

## What shipped

Authenticated users can open `/help-feedback` from a fifth Dashboard Quick Action. The semantic form explains administrator review, supplies editable account contact defaults, preserves escaped values after validation errors, and uses a 303 redirect plus accessible confirmation after success.

The **What happens next?** notice and form use the defined shared `--space-6` token for inner padding and separation at all widths. Resetting the final notice paragraph margin keeps wrapped explanatory copy consistently inset.

Server validation shares the rendered category allowlist and enforces type, required, length, and email rules. Writes use the authenticated Supabase client. Migration 014 adds durable intake snapshots, `new` status, queue indexes, and owner-bound INSERT-only RLS. Ordinary users have no read/update/delete policy. REW-71 owns administrator queue access.

## Validation

Review: **Approved with follow-ups; blocker closed**. Focused route/utils/view tests: 13/13; full tests: 166/166; `git diff --check`: pass. Source inspection confirms the defined spacing token and final-paragraph reset apply at all widths. Jira remains **In Progress**. Live QA is not claimed.

Pending: browser-level desktop/mobile visual verification of wrapped notice copy and keyboard checks; live migration; owner/mismatched-owner and ordinary-user RLS checks; account-delete `NO ACTION`; real storage/refresh.

## Deployment

Apply migration 014 after migration 013. No new configuration or dependency is required. Global CSRF remains disabled; `_csrf` is retained for the existing contract.

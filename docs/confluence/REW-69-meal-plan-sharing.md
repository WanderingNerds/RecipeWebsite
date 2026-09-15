# Confluence record for REW-69 — Add Meal Plan Sharing

**Status: POSTED.** Atlassian access was available during this documentation session, so both pages below were actually created/updated in Confluence and the Jira comment was actually posted. This file is the repo-side record of what was published and where, not a draft awaiting posting.

**Cloud:** `wanderingnerds.atlassian.net` (cloudId `cd111339-8ffc-491c-b2d1-2e9e96a76a43`), space **Recipe**.

---

## What was published

| # | Page | Action | Link |
|---|------|--------|------|
| 1 | **Release: REW-69 - Add Meal Plan Sharing** (id `30277641`) | **Created** | https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30277641/Release+REW-69+-+Add+Meal+Plan+Sharing |
| 2 | **Meal Plans (REW-63, REW-69)** (id `25198593`) | **Updated** to v4 | https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25198593/Meal+Plans+REW-63+REW-69 |

Page 2 is the page the Planner seeded with a "REW-69: Meal Plan Sharing (planned)" section. That section was replaced with an as-shipped one rather than left alongside the plan, so the page describes the feature that exists rather than the one that was proposed. Its title, status line, data-model table, decisions table, and Security section were all updated to match.

## Jira

- Comment posted to **[REW-69](https://wanderingnerds.atlassian.net/browse/REW-69)** — see `docs/confluence/JIRA_COMMENT_REW-69.md` for the exact text.
- **REW-69 was NOT transitioned.** It remains **In Progress**, deliberately, because QA did not run and the change is still uncommitted with no PR opened. No Jira issue was created, edited, or assigned by this pass.

## Content source of truth

Both pages were written from `docs/RELEASE_NOTES_REW-69.md`, which is the fullest repo-side version and should be the starting point for any further edits.

## Where the shipped implementation sits relative to the plan

Unusually for this repo, **implementation matched `docs/plans/meal-plan-sharing.md` task for task** — no scope was added or dropped during development or review, and the Reviewer approved with no blocking issues. The two things worth carrying forward on any future edit are therefore not divergences but judgement calls that survived review:

1. **Public meal plans are link-only, not searchable.** This is the single deliberate divergence from REW-19's cookbook sharing, and it was an *assumption* in the plan rather than a stated requirement in the ticket. It is the largest scope judgement in the ticket and still deserves product-owner confirmation. Reversing it means a follow-up migration modeled on `search_cookbooks`, with its own privacy decision.
2. **The accepted `user_id` exposure on Public plans.** An anon PostgREST read of a Public `meal_plans` row can see `user_id`, `created_at`, and `updated_at`, so multiple Public plans can be correlated to one owner UUID. The Reviewer raised it; it was accepted as identical to the existing posture for published `recipes` and Public `cookbooks`, and it exposes no Private plan. Both Confluence pages document it explicitly so it does not get rediscovered as a "finding" later.

Also recorded on page 2: migration `011`'s header still says meal plans have "deliberately NO public/shared SELECT policy." That is now historical — `020` supersedes it and says so in its own header — and `011` was correctly not edited because it has already been applied.

## Corrections made while editing

`docs/api/meal-plans.md`'s Security section claimed CSRF protection was "currently disabled repo-wide." It is not: `src/app.js` applies `csrfProtectionExceptMultipart` globally, `POST` is not in `ignoredMethods`, and `res.locals.csrfToken` is populated on every render. The claim was corrected in the repo doc; the equivalent correction had already been made on Confluence page 2 during the planning pass, and was preserved in this update.

# Confluence record for REW-19 — Cookbook Sharing

**Status: POSTED.** Unlike the earlier tickets in this repo's `docs/confluence/` directory, Atlassian access was available during this documentation session, so both pages below were actually created/updated in Confluence and the Jira comment was actually posted. This file is the repo-side record of what was published and where, not a draft awaiting posting.

**Cloud:** `wanderingnerds.atlassian.net` (cloudId `cd111339-8ffc-491c-b2d1-2e9e96a76a43`), space **Recipe**.

---

## What was published

| # | Page | Action | Link |
|---|------|--------|------|
| 1 | **Release: REW-19 - Cookbook Sharing** (id `30408705`) | **Created** | https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30408705/Release+REW-19+-+Cookbook+Sharing |
| 2 | **Cookbooks (REW-62, REW-19)** (id `25067521`) | **Updated** to v3; retitled from "Cookbooks (REW-62)" | https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25067521/Cookbooks+REW-62+REW-19 |

Page 2 is the page the Planner seeded with a "REW-19: Cookbook Sharing (planned — not yet built)" section. That section was replaced with an as-built one rather than left alongside the plan, so the page describes the feature that exists rather than the one that was proposed.

## Jira

- Comment posted to **[REW-19](https://wanderingnerds.atlassian.net/browse/REW-19)** — see `docs/confluence/JIRA_COMMENT_REW-19.md` for the exact text.
- Short linking comment posted to **[REW-91](https://wanderingnerds.atlassian.net/browse/REW-91)** (the cookbook-cloning follow-up), pointing at both pages and flagging the two REW-19 design facts that bear on its open questions.
- **REW-19 was NOT transitioned.** It remains **In Progress**, deliberately, because QA did not run. No Jira issue was created, edited, or assigned by this pass.

## Content source of truth

Both pages were written from `docs/RELEASE_NOTES_REW-19.md`, which is the fullest repo-side version and should be the starting point for any further edits. Page 2 additionally carries a **"Changes from the planned design"** section that is worth preserving on future edits, because it is the only place recording where the shipped implementation diverged from `docs/plans/rew-19-cookbook-sharing.md`:

1. The `cookbook_recipes` public SELECT policy gained a second condition (the referenced recipe must be `status = 'published'`), because a membership row alone would otherwise have disclosed the count, UUIDs, and add-times of the owner's draft recipes to a direct anon-key PostgREST read.
2. The `search_cookbooks` RPC is skipped entirely past page 1 of recipe results, rather than being called on any non-empty query, since an offset-0 call would repeat the identical five cookbooks under every page.

## The QA caveat, stated on every surface

Every page and comment above states plainly that the change is **reviewer-approved but not QA-verified**, that migration `019_add_cookbook_sharing.sql` has not been applied to any live Supabase project, and that AC3, AC5, AC6, AC11, AC12, and AC14 are explicitly not claimed as passing. If any of this content is copied elsewhere, that caveat must travel with it.

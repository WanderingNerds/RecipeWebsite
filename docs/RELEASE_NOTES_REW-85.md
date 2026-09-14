# Release Notes: REW-85 - Add Private/Public Recipe Visibility Controls

**Date:** 2026-09-14  
**Jira:** [REW-85](https://wanderingnerds.atlassian.net/browse/REW-85)  
**Branch:** `REW-85-private-public-recipe-visibility`

## Summary

Recipe visibility is now an explicit Private/Public choice during manual creation, import review, cloning, and owner editing. New and cloned recipes start Private, while owners can deliberately make a recipe Public before saving or switch visibility later.

## User impact

- Each recipe workflow has one accessible visibility control and one save action.
- Private recipes are visible only to their owner; Public recipes remain available through Browse, search, and public detail pages.
- Authenticated users can clone a recipe they are allowed to view. The clone is a new, Private recipe owned by the cloning user, with an editable collision-safe title.
- Cloning copies editable recipe text and category/tag selections, but not photos, likes, cookbook membership, meal-plan membership, IDs, or timestamps.
- Recipe cards and detail pages use Private/Public terminology instead of Draft/Published where status describes visibility.

## Technical and database impact

The UI values map to the existing database lifecycle: `private` → `draft` and `public` → `published`. A shared server-side normalizer accepts only these scalar values and defaults all missing or invalid inputs to `draft`. Owner updates retain explicit owner filtering, clone reads use the authenticated request-scoped Supabase client, and public reads retain published-only filters.

No schema migration, backfill, new environment variable, dependency, cache, or search-index synchronization is required. Existing RLS policies and the `recipes.status` constraint remain authoritative.

## Validation

- Full Node suite: **271 total, 269 passed, 0 failed, 2 skipped** because the sandbox forbids local HTTP listeners.
- Focused reviewer suite: **24 passed, 0 failed**.
- Build, syntax checks, and `git diff --check`: **passed**.
- Two review loops and static security/RLS review: **approved**.

Browser acceptance and live Supabase RLS verification were not executed and are not claimed as passed. See the [QA record](qa/rew-85-private-public-recipe-visibility.md).

## Deployment

Standard application deployment only. Verify deployed Supabase RLS policies/grants against the existing migrations before release; no new migration is included.

## Related documentation

- [Implementation plan](plans/rew-85-private-public-recipe-visibility.md)
- [Recipe visibility API](api/recipe-visibility.md)
- [Import save API](api/recipe-import-save.md)
- [Database notes](../database/README.md)
- [QA record](qa/rew-85-private-public-recipe-visibility.md)

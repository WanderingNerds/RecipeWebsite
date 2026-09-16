# Jira Comment for REW-88 Documentation

REW-88 standardizes the recipe cards inside a cookbook. Every card on `/cookbooks/:id` now shows a clickable title, the favorite heart, author and `Adapted from` attribution, category and tag chips, `Prep Time:` / `Cook Time:` / `Servings:` / `Difficulty:`, plus `+ Meal Plan`, Share, Remove, and owner-only Edit and Delete. `+ Cookbook` is deliberately absent — the recipe is already in a cookbook. Browse, My Recipes and My Favorites are unchanged.

This is not a new card. The shared partial `views/partials/recipe-summary-card.ejs` gained a fourth `surface` value, `'cookbook'`. The favorite heart and the read-only status pill used to be one either/or decision; they are now two independent flags (`showFavoriteHeart = !isBrowse`, `showStatusPill = isBrowse || (isCookbook && isOwner)`) rendering into the same header row. `showCookbookAdd = !isBrowse && !isCookbook` implements the "do not display + Cookbook" requirement, and a new optional `cookbookId` local lets the partial render this page's Remove form — absent it, no Remove button is drawn rather than a broken URL. `views/cookbooks/view.ejs` now includes the partial instead of hand-rolling a card; its header, cookbook-level Public/Private control, share panel, grid wrapper and empty state are untouched.

On the route side, `getCookbookRecipes` was widened to the columns the standardized card needs (`user_id`, `original_author`, embedded `recipe_categories` / `recipe_tags` flattened into `categories` / `tags`) and exported, and `GET /:id` was extracted into an exported `handleCookbookView` that stamps `isLiked` from one batched `recipe_likes` query — none at all for an empty cookbook. One cookbook read, one recipe read, one likes read regardless of size. No new endpoint, no new rate limiter, and no change to helmet, CORS, `csrf-csrf`, `express-rate-limit` or the auth middleware; `GET /cookbooks/:id` still runs behind `requireAuth` after the extraction.

**No database migration.** Every column the widened select adds is already readable under applied policies 001, 005/006 and 013, and `recipe_likes` is read on the request-scoped, RLS-scoped client. No new environment variable, package, or Vercel configuration change.

Review is **approved with no blocking issues**. `npm test` reports **510 tests, 508 passing, 2 failing**; both failures are pre-existing environmental unix-socket errors in `src/csrf.integration.test.js` on Windows (`listen EACCES /tmp/rew71-*.sock`), a file untouched by this diff, tracked as REW-98.

**The QA stage was deliberately skipped on this run**, and the branch is unmerged and unpushed, so the manual acceptance criteria are unverified: the heart toggle surviving a reload, `+ Meal Plan` against real data, the Remove round trip leaving the recipe intact, Edit/Delete from this page, 375px wrapping of the five-control action row, keyboard reachability and focus visibility, and the crafted cross-user POST checks. **This change should not be described as QA-verified.** Status stays In Progress.

Three non-blocking reviewer items were intentionally not actioned in this ticket and are documented as open: (1) the owner-only Private/Public pill is a deliberate deviation from the ticket's requirement list — kept because removing it would regress REW-19, but it wants explicit product sign-off; (2) the disabled heart's label "Make this recipe Public to add it to favorites" is itself a status claim, unreachable today but reachable under REW-100, recommended to fold into that ticket; (3) a manual smoke test of `/cookbooks/:id` against a live Supabase is still outstanding, because `getCookbookRecipes` is the repo's first three-level PostgREST embed and its helper returns `[]` on error, which renders as the empty state with no flash.

Also filed during this run: REW-102 — `POST /recipes/:id/delete` has no route-level `csrfProtection` and the global wrapper deliberately skips `multipart/form-data`. Deliberately left out of this diff.

- Plan (updated to as-shipped): https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31850497
- Release notes: https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31916033
- Feature page (Cookbooks): https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25067521
- Repo docs: `docs/api/cookbook-card.md`, `docs/RELEASE_NOTES_REW-88.md`

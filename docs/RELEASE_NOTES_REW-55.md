# Release Notes: REW-55 - Add Favorite Action to Recipe Cards on My Recipes

**Date:** 2026-09-07
**Jira Issue:** [REW-55](https://wanderingnerds.atlassian.net/browse/REW-55)
**Branch:** `REW-55-add-favorite-action-to-recipe-cards`
**Pipeline:** Planner → Developer → Reviewer (Approved, no blocking issues) → QA. This release note treats the Reviewer's Approved verdict as the completion gate; see "Testing" below for what QA coverage this change has and does not have.

---

## Summary

The Favorite (heart) control that already existed on the single-recipe detail page (REW-21) is now also available directly on each recipe card under **My Recipes** (`/recipes`), so a user can favorite or unfavorite a recipe from the list view without opening it first. This is a UI-surfacing change, not a new feature: it reuses the existing `recipe_likes` table, the existing `/api/likes/:recipeId` endpoints, and the existing `.like-btn` markup/JS/CSS as-is.

Because My Recipes lists both **draft** and **published** recipes, and the existing like API only allows liking published recipes, draft cards show the same heart control in a **disabled, muted state** rather than omitting it — satisfying "every card gets a Favorite control" without attempting a request the API will reject.

---

## User-Facing Changes

- Every recipe card on the My Recipes page now shows a heart-shaped Favorite control next to the recipe title.
- On **published** recipe cards, the heart is fully interactive: click to favorite (heart fills in) or unfavorite (heart empties), with the same instant/optimistic feedback used on the recipe detail page.
- On **draft** recipe cards, the heart is visible but disabled/muted, with a tooltip explaining "Publish this recipe to add it to favorites." Publishing the recipe makes the control active on the next page load.
- Favoriting/unfavoriting from My Recipes is reflected everywhere else that shows favorite state — the recipe's own detail page and the "Liked Recipes" page (`/recipes/liked`) — since they all read the same underlying data.
- No other behavior on the My Recipes page changed: View, Edit, Delete, category/tag badges, and filtering all work exactly as before, and clicking the heart does not navigate to the recipe.

---

## Technical Changes

### `src/routes/recipeRoutes.js`
`GET /` (My Recipes) now batch-fetches the current user's `recipe_likes` rows for the page's recipe IDs in a single query (`recipe_likes.select("recipe_id").eq("user_id", ...).in("recipe_id", recipeIds)`), builds a `Set` for O(1) lookup, and attaches a boolean `isLiked` to each recipe object before rendering — avoiding an N+1 query pattern. This follows the batching approach already documented for REW-21.

### `views/recipes/index.ejs`
Each card now renders the shared `.like-btn` control (same markup/classes as `views/recipes/view.ejs`) as a sibling of the title link, not nested inside it — so a heart click never also triggers navigation to the recipe. Published cards render it active with `data-liked`/`aria-label` reflecting current state; draft cards render it with a native `disabled` attribute and an explanatory `title`/`aria-label`.

### `public/css/styles.css`
Added a `.like-btn:disabled` rule (reduced opacity, `cursor: not-allowed`) for the new muted draft state; no other CSS changes were needed.

### No changes to `src/routes/likeRoutes.js` or `public/js/likes.js`
The existing `/api/likes/:recipeId` endpoints and the existing global delegated click handler (loaded on every page via `views/layouts/main.ejs`) picked up the new markup with zero additional wiring.

### Database
None. Reuses the `recipe_likes` table, RLS policies, and `get_recipe_like_count()` function from migration `008_create_recipe_likes_table.sql` (REW-21) exactly as-is.

---

## Known Non-Blocking Notes

1. **Draft cards can't be favorited directly** — by design (see Summary). If product later wants drafts to be favoritable, that requires changing `recipeExists()` in `likeRoutes.js`, the render guard in `view.ejs`, and the `/recipes/liked` published-only filter together; that's a larger, separate change.
2. **No like count shown on My Recipes cards** — only the on/off heart state, matching the ticket's ask. The detail page's like count display is unchanged.
3. **`views/partials/recipe-card.ejs`** (used by `browse.ejs`/`search.ejs`) was not touched — My Recipes uses its own inline card markup, not that shared partial. Adding the same favorite control there would be a natural follow-up but was out of scope for REW-55.
4. **CSRF protection remains globally disabled** (pre-existing, `src/app.js`, unrelated to this ticket) — noted because this change adds another clickable, state-changing control to a page, consistent with the same caveat already recorded for REW-21.
5. **No automated tests were added.** This repo has no request-level/integration test harness for any Supabase-backed route handler, including the original `likeRoutes.js` from REW-21 — consistent with existing project convention, confirmed by the Reviewer.

---

## Breaking Changes

None. `GET /recipes`'s HTML response gains a new control per card; no existing route, JSON shape, or auth requirement changed.

---

## Deployment

No special deployment steps required. No database migrations, no new environment variables, no changes to auth/CSRF/rate-limiting/upload-validation middleware.

---

## Testing

Reviewer verdict: **Approved, no blocking issues.**

No dedicated QA report was supplied to this documentation pass beyond the reviewer's approval; manual verification should confirm the plan's acceptance criteria in `docs/plans/rew-55-add-favorite-action-to-recipe-cards.md`, in particular:
- Every card (draft and published) shows a Favorite control.
- Favoriting/unfavoriting a published card updates optimistically and persists across a page refresh.
- The same favorite state appears on the recipe's detail page and on `/recipes/liked`.
- Draft cards' hearts are visibly disabled and do not trigger a request.
- Heart clicks don't navigate to the recipe; existing View/Edit/Delete controls are unaffected.
- Mobile tap-target sizing (~44×44px, REW-50) is preserved and the control doesn't overlap the Draft/Published badge.

This repo has no automated route-level test harness (Supabase-backed handlers, including the original REW-21 `likeRoutes.js`, have never had one), so the above remains a manual/QA verification checklist rather than an `npm test` assertion.

---

## Documentation

- `README.md` — new "Favorites / Recipe Likes (REW-21, REW-55)" feature section (this also retroactively documents REW-21, which had no README entry before now); Project Structure updated to list `likeRoutes.js` and `likes.js` (also a pre-existing gap, closed here).
- `docs/api/README.md` — added the Likes endpoint table and a link to the new detailed page; noted the `isLiked` enrichment on `GET /recipes`.
- `docs/api/recipe-likes.md` (new) — full endpoint documentation for `/api/likes/:recipeId`, the draft-recipe restriction, and the `GET /recipes` `isLiked` batch-fetch. This page did not exist before REW-55; REW-21 shipped without one.
- `database/README.md` — added the `recipe_likes` table, its RLS policies, and its indexes to the schema documentation (another pre-existing REW-21 gap closed here), plus a note on the draft-after-published-with-likes edge case relevant to REW-55.
- `docs/RELEASE_NOTES_REW-55.md` — this file.
- `docs/plans/rew-55-add-favorite-action-to-recipe-cards.md` — left as originally written (Status: Planning Complete). This repo's convention, confirmed by checking every other completed ticket's plan file (including REW-21's, REW-52's, and REW-57's), is that plan files are not edited after the fact — completion is recorded in this release-notes file, the Jira comment, and Confluence instead.
- Confluence: drafted, not posted — see "Confluence pages" in the structured summary below.
- No `design_handoff_recipe_form/README.md` changes — this ticket touches the My Recipes list view, not the recipe form.

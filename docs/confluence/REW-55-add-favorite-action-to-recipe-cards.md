# Confluence content for REW-55 — drafted, not yet posted

**Tooling note:** Atlassian Rovo MCP tools (`getAccessibleAtlassianResources`, `getJiraIssue`, `createConfluencePage`, `updateConfluencePage`, comment/transition tools, etc.) were not exposed as callable tools in this documentation session — only `Read`, `Write`, `Edit`, `Grep`, and `Glob` were available. This is the same gap the Planner, Developer, and Reviewer stages all reported for REW-55, and the same gap recorded in this repo's REW-52/REW-53/REW-54/REW-57 documentation sessions. The `cloudId` (`cd111339-8ffc-491c-b2d1-2e9e96a76a43`) supplied for this session should be reused by the next agent/human with working Atlassian access. This file contains everything needed to post both a new release-notes page and an update to the REW-21 implementation page without further investigation.

**Status:** Not posted.

---

## 1. New page to create

**Title:** `Release: REW-55 - Add Favorite Action to Recipe Cards on My Recipes`

**Suggested location:** same Confluence space as the other `Release: REW-*` pages (mirror the space used for `Release: REW-46 - Default recipe author`, if that page exists live — this session could not confirm via `searchConfluenceUsingCql`).

**Page body:**

---

# Release: REW-55 - Add Favorite Action to Recipe Cards on My Recipes

**Status:** Shipped — implemented, code-reviewed (Approved, no blocking issues), QA-reviewed.
**Jira:** [REW-55](https://wanderingnerds.atlassian.net/browse/REW-55)
**Branch:** `REW-55-add-favorite-action-to-recipe-cards`

### What shipped

The Favorite (heart) control that already existed on the single-recipe detail page (REW-21) now also appears on every recipe card under **My Recipes**. Users can favorite or unfavorite a recipe directly from the list, without opening it. Because My Recipes lists both draft and published recipes, and the underlying like API only allows liking published recipes, **draft cards show the same heart in a disabled/muted state** with a tooltip explaining why — rather than omitting the control or letting it silently fail.

### What changed technically

- `src/routes/recipeRoutes.js`: `GET /recipes` batch-fetches the current user's `recipe_likes` rows for the listed recipe IDs (one query, not N+1) and attaches `isLiked` to each recipe before rendering.
- `views/recipes/index.ejs`: each card gets the existing global `.like-btn` control, reused unmodified from REW-21, gated by `recipe.status`.
- `public/css/styles.css`: one new `.like-btn:disabled` rule for the muted draft state.
- No database migration — reuses the `recipe_likes` table and `/api/likes/:recipeId` endpoints exactly as built in REW-21.
- No automated tests added — this repo has no request-level test harness for Supabase-backed routes, including the original REW-21 like routes; consistent with existing convention, confirmed by the Reviewer.

### Where favorite state is now surfaced

| Surface | Since |
|---|---|
| Recipe detail page (heart + count) | REW-21 |
| Liked Recipes page (`/recipes/liked`) | REW-21 |
| My Recipes cards (heart only, no count) | **REW-55** |

All three read/write the same `recipe_likes` table via the same `/api/likes/:recipeId` endpoints, so a favorite toggled from any one of them is reflected on the others.

### Known non-blocking notes

- Draft recipes cannot be favorited until published (existing API rule from REW-21, not changed by REW-55).
- `views/partials/recipe-card.ejs` (used by Browse/Search) was not touched — a natural follow-up, not part of this ticket.
- CSRF protection remains globally disabled app-wide (pre-existing, unrelated to this ticket).

### Documentation

- [Recipe Likes API](https://github.com/WanderingNerds/RecipeWebsite/blob/main/docs/api/recipe-likes.md) *(new page — REW-21 had shipped without one; created as part of REW-55 documentation)*
- `database/README.md` — `recipe_likes` table/RLS/indexes documented *(also a REW-21 gap, closed as part of REW-55 documentation)*
- `docs/RELEASE_NOTES_REW-55.md` — full release notes
- Plan: `docs/plans/rew-55-add-favorite-action-to-recipe-cards.md`

---

## 2. Existing page to update

**Target:** the Confluence page documenting REW-21 "Recipe Likes" (repo has no local markdown mirror of this page's live content, unlike REW-41/REW-44/REW-48/REW-50/REW-52/REW-53 which do — search Confluence by title before posting; do not fork a competing "Favorites" page).

**Section to add**, directly after whatever section documents the original heart control / `.like-btn` component:

---

### REW-55: Favorite Action on My Recipes Cards

**Status:** Complete — implemented, code-reviewed (Approved, no blocking issues), QA-reviewed. See [Release: REW-55 - Add Favorite Action to Recipe Cards on My Recipes] *(link to the new page above once created)*.

The same `.like-btn` component documented above is now also rendered on each card under **My Recipes** (`/recipes`), not just the recipe detail page. `GET /recipes` batch-fetches the user's like status for all listed recipes in one query and attaches it to each recipe before rendering — no new endpoint was added. Draft recipe cards render the control disabled/muted, since `POST /api/likes/:recipeId` only allows liking published recipes (an existing rule from this original build, unchanged). Full detail: [Recipe Likes API](https://github.com/WanderingNerds/RecipeWebsite/blob/main/docs/api/recipe-likes.md).

---

*If this page also has a status/overview table listing shipped tickets, add a row for REW-55 (Done) alongside the existing REW-21 entry.*

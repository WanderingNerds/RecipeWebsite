# Implementation Plan: REW-55 Add Favorite Action to Recipe Cards on My Recipes

**Status:** Planning Complete
**Created:** 2026-09-07

---

## Jira issue

**REW-55** — "Add Favorite Action to Recipe Cards on My Recipes"
Link: https://wanderingnerds.atlassian.net/browse/REW-55

Note: the Atlassian Rovo MCP tools (`getAccessibleAtlassianResources`, `getJiraIssue`, `searchConfluenceUsingCql`, etc.) were not available in this session — calls to them failed with "No such tool available." This plan was built from the full ticket text supplied by the requester (reproduced/summarized below) plus direct codebase investigation, not a live `getJiraIssue` fetch. **Before implementation starts, someone with working Jira/Confluence MCP access (or the requester) should re-fetch REW-55 to confirm no field has changed since this text was captured, and should create/update the Confluence page described below — I could not do either in this session.**

## Confluence page

**Not created/updated — Atlassian MCP tools were unavailable in this session (see note above).**

Recommended target: update the existing Confluence page for REW-21 "Recipe Likes" (or the space's Recipes/Favorites architecture page, if one exists separate from the REW-21 planning doc) with a subsection noting that REW-55 extends the same favorite/like system to the My Recipes list view — link back to this file and to the Jira issue. Do not create a competing "Favorites" page; REW-55 is additive to the REW-21 feature, not a new one.

---

## Summary

The app already has a fully-built favorite/"like" system (delivered under REW-21): a `recipe_likes` join table, `/api/likes/:recipeId` (GET/POST/DELETE) routes, a global `.like-btn` UI component with optimistic toggle + undo-toast behavior (`public/js/likes.js`, loaded on every page via `views/layouts/main.ejs`), and a dedicated "Liked Recipes" page. That heart control currently only appears on the single-recipe view page (`views/recipes/view.ejs`) and is absent from the recipe cards on **My Recipes** (`views/recipes/index.ejs`), forcing users to open a recipe just to favorite it. REW-55 asks us to surface that same existing favorite control directly on each My Recipes card. This is a UI-surfacing task, not a new feature: it reuses the existing `recipe_likes` table, the existing `/api/likes/:recipeId` endpoints, and the existing `.like-btn` markup/JS/CSS as-is. The only real gaps are (1) the My Recipes route currently never fetches the current user's like status for the recipes it lists, and (2) the My Recipes card markup has no `.like-btn` element at all.

---

## Open questions / assumptions

| # | Question | Assumption made (state if you disagree) |
|---|----------|-------------------------------------------|
| 1 | AC1 says "**every** recipe card" gets a Favorite control, but the existing `/api/likes/:recipeId` POST handler (`src/routes/likeRoutes.js` → `recipeExists()`) only allows liking recipes where `status = 'published'`, and `view.ejs` already only renders the like button `<% if (recipe.status === 'published') %>`. My Recipes lists **both draft and published** recipes. | Follow the existing precedent from `view.ejs`: draft cards get a visibly-present but **disabled/muted** heart control (satisfies the letter of AC1 — a control is present on every card — without hitting a 404 from the API). Do not change `recipeExists()`'s published-only rule; that rule is shared by the whole favorite system (it also governs `/recipes/liked`, which filters `.eq("status", "published")`) and changing it is out of scope for this ticket. Flag this explicitly to QA so the disabled-draft-heart behavior isn't mistaken for a bug. **If the Developer/QA/PO would rather drafts be fully favoritable, that's a larger change touching `likeRoutes.js`, `view.ejs`, and `/recipes/liked` — recommend a separate ticket rather than silently expanding REW-55's scope.** |
| 2 | Should the My Recipes card show a like **count**, like `view.ejs` does? | No — the ticket only asks for an on/off favorite indicator ("recognizable heart icon" with active/inactive state), not a public count, and showing your own like count on your own recipe card isn't called out anywhere in the AC. Omit the `.like-btn-count` span. `public/js/likes.js`'s `toggleLikeUI`/`updateLikeCount` already null-check for that span (`if (countSpan) {...}`), so omitting it is safe and requires no JS changes. |
| 3 | Should the same control be added to `views/partials/recipe-card.ejs` (used by `browse.ejs`/`search.ejs`) for consistency? | Out of scope. REW-55's AC only reference "My Recipes." `views/recipes/index.ejs` does not use the shared `recipe-card.ejs` partial — it has its own inline card markup — so this ticket only touches `index.ejs`. Note this as a possible follow-up ticket for the Developer/PO to consider, not something to bundle in here. |
| 4 | Does clicking the heart need a CSRF token? | The app currently has CSRF protection **disabled repo-wide** (`doubleCsrfProtection` is commented out in `src/app.js`, and `res.locals.csrfToken` is hard-coded to `''`). This is a pre-existing condition unrelated to REW-55 and out of scope to fix here, but flagged under Security considerations below since this ticket adds a new state-changing UI entry point. |

---

## Tasks

1. **Batch-fetch the current user's like status for My Recipes.** In `src/routes/recipeRoutes.js`, in the `GET /` (My Recipes) handler, after `recipes` is fetched, issue one additional query against `recipe_likes` scoped to `user_id = req.user.id` and `recipe_id IN (<ids of the recipes on this page>)`, following the exact batching pattern already documented in `docs/plans/REW-21-recipe-likes.md` ("Implementation Notes → Fetching Like Status Efficiently") to avoid N+1 queries. Build a `Set` of liked recipe IDs and attach `isLiked` (boolean) to each recipe object alongside the existing `categories`/`tags` enrichment, before the object is passed to `res.render("recipes/index", ...)`.
2. **Render the Favorite control on each My Recipes card.** In `views/recipes/index.ejs`, add a `.like-btn` element to each card using the same markup/attributes as `views/recipes/view.ejs` (`class="like-btn"`, `data-recipe-id="<%= recipe.id %>"`, `data-liked="<%= recipe.isLiked %>"`, `aria-label` toggling between "Favorite this recipe"/"Remove from favorites", inner `<span class="like-btn-icon">&#9829;</span>` only — no count span per Open Question 2). Place it as a **sibling of the title `<a>`**, in the existing header flex row next to the draft/published badge (mirroring `view.ejs`'s placement pattern), not nested inside any `<a>` — this avoids invalid nested-interactive-element markup and prevents the heart click from also triggering the recipe-detail navigation (addresses AC9).
3. **Gate the control by publish status per Open Question 1.** For `recipe.status === 'published'` cards render the control active/clickable as in step 2. For `recipe.status === 'draft'` cards, render the same heart markup but visually disabled/muted (e.g. `disabled` attribute or a `.like-btn-guest`-style muted class already present in `public/css/styles.css`) with a `title`/`aria-label` explaining why (e.g. "Publish this recipe to add it to favorites"), so it does not attempt a request that the API will 404 on.
4. **Confirm no JS/CSS changes are needed.** `public/js/likes.js` is loaded globally via `views/layouts/main.ejs` (line 44) and binds its click handler with `document.addEventListener`, so it will already pick up the new `.like-btn` elements on My Recipes with zero wiring changes. `.like-btn` styling, including the REW-50 mobile 44×44px tap-target rule, already exists in `public/css/styles.css`. This task is a verification step for the Developer, not expected to produce a diff in either file — if card layout on My Recipes needs new spacing/positioning rules that don't already exist for `.feature-card`'s header row, add the minimum CSS necessary at that time.
5. **Manual verification pass** against AC8/AC9: confirm the existing View/Edit/Delete buttons and the Delete confirmation form (`views/recipes/index.ejs` lines ~134–141) are untouched and that clicking anywhere else on the card (thumbnail, title, action buttons) behaves exactly as before.
6. **Cross-surface consistency check**: after favoriting/unfavoriting from My Recipes, confirm the same recipe's like state is reflected on `views/recipes/view.ejs` (heart + count) and on `/recipes/liked` (appears/disappears from the list) without any additional code — this should fall out naturally from reusing the shared `recipe_likes` table and `/api/likes/:recipeId` endpoints, but must be explicitly checked since it's AC7.

---

## Affected files

- `src/routes/recipeRoutes.js` — `GET /` handler (My Recipes list, ~lines 346–433): add a batched query against `recipe_likes` for `req.user.id` scoped to the fetched recipe IDs, and attach `isLiked` to each recipe passed to the view. No new helper needed beyond what already exists (`hasUserLiked`/`getLikeCount` helpers in this file are per-recipe and not reused here — a single batched `.in("recipe_id", ids)` query is more appropriate for a list page, per REW-21's own recommended pattern).
- `views/recipes/index.ejs` — add the `.like-btn` favorite control to each recipe card, gated by `recipe.status`, placed as a sibling of the title link in the existing header row (~lines 77–88).
- No changes expected to: `src/routes/likeRoutes.js` (existing `/api/likes/:recipeId` endpoints are reused unmodified), `public/js/likes.js` (existing global delegated handler covers the new markup), `public/css/styles.css` (`.like-btn` and related classes already exist and already have mobile tap-target sizing from REW-50), `database/migrations/008_create_recipe_likes_table.sql` / RLS policies (unchanged — same table, same policies), `views/partials/recipe-card.ejs` and `views/recipes/liked.ejs` (out of scope, see Open Question 3), `src/routes/index.js` `/recipes/liked` route (unchanged).

---

## Database changes

**None.** REW-55 reuses the `recipe_likes` table and RLS policies created in migration `008_create_recipe_likes_table.sql` (composite PK on `(user_id, recipe_id)`, RLS restricting SELECT/INSERT/DELETE to the owning user, `get_recipe_like_count()` helper function) exactly as-is. No new migration file should be added under `database/migrations/` for this ticket.

---

## Security considerations

- **Auth**: `/api/likes/:recipeId` POST/DELETE already require `requireApiAuth` (validates the `sb-access-token` cookie via Supabase before allowing the mutation). The new My Recipes heart control calls these same endpoints — no new auth surface is introduced.
- **Authorization/ownership**: Row Level Security on `recipe_likes` (`user_id = auth.uid()`) already guarantees a user can only create/delete their own like rows regardless of which page the request originates from, so a user cannot use this new UI surface to manipulate another user's favorites.
- **Rate limiting**: the existing `likeLimiter` (30 actions/minute/user) on `/api/likes/:recipeId` already covers this new entry point; no change needed, but note that rapid favoriting across many cards on a single My Recipes page (e.g. a user with dozens of recipes double-clicking through them) is bounded by the same limiter.
- **CSRF**: CSRF protection is currently disabled repo-wide (`doubleCsrfProtection` commented out in `src/app.js`, `csrfToken` hard-coded to `''`). This is a pre-existing gap, not introduced by REW-55, but Reviewer should be aware that this ticket adds another clickable, unauthenticated-by-token, state-changing control to a page — worth a callout if/when CSRF re-enablement is scoped separately.
- **Input validation**: `recipeId` is validated against `UUID_PATTERN` server-side in `likeRoutes.js` before any query runs; the My Recipes card will interpolate `recipe.id` (a UUID already trusted elsewhere on this same page for the View/Edit/Delete links) into `data-recipe-id`, consistent with existing usage.
- **Draft-recipe gating**: disabling the control for drafts (Open Question 1) is itself a minor security/data-integrity safeguard — it prevents a client from attempting to like content that isn't meant to be publicly favoritable yet, consistent with `recipeExists()`'s existing published-only check.
- **XSS**: no new unescaped output — `recipe.id`/`recipe.status` are already used unescaped-safe (UUID/enum-like values) elsewhere on this page; no free-text user input is introduced by this change.

---

## Acceptance criteria

(Restated from the Jira ticket, to be verified by QA against the running app; note AC1 should be read together with Open Question 1's disabled-draft-card resolution.)

- [ ] Every recipe card under My Recipes includes a Favorite (heart) control, including draft recipe cards (shown in a disabled/muted state per Open Question 1, since drafts aren't favoritable via the existing API).
- [ ] The control clearly shows unfilled/inactive state for a recipe that is not currently favorited by the logged-in user, and filled/active state for one that is.
- [ ] Clicking an inactive Favorite control on a published recipe's card immediately favorites it (heart fills in) without navigating to View or refreshing the page.
- [ ] Clicking an active Favorite control on a published recipe's card immediately unfavorites it (heart empties) without navigating away or refreshing the page.
- [ ] The visual heart state updates immediately (optimistic UI) and reflects the server-confirmed state after the `/api/likes/:recipeId` response resolves; a failed request reverts the UI (existing `likes.js` behavior).
- [ ] After favoriting/unfavoriting from My Recipes, then leaving and returning to (or refreshing) My Recipes, the heart state persists correctly (reflects `recipe_likes` table state via the newly batched query).
- [ ] A recipe favorited/unfavorited from My Recipes shows the same state on `views/recipes/view.ejs` and correctly appears/disappears from `/recipes/liked` — i.e., the same underlying favorite status is used everywhere, not a My Recipes-specific one.
- [ ] Existing View, Edit, and Delete buttons/forms on each My Recipes card continue to work exactly as before (Delete still shows its confirm dialog and CSRF hidden field submission is unaffected).
- [ ] Clicking the Favorite control does not also trigger navigation to the recipe detail page (no nested-link click-through), and clicking elsewhere on the card (thumbnail, title, View/Edit/Delete) is unaffected by the new control's presence.
- [ ] On mobile viewport widths, the Favorite control meets the ~44×44px tap-target sizing already defined for `.like-btn` (REW-50) and does not visually overlap the Draft/Published badge or action buttons.
- [ ] Unauthenticated requests to `/recipes` (My Recipes) are unaffected — this page already requires `requireAuth`, so no guest-state heart variant is needed here (unlike public pages).

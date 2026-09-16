# REW-88 — Standardize Cookbook Recipe Card Content & Actions

## Jira issue

[REW-88 — Standardize Cookbook Recipe Card Content & Actions](https://wanderingnerds.atlassian.net/browse/REW-88)
Task, Medium, status **To Do**, parent epic [REW-2 — Phase 2: Core Recipe Organization & Import](https://wanderingnerds.atlassian.net/browse/REW-2).
Branch: `REW-88-standardize-cookbook-recipe-card`.

Related tickets (read-only observations — I did not create, edit, transition, or assign anything):

- [REW-86 — Standardize My Recipes Recipe Card Content & Actions](https://wanderingnerds.atlassian.net/browse/REW-86) — **merged to `main` as `8b91438`**. Built the standardized owner card in `views/partials/recipe-summary-card.ejs`: `Label: value` metadata, `+ Cookbook`, the inert Share placeholder, the Private/Public toggle.
- [REW-87 — Standardize My Favorites Recipe Card Content & Actions](https://wanderingnerds.atlassian.net/browse/REW-87) — **merged to `main` as `79949cd`**. Introduced the `surface` local and per-card `isOwner`. **This is the exact pattern REW-88 extends — do not invent a new one.**
- [REW-59 — Standardize Browse Recipe Card Content & Actions](https://wanderingnerds.atlassian.net/browse/REW-59) — established the `Category: Answer` labels this ticket must match.
- [REW-18 — Recipe Sharing](https://wanderingnerds.atlassian.net/browse/REW-18) — owns real Share behavior. REW-88 ships the same inert placeholder.
- [REW-100 — Allow adding another user's published recipe to a cookbook](https://wanderingnerds.atlassian.net/browse/REW-100) — **To Do**. Not a dependency, but it is the reason the cookbook card must compute ownership per card rather than assuming it.
- [REW-19 — Cookbook Sharing](https://wanderingnerds.atlassian.net/browse/REW-19) — **Done**. The reason the owner-only status pill still carries real information on this page (see Open Question 1).
- [REW-82 — Standardize Recipe Card Size and Formatting Across All Pages](https://wanderingnerds.atlassian.net/browse/REW-82) — owns cross-surface sizing. Do not chase pixel parity here.
- [REW-89 — Standardize Meal Plan Recipe Card Content & Actions](https://wanderingnerds.atlassian.net/browse/REW-89) — sibling ticket. `views/meal-plans/view.ejs` has the same hand-rolled shape; build so it can adopt the partial without another rewrite.

**One new ticket is probably needed — I cannot create it, Developer should (see "Security considerations"):** `POST /recipes/:id/delete` still has no route-level `csrfProtection`, unlike `/:id/visibility` and `/:id/clone`. REW-87 flagged this and recommended a separate ticket; none was filed. REW-88 puts a Delete button on a **third** page.

## Confluence page

[REW-88 — Standardize Cookbook Recipe Card Content and Actions — Implementation Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31850497/REW-88+Standardize+Cookbook+Recipe+Card+Content+and+Actions+Implementation+Plan)
(space `Recipe`, created new — no existing page covered this surface. Sits alongside the [REW-86 plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31391745) and [REW-87 plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31653889) it follows, and [Cookbooks (REW-62, REW-19)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25067521), which documents the cookbook model and the sharing behavior this card must not regress.)

## Summary

`views/cookbooks/view.ejs` still hand-rolls its own recipe card inline (lines 75–121): `Prep:` / `Cook:` / `N servings` labels, no difficulty, no tags, no favorite heart, no Edit, no Delete, no Share, plus a read-only Private/Public pill and the cookbook-specific Remove form. REW-86 and REW-87 already built every control this ticket asks for inside `views/partials/recipe-summary-card.ejs`, driven by an optional `surface` local and a per-card `isOwner` flag.

REW-88 is therefore **not a new card**. It is three things: teach the shared partial a fourth surface (`'cookbook'`), point `views/cookbooks/view.ejs` at it, and widen the route query so the card actually receives the columns it needs (`user_id`, `original_author`, categories, tags, plus a batched `isLiked`). Two things make this surface different from the three that already exist: `+ Cookbook` must be suppressed (the recipe is already in a cookbook), and the page-specific **Remove from cookbook** action must be carried into the shared card — which means the partial needs to learn the cookbook id.

## Open questions / assumptions

1. **Keep the read-only Private/Public pill, owner-only.** The ticket's requirement list does not mention a status pill, and REW-87's plan flagged the existing one as "misleading for someone else's recipe" and explicitly assigned the cleanup to REW-88.
   - **Assumption:** keep it, but gate it on `isOwner`. Rationale: a cookbook can contain the owner's **Private** recipes, and REW-19 sharing filters those out of the public `/c/:id` view. The pill is the only place the owner is told "this recipe will not appear to the people I share this cookbook with." That is genuinely cookbook-specific information, and silently deleting it is a regression against REW-19.
   - There is **no** Private/Public **toggle** on this surface — the ticket omits it, and REW-87 already set the precedent that owners flip visibility from My Recipes.
   - If the user disagrees, this is a one-flag change (`showStatusPill = isBrowse`) plus the two source-text tests in item 9.
2. **Remove must survive.** The ticket lists card content, but its final acceptance criterion says formatting stays consistent "while preserving these page-specific actions." Remove-from-cookbook is that action, it is the only way to get a recipe out of a cookbook, and `src/views/recipeCard.test.js` pins it today. **Assumption:** Remove is carried into the shared card on the cookbook branch, keeping its hidden `_csrf`, its hidden `returnTo=cookbook`, and its distinct confirm copy.
3. **Remove and Delete on one row is a real hazard.** "Remove from cookbook" and "Delete recipe forever" end up one tap apart for an owner. **Assumption:** order the row `+ Meal Plan`, `Share`, `Remove`, `Edit`, `Delete` so `Edit` physically separates the two, `Delete` stays last and stays red (`var(--error-color)`), `Remove` stays a plain outline button, and the two confirm dialogs keep their different wording. Flag to the user if they want stronger separation than that.
4. **Title links to `/recipes/:id`** — unchanged from today's behavior and consistent with My Recipes and Favorites. `GET /recipes/:id` serves own-or-published and computes its own `isOwner`, so it stays correct for post-REW-100 non-owned entries.
5. **Ownership is mixed in principle, uniform in practice today.** The RLS INSERT policy on `cookbook_recipes` (migration `010`) still enforces own-recipes-only, so every recipe in a cookbook today belongs to the cookbook owner and `isOwner` will always be true. REW-100 changes that. **Assumption:** compute `isOwner` per card anyway — the partial already does it for free, it is defense in depth, and it means REW-100 needs no view change at all.
6. **The heart is disabled for Private recipes**, exactly as on My Recipes: `/api/likes` requires `status = 'published'` server-side, and the partial already renders a disabled heart with an explanatory title. QA/Reviewer should treat that as correct, not a bug.
7. **Chips are static text, not links**, matching the Favorites branch. `/recipes?category=` filters *your own* recipes, so following one from a cookbook entry (especially a post-REW-100 non-owned one) would land on an unrelated, often empty list. The partial's existing `chipsAreLinks = isMyRecipes` already gives this for free.
8. **The public shared cookbook view `/c/:id` is out of scope.** `views/cookbooks/public-view.ejs` renders the lightweight `views/partials/recipe-card.ejs` and is anonymous-capable, so most of REW-88's controls (heart, `+ Meal Plan`, Edit, Delete) do not apply there. **Assumption:** leave it alone. Flag to the user if they want it ticketed.
9. **Two existing tests read the raw template text of `views/cookbooks/view.ejs` and will break.** Both are correct-to-update, not bugs, and both must be justified to the Reviewer rather than quietly loosened:
   - `src/views/cookbookSharing.test.js` line 140 asserts `/class="badge-draft badge-draft-sm">Private</` against the **file source**. Once the per-recipe pill lives in the partial, that literal is gone from this file. Repoint it at `views/partials/recipe-summary-card.ejs`, or render the page and assert on output. Its sibling assertion on `cookbook-visibility-badge cookbook-visibility-private` still passes and must keep passing — the point of that test (the cookbook-level control must not be confusable with a per-recipe pill) survives and should be preserved.
   - `src/views/recipeCard.test.js` line 277 asserts `/class="recipe-card-actions"[^>]*flex-wrap: wrap/`. The partial emits `class="recipe-card-actions recipe-summary-actions"`, so the closing quote in that pattern makes it fail. Loosen it to match the shared class list.
   - **Caution:** `src/views/recipeVisibility.test.js` line 64 asserts `views/cookbooks/view.ejs` does **not** contain the phrase `another user's published recipe`. Do not write that phrase into a comment in that file. Its line 65 `/>Private<\/span>/` assertion still passes via the cookbook-level sharing control, so that test should otherwise be untouched.
10. **No pagination on the cookbook page.** `getCookbookRecipes` fetches every row unbounded. Pre-existing; a richer card makes a large cookbook heavier but not broken. Out of scope — flag if the user wants it ticketed.

## Tasks

Ordered so each step is independently reviewable. Steps 1–2 are partial surgery, step 3 is the swap, steps 4–5 feed it, step 6 is tests.

1. **Add the `'cookbook'` surface to `views/partials/recipe-summary-card.ejs`, and split the heart from the status pill.** Today `showStatusPill = isBrowse` and the heart is rendered in that flag's `else` branch, so the two are mutually exclusive. The cookbook surface needs the heart **and** (per Open Question 1) an owner-only pill, so they must become two independent flags rendering into the same header flex container:
   - `isCookbook = cardSurface === 'cookbook'`
   - `showFavoriteHeart = !isBrowse` — unchanged behavior for the existing three surfaces
   - `showStatusPill = isBrowse || (isCookbook && isOwner)`
   - `showCookbookAdd = !isBrowse && !isCookbook` — this is the ticket's "do not display + Cookbook" requirement
   - Everything else falls out of flags that already exist: `recipeHref` → `/recipes/:id`, `showOwnerControls = isOwner && !isBrowse` → Edit/Delete, `chipsAreLinks = isMyRecipes` → static chips, `showAdaptedFrom = !isBrowse` → attribution shown.

   **Output for `surface: 'browse'`, `'my-recipes'`, and `'favorites'` must be byte-identical afterwards.** `src/views/recipeCard.test.js` is the guard and should pass untouched before any cookbook wiring begins. Do this as its own commit.

2. **Add the cookbook action row and teach the partial the cookbook id.** Add an optional `cookbookId` local, resolved defensively with `typeof` exactly the way `surface` and `selectedCategory` already are (EJS throws on undefined locals). Add a fourth `else if (isCookbook)` branch to the action-row block rather than unifying the four rows — a fourth branch cannot regress the other three, and REW-82 owns any later unification. The row uses `class="recipe-card-actions recipe-summary-actions"` with `margin-top: auto` (copy the favorites branch, which also has no visibility control above it to hold the card's bottom spacing), and contains, in this order:
   - `+ Meal Plan` — the existing `meal-plan-add-btn` markup including its guest variant.
   - `Share` — the identical inert placeholder REW-86/REW-87 ship: `disabled`, `aria-disabled="true"`, `title="Sharing is coming soon"`, no `href`, no handler, no endpoint, no target URL. Carry a comment naming REW-18 as the owner of real behavior.
   - `Remove` — the form from `views/cookbooks/view.ejs` lines 115–119, moved verbatim: `action="/cookbooks/<cookbookId>/recipes/<recipe.id>/remove"`, hidden `_csrf`, hidden `returnTo=cookbook`, existing confirm copy. Render it only when `cookbookId` is present, so a caller that forgets to pass it degrades to no button rather than to a broken URL.
   - `Edit` and `Delete` — only when `showOwnerControls`, reusing the exact markup from the favorites branch including the confirm and the hidden `_csrf`.
   - **No `+ Cookbook` button on this branch.**

3. **Point `views/cookbooks/view.ejs` at the shared card.** Replace the inline `<div class="feature-card">…</div>` block (lines 75–121) with an include passing `recipe`, `surface: 'cookbook'`, and `cookbookId: cookbook.id`, following the call shape already used at `views/recipes/liked.ejs` line 23. Keep the `organization-card-grid` wrapper (`src/views/organizationCardGrid.test.js` asserts it), the page header, the cookbook-level visibility control, the share panel, the empty state, and the `<script src="/js/cookbook-share.js">` tag untouched. `user` and `csrfToken` reach the partial through `res.locals`, exactly as they already do on the other three surfaces.

4. **Widen `getCookbookRecipes` in `src/routes/cookbookRoutes.js` (lines 56–75).** It has exactly one caller (line 611), so this is safe. Extend the nested `recipes(...)` select to add `user_id`, `original_author`, and the embedded `recipe_categories(categories(id, name, slug, icon))` / `recipe_tags(tags(id, name, slug))` relations — mirror `FAVORITE_CARD_COLUMNS` at `src/routes/index.js` line 69. Flatten the junction rows into flat `categories` / `tags` arrays using the same `?.` + `.filter(Boolean)` mapping as `src/routes/index.js` lines 130–140. Keep the existing defensive drop of a null `recipes` embed, and keep the junction-row `created_at` ordering (added-to-cookbook order, newest first). One query — do **not** copy the per-recipe fan-out that `GET /recipes` still uses. Consider exporting the helper so step 6 can test it directly.

5. **Stamp `isLiked` in `GET /cookbooks/:id` (line 594).** The heart needs it. Batch-fetch on the request-scoped client following `src/routes/recipeRoutes.js` lines 646–660 exactly: collect the recipe ids, issue one `recipe_likes` query filtered by `.eq("user_id", req.user.id)` and `.in("recipe_id", ids)`, build a `Set`, stamp `isLiked` per recipe. Skip the query entirely when the cookbook is empty. Log and continue on error (heart renders unfavorited) rather than failing the page — same as the My Recipes handler.

6. **Tests.**
   - `src/views/recipeCard.test.js` — rewrite `'Cookbook recipe cards expose the meal-plan trigger and preserve protected controls'` (lines 261–278). New coverage: an **owner** card shows the title link, the live heart with `data-liked`, author, tags, all four `Label: value` fields, `+ Meal Plan`, Share, Remove (with `_csrf`, `returnTo=cookbook`, confirm), Edit, Delete — and **no** `cookbook-add-btn`, **no** `/visibility`, **no** `Make Public`/`Make Private`. A **non-owner** card (different `user.id`, exercising the post-REW-100 shape) shows the shared controls and Remove but **no** Edit, **no** Delete, and **no** status pill. A **draft** recipe renders the disabled heart and the `Private` pill for its owner. The raw `user_id` must never appear in the HTML. Chips must not be links. Fix the `recipe-card-actions` regex per Open Question 9.
   - `src/views/recipeCard.test.js` — the existing Browse, My Recipes, Favorites, and `'REW-86 owner-only controls never leak onto the public Browse card'` tests must keep passing **unmodified**.
   - `src/views/cookbookSharing.test.js` — repoint the line-140 assertion per Open Question 9 without weakening what it proves.
   - Route-level — add coverage for the widened `getCookbookRecipes` / `GET /cookbooks/:id` in the `responseRecorder()` + injected-fake-client style of `src/routes/likedRecipes.test.js`: the select string requests `user_id`, `original_author`, `recipe_categories(`, `recipe_tags(`; categories/tags are flattened and a null embed is tolerated; `isLiked` is stamped from one batched query, not N; an empty cookbook issues no likes query at all.

7. **Run `npm test`.** Then self-verify the acceptance criteria below (QA is being skipped on this run) and hand to Reviewer with the two intentional test edits from Open Question 9 called out explicitly.

## Affected files

- `views/partials/recipe-summary-card.ejs` — **primary change.** Fourth `surface`, heart/pill split, `showCookbookAdd`, optional `cookbookId`, new cookbook action-row branch. The existing three surfaces must be byte-stable.
- `views/cookbooks/view.ejs` — delete the inline card block (lines 75–121) and include the shared partial instead. Header, cookbook visibility control, share panel, grid wrapper, empty state, and the `cookbook-share.js` tag all unchanged.
- `src/routes/cookbookRoutes.js` — widen `getCookbookRecipes` (lines 56–75) and stamp batched `isLiked` in `GET /:id` (line 594). No change to any mutation handler, rate limiter, or auth guard.
- `src/views/recipeCard.test.js` — rewrite the cookbook card test; fix the `recipe-card-actions` regex; leave the browse/my-recipes/favorites tests untouched.
- `src/views/cookbookSharing.test.js` — repoint the per-recipe-pill source assertion (Open Question 9).
- `src/routes/cookbookRoutes.test.js` — **new**, or extend an existing cookbook route test file. Column/flattening/`isLiked` coverage.
- `public/css/styles.css` — **verify only.** `.recipe-summary-card` and `.recipe-summary-actions` already exist (lines ~2881–2947) and `.organization-card-grid` (line 1669) already pairs with them on `liked.ejs`. Add a rule only if the heart-plus-pill header or the five-control action row demonstrably breaks at 375px.
- `views/cookbooks/public-view.ejs`, `views/partials/recipe-card.ejs` — **do not touch.** Out of scope per Open Question 8; `recipe-card.ejs` is still used by Search and both public views.
- `src/views/organizationCardGrid.test.js`, `src/views/recipeVisibility.test.js` — no edit expected; re-verify after the swap (see the Open Question 9 caution about `recipeVisibility.test.js` line 64).
- `views/recipes/browse.ejs`, `views/recipes/index.ejs`, `views/recipes/liked.ejs` — **no edits expected**; they share the partial and must be re-verified after task 1.

## Database changes

**No migration is required.** Every read this card adds is already permitted by applied policies:

- `recipes.user_id`, `original_author`, `status` — migration `001_create_recipes_table.sql` grants SELECT on own rows (`auth.uid() = user_id`) and on any `status = 'published'` row, all columns. That covers both today's owner-only cookbooks and post-REW-100 non-owned published entries.
- `recipe_categories` / `recipe_tags` — migrations `005` / `006` grant owner SELECT (which is what makes the chips on the owner's **Private** recipes readable), and `013_public_recipe_card_metadata.sql` adds published-recipe SELECT for `anon` and `authenticated` plus the matching `categories` / `tags` lookups. Both halves are needed on this page and both already exist.
- `recipe_likes` — read on the request-scoped client, already RLS-scoped to the caller.
- Remove, Edit, Delete, and `+ Meal Plan` all reuse existing policies unchanged.

If a migration turns out to be needed after all, it must be a **new** file in `database/migrations/` following the `NNN_description.sql` convention — never an edit to an applied one. `020_add_meal_plan_sharing.sql` is the highest applied number, so `021` is next free. Note that REW-87 planned but did **not** ship a `021_allow_public_recipes_in_cookbooks.sql`; that widening now belongs to REW-100, so REW-88 must not claim `021` without re-checking first.

## Security considerations

- **`isOwner` is presentational only.** It decides whether Edit/Delete are *drawn*. Real enforcement is unchanged and must stay: `POST /recipes/:id/delete` filters `.eq("user_id", req.user.id)` on top of owner-only RLS, and `GET /recipes/:id/edit` + `POST /:id/update` enforce ownership independently. The card's flag must never become the only check.
- **Do not render `recipe.user_id` into the HTML.** It is fetched solely to compute the flag. Assert its absence in the view tests, as the favorites tests already do.
- **Remove stays cookbook-owner-scoped.** `POST /cookbooks/:id/recipes/:recipeId/remove` (`src/routes/cookbookRoutes.js` line 552) keeps its `requireAuth`, `cookbookLimiter`, UUID guard, and owner check. Moving the form's markup into a shared partial changes nothing server-side, and the `cookbookId` interpolated into the action must stay on escaped `<%= %>` output.
- **Owner controls must not leak across surfaces.** After task 1, re-confirm `surface: 'browse'` still renders no heart, Edit, Delete, Share, `+ Cookbook`, or visibility toggle — **including when the signed-in viewer owns the browsed recipe**. The existing REW-86 leak test must pass unmodified.
- **`+ Cookbook` suppression is a display rule, not a security boundary.** `POST /api/cookbooks/:id/recipes/:recipeId` keeps `requireApiAuth`, its per-user limiter, its UUID guards, and its duplicate-safe upsert. Do not weaken any of them to make the button disappear.
- **CSRF.** Remove and Delete are urlencoded form POSTs covered by the global `csrfProtectionExceptMultipart` in `src/app.js`, and both keep their own hidden `_csrf` field. **Pre-existing finding to flag, not silently fix:** `POST /recipes/:id/delete` (`src/routes/recipeRoutes.js` line 972) has no route-level `csrfProtection`, unlike `/:id/visibility` and `/:id/clone`, so the global wrapper's deliberate `multipart/form-data` skip leaves a forged cross-site multipart POST unchecked. REW-87 recommended a separate ticket and none was filed; REW-88 adds a Delete button to a third page. **Developer should create that ticket** — a security fix does not belong inside a card-layout ticket.
- **No new endpoints, no new rate limiters, and no weakening of helmet, CORS, `express-rate-limit`, or auth middleware.** The only route change is widening two read queries.
- **No inline scripts.** helmet's CSP is `scriptSrc: ['self']`. All card behavior rides the existing `/js/likes.js`, `/js/meal-plans.js`, and the `window.fetch` wrapper in `/js/main.js` that injects `x-csrf-token`; do not bypass it.
- **Escaping.** Titles, authors, `original_author`, and tag names are user-controlled — and post-REW-100 they can come from *other* users. Every field stays on `<%= %>`. Exercise the existing `<script>alert(1)</script>` fixture through the cookbook branch.
- **Share leaks nothing.** Inert placeholder only: no `href`, no target URL, no share endpoint. It must never link to `/r/:id`, which would be wrong and misleading for a Private recipe sitting in a cookbook.
- **The owner-only status pill must not become a leak.** It renders only when `isOwner`, so a post-REW-100 viewer never sees a status claim about another user's recipe.

## Acceptance criteria

Written so the Developer can self-verify and the Reviewer can re-check — QA is skipped on this run. Items marked *(automated)* should be covered by `npm test`.

- [ ] *(automated)* A cookbook card for a recipe the viewer **owns** shows: thumbnail when present, clickable title, favorite heart, author, category and tag chips, `Prep Time:`, `Cook Time:`, `Servings:`, `Difficulty:`, `+ Meal Plan`, `Share`, `Remove`, `Edit`, `Delete`.
- [ ] *(automated)* No cookbook card renders a `+ Cookbook` button — `cookbook-add-btn` is absent from the rendered page.
- [ ] *(automated)* A cookbook card for a recipe the viewer does **not** own shows the shared controls and `Remove`, but **no** `Edit`, **no** `Delete`, and **no** status pill.
- [ ] *(automated)* The four metadata fields render as `Label: value` and match, character for character, the labels shown for the same recipe on a Browse card. The old `Prep:` / `Cook:` / `N servings` strings are gone.
- [ ] *(automated)* A recipe missing prep time, cook time, servings, difficulty, tags, categories, author, or thumbnail renders no stray label, no empty chip row, and no `undefined` / `null` text.
- [ ] *(automated)* The rendered cookbook page contains no recipe `user_id` value.
- [ ] *(automated)* Category and tag chips on this surface are plain text, not `/recipes?category=` / `?tags=` links.
- [ ] *(automated)* A Private recipe owned by the viewer renders the **disabled** heart with its explanatory title plus the `Private` pill; a Public one renders the live heart and the `Public` pill.
- [ ] *(automated)* The Remove form keeps `action="/cookbooks/:cookbookId/recipes/:recipeId/remove"`, its hidden `_csrf`, its hidden `returnTo=cookbook`, and its distinct "Remove this recipe from the cookbook?" confirm.
- [ ] *(automated)* Browse, My Recipes, and My Favorites card output is unchanged — their existing tests pass **unmodified**, including the REW-86 "owner-only controls never leak onto the public Browse card" test.
- [ ] *(automated)* Search, public cookbook, and public meal-plan pages still render the old `recipe-card` partial unchanged.
- [ ] *(automated)* The cookbook page still renders inside `organization-card-grid`, and the cookbook-level Public/Private control plus the share panel are untouched.
- [ ] *(automated)* `GET /cookbooks/:id` issues **one** recipe query and **one** likes query regardless of recipe count, and issues no likes query at all for an empty cookbook.
- [ ] *(automated)* `getCookbookRecipes` requests `user_id`, `original_author`, `recipe_categories(`, and `recipe_tags(`; flattens them into `categories` / `tags`; and tolerates a null embed without throwing.
- [ ] *(automated)* A recipe titled `<script>alert(1)</script>` with a tag of the same shape renders escaped on the cookbook card.
- [ ] Clicking a cookbook card title opens `/recipes/:id` and the page loads.
- [ ] Clicking the heart on a Public recipe in a cookbook toggles favorite state without a full-page navigation, and the state survives a reload.
- [ ] `+ Meal Plan` opens the existing modal and adds the recipe, including for a Private recipe the viewer owns.
- [ ] `Remove` removes the recipe from the cookbook, returns to the cookbook page, and leaves the recipe itself intact and still visible on My Recipes.
- [ ] `Edit` opens `/recipes/:id/edit`; `Delete` prompts for its own distinct confirm and removes the recipe (landing on `/recipes` is expected and unchanged).
- [ ] `Remove` and `Delete` are not adjacent in the action row, their confirm dialogs read differently, and `Delete` is the only red control.
- [ ] `Share` is visible on every cookbook card, is clearly inert, performs no navigation or request, and exposes no URL.
- [ ] A crafted `POST /cookbooks/:id/recipes/:recipeId/remove` against a cookbook the caller does not own removes nothing.
- [ ] A crafted `POST /recipes/:id/delete` for a recipe owned by someone else deletes nothing.
- [ ] The cookbook page renders correctly with 0, 1, and many recipes; the empty state and its Add Recipes call to action still appear at 0.
- [ ] Card actions wrap rather than overflow at 375px width on both the owner and non-owner variants.
- [ ] All controls are keyboard reachable with visible focus; the heart and any icon-only control have accessible labels.
- [ ] `npm test` passes, with the two intentional test edits (`cookbookSharing.test.js` line 140, `recipeCard.test.js` line 277) justified to the Reviewer rather than quietly loosened.

# REW-86 — Standardize My Recipes Recipe Card Content & Actions

## Jira issue

[REW-86 — Standardize My Recipes Recipe Card Content & Actions](https://wanderingnerds.atlassian.net/browse/REW-86)
Task, Medium, status **To Do**, parent epic [REW-2 — Phase 2 — Core Recipe Organization & Import](https://wanderingnerds.atlassian.net/browse/REW-2).

Related tickets (read-only observations — I did not create, edit, or transition anything):

- [REW-59 — Standardize Browse Recipe Card Content & Actions](https://wanderingnerds.atlassian.net/browse/REW-59) — **In Progress**. Hard dependency, see "Open questions / assumptions".
- [REW-18 — Recipe Sharing](https://wanderingnerds.atlassian.net/browse/REW-18) — **To Do**. Owns the actual Share behavior REW-86 deliberately does not implement.
- [REW-82 — Standardize Recipe Card Size and Formatting Across All Pages](https://wanderingnerds.atlassian.net/browse/REW-82) — **To Do**. Owns cross-surface sizing; REW-86 should not chase pixel parity.
- [REW-87](https://wanderingnerds.atlassian.net/browse/REW-87) / [REW-88](https://wanderingnerds.atlassian.net/browse/REW-88) / [REW-89](https://wanderingnerds.atlassian.net/browse/REW-89) — sibling "standardize card" tickets for My Favorites, Cookbook, Meal Plan. Same shared partial. Build for reuse.

## Confluence page

[REW-86 — Standardize My Recipes Recipe Card Content and Actions — Implementation Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/31391745)
(space `Recipe`; sits alongside the existing REW-59 plan/release pages and [REW-55: Add Favorite Action to Recipe Cards on My Recipes](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/24182794), which documents the favorite control this ticket inherits.)

## Summary

`views/partials/recipe-summary-card.ejs` is already the single card template for both My Recipes (`isPublic: false`) and Browse (`isPublic: true`), and it already delivers most of REW-86's checklist: clickable title, favorite heart, author, categories, tags, `+ Meal Plan`, Edit, Delete. Three requirements are genuinely missing on `main`: an owner **Private/Public toggle** (the card renders a read-only `badge-draft`/`badge-published` pill, and there is no recipe-level visibility endpoint at all — cookbooks and meal plans have one, recipes do not), a **`+ Cookbook`** action (today adding to a cookbook is only reachable from the recipe detail page or `/cookbooks/:id/add-recipes`), and a **Share** button (a visible placeholder only; behavior belongs to REW-18). A fourth requirement — the `Prep Time:` / `Cook Time:` / `Servings:` / `Difficulty:` label format — is a small relabel of the metadata row, currently rendered as `Prep:`, `Cook:`, `N servings`, and a bare difficulty value.

## Open questions / assumptions

1. **REW-59 overlap is the biggest risk in this ticket.** REW-59 is In Progress on its own branch and, per its Confluence release-notes page, has *already* changed the same shared partial to the exact `Prep Time` / `Cook Time` / `Servings` / `Difficulty` labels and *already* added "a new authenticated cookbook JSON API [that] lists owned cookbooks/membership and performs rate-limited, UUID-validated, duplicate-safe adds" plus migration `019_allow_public_recipes_in_cookbooks.sql`. None of that is on `main` yet.
   - **Assumption:** REW-86 is built on top of `main` *after* REW-59 merges. Developer should rebase `REW-86-standardize-my-recipes-card` onto `main` once REW-59 lands and re-check Tasks 1 and 3 — they may already be satisfied, in which case those tasks reduce to verification plus tests.
   - If REW-59 has **not** merged when work starts, REW-86 must implement the label change and the cookbook-add action itself, and a merge conflict in `views/partials/recipe-summary-card.ejs` is near-certain. Raise this with the user before writing the cookbook API twice.
   - **Note for whoever merges REW-59:** its `019_allow_public_recipes_in_cookbooks.sql` collides with the already-applied `database/migrations/019_add_cookbook_sharing.sql` on `main`. Not REW-86's problem to fix, but REW-86's migration numbering must not collide either (see "Database changes").
2. **Visibility toggle mechanism.** Assumption: a plain `<form method="POST">` + redirect, mirroring the cookbook control in `views/cookbooks/view.ejs` — *not* AJAX. Rationale: flipping to Private must also disable the favorite heart on that card (favorites require `status = 'published'`), and a full re-render gets that consistency for free. AJAX would require re-deriving heart/badge state client-side.
3. **Returning to the filtered list.** Assumption: the toggle returns the user to `/recipes` with their current `category` / `tags` filters preserved, rebuilt server-side from hidden form fields. No raw return URL is ever echoed back into a `Location` header (see "Security considerations").
4. **Share button state.** Assumption: a visibly-present but inert control (`<button type="button" disabled aria-disabled="true">` with a "Sharing is coming soon" title), no `href`, no handler, no endpoint. Confirm with the user if they instead want an enabled button that opens a "coming soon" message. It must **not** be wired to `/r/:id`, which would be wrong for Private recipes.
5. **Difficulty label.** Assumption: render `Difficulty: Easy` using the stored value verbatim; `difficulty` defaults to `'Easy'` in `handleRecipeCreate`/`handleRecipeUpdate`, so in practice it is always present.
6. **Action-row density.** Seven controls on one card (heart, visibility toggle, + Meal Plan, + Cookbook, Edit, Delete, Share). Assumption: allow wrapping via the existing `.recipe-summary-actions` rules and keep destructive Delete visually last; leave sizing/columns to REW-82.

## Tasks

Ordered so each step is independently reviewable.

1. **Relabel the metadata row** in `views/partials/recipe-summary-card.ejs` to `Prep Time: …`, `Cook Time: …`, `Servings: …`, `Difficulty: …`, keeping each field's existing "omit when empty" guard. Because the partial is shared, this lands on Browse too — which is exactly what REW-59 asks for, so verify against REW-59's version rather than duplicating it.
2. **Add the recipe visibility endpoint.** In `src/routes/recipeRoutes.js`, add an exported `handleRecipeVisibilityUpdate(req, res, { createClient })` and mount it at `POST /recipes/:id/visibility`, modeled directly on `handleCookbookVisibilityUpdate` in `src/routes/cookbookRoutes.js` (lines 262–325). It must: guard `req.params.id` against `UUID_PATTERN`; pass `req.body.visibility` through the existing `normalizeRecipeVisibility` from `src/utils/recipeVisibility.js` (fails closed to `draft`); update `{ status }` filtered by both `.eq("id", id)` and `.eq("user_id", req.user.id)`; use `.select().maybeSingle()` and treat a `null` row and a real error as distinct log events but an identical user-facing flash; flash Private/Public confirmation copy consistent with the cookbook handler. Mount behind `requireAuth` and a new small rate limiter in the same file (mirror `addRecipeLimiter`'s shape). Do **not** touch `handleRecipeUpdate` — the full edit form keeps owning form-level visibility.
3. **Add the `+ Cookbook` card action.** Preferred: consume REW-59's cookbook JSON API + modal if merged. If it is not available, add an owner-scoped JSON API mirroring `src/routes/mealPlanApiRoutes.js` (its `requireApiAuth`, `UUID_PATTERN`, per-user limiter, and duplicate-safe `upsert(..., { onConflict, ignoreDuplicates: true })` are the pattern to copy) plus a `views/partials/cookbook-modal.ejs` and `public/js/cookbooks.js` mirroring `meal-plan-modal.ejs` / `meal-plans.js`. The existing owner + recipe-ownership checks in `POST /cookbooks/:id/recipes/:recipeId` (cookbookRoutes.js lines 496–547) define the authorization rules to reproduce. Include the modal in `views/layouts/main.ejs` gated on `user`, as the meal-plan modal already is.
4. **Add the Private/Public toggle control to the card**, owner surface only (`isPublic === false`). Replace the bare status pill with a labelled form control: current-state badge + hidden `_csrf` + hidden `visibility` set to the *opposite* state + a `Make Public` / `Make Private` submit button, following the `views/cookbooks/view.ejs` pattern exactly. Carry the current `category`/`tags` filter values as hidden fields so the redirect can restore them.
5. **Add the inert Share button** to the owner action row per assumption 4, with a comment naming REW-18 as the owner of real behavior.
6. **Keep the guest/public branch untouched.** Browse (`isPublic: true`) must gain none of Edit, Delete, the visibility toggle, or Share; confirm the partial's existing `isPublic` branching still fully gates them after the refactor.
7. **Tests.** Add `src/routes/recipeVisibilityToggle.test.js` (new file; do not extend `recipeVisibilityRoutes.test.js`, which covers create/update) using the `responseRecorder()` + injected fake-client style already in that file: assert the fail-closed normalization for `undefined`, `["public"]`, `"PUBLIC"`, `"nonsense"`; assert both `.eq("id", …)` and `.eq("user_id", …)` are applied; assert a non-owner/no-row result flashes an error and performs no further mutation; assert a non-UUID id short-circuits before any client call. Add cookbook-API tests only if Task 3 builds the API here.
8. **Run `npm test`**, hand off to Reviewer, then QA against the acceptance criteria below.

## Affected files

- `views/partials/recipe-summary-card.ejs` — metadata relabel, owner-only visibility toggle form, `+ Cookbook` button, inert Share button. **Primary conflict surface with REW-59.**
- `views/recipes/index.ejs` — passes `recipe` and `isPublic: false` into the partial; needs to also pass the active `selectedCategory` / `selectedTags` values so the toggle form can round-trip them.
- `src/routes/recipeRoutes.js` — new exported `handleRecipeVisibilityUpdate` + `POST /:id/visibility` mount + its rate limiter. No change to create/update/delete handlers.
- `src/routes/recipeVisibilityToggle.test.js` — **new**, handler-level coverage for the toggle.
- `views/recipes/browse.ejs` — no edit expected; verify only, since it shares the partial.
- `views/layouts/main.ejs` — include a cookbook modal partial gated on `user` (only if Task 3 is built here).
- `views/partials/cookbook-modal.ejs` — **new**, only if Task 3 is built here.
- `public/js/cookbooks.js` — **new**, only if Task 3 is built here. Must be an external file: helmet's CSP is `scriptSrc: ['self']`, no inline scripts.
- `src/routes/cookbookApiRoutes.js` + `src/routes/index.js` — **new route module and its mount**, only if Task 3 is built here.
- `public/css/styles.css` — minimal additions only: a card-scoped visibility-control rule near the existing `.recipe-summary-card .recipe-summary-actions` block (~line 2891) and the `.cookbook-visibility-control` block (~line 3311). Reuse existing badge/button classes; do not restyle the card.

## Database changes

**No migration is required for the core REW-86 scope.** Everything the card reads or writes is the signed-in user's own data, already permitted by existing RLS:

- Visibility toggle writes `recipes.status` for a row the user owns — covered by migration `001_create_recipes_table.sql`'s owner UPDATE policy, and additionally filtered by `.eq("user_id", req.user.id)` in the handler.
- `+ Cookbook` inserts into `cookbook_recipes` for an owned cookbook and an owned recipe — the narrowest case already allowed by migration `010_create_cookbook_recipes_table.sql`. REW-59's `ALTER POLICY` widening (to allow *other people's* Public recipes) is **not** needed for My Recipes, since every card here is owned by the viewer.
- Favorite, meal-plan add, Edit, Delete all reuse existing policies unchanged.

If a migration turns out to be needed, it must be a **new** file in `database/migrations/` — never an edit to an applied one — and the next free `NNN_` number must be picked after REW-59 merges, because REW-59 introduces a second `019_`. Confirm the highest applied number on `main` at that moment rather than assuming.

## Security considerations

- **Ownership on the new toggle.** `POST /recipes/:id/visibility` is the only new state-changing surface. It must sit behind `requireAuth`, validate the UUID, and scope the update by `user_id` in addition to RLS — the belt-and-suspenders convention used throughout `recipeRoutes.js` and `cookbookRoutes.js`. A non-owner must get the same generic "not found / failed" flash as a missing row, so ownership is not probeable.
- **Fail closed on visibility.** Reuse `normalizeRecipeVisibility`; never write `req.body.visibility` through. A missing, array-shaped, wrong-case, or forged value must resolve to `draft` (Private), never `published`. This is the rule REW-85 established and it must not regress.
- **CSRF.** The toggle is a urlencoded form POST, so the global `csrfProtectionExceptMultipart` in `src/app.js` applies — but the form still needs its `<input type="hidden" name="_csrf" value="<%= csrfToken %>">`, exactly like the existing Delete form in the same partial. Any new JSON fetch inherits the `x-csrf-token` header injected by the `window.fetch` wrapper in `public/js/main.js` (lines 225–239); do not bypass that wrapper.
- **No open redirect.** Do not accept a caller-supplied return URL. Restore filters by reading only `category` and `tags` from the POST body, re-encoding them into a query string on a hard-coded `/recipes` path (the cookbook remove route's `returnTo === "recipe" ? … : …` token approach at cookbookRoutes.js line 557 is the precedent for keeping the path server-controlled).
- **Rate limiting.** Add a per-route limiter for the toggle rather than relying only on the production-only global limiter; follow `cookbookLimiter` / `addRecipeLimiter`. Never weaken or remove existing limiters, helmet, CORS, or auth middleware.
- **Escaping.** Every card field stays on `<%= %>` escaped interpolation. Titles, authors, and tags are user-controlled text.
- **Share must leak nothing.** The placeholder must not link to `/r/:id`, must not reveal a share URL, and must not imply a Private recipe is reachable by others.
- **Public surface stays clean.** Browse renders the same partial. Edit, Delete, the visibility toggle, and Share must remain behind the `isPublic === false` branch; a signed-in owner viewing their own recipe on Browse must not see owner controls there.
- **Draft favorites.** The heart stays disabled for `status !== 'published'` (the `/api/likes` POST checks `status = 'published'` server-side). Flipping a favorited recipe to Private must not error and must not silently delete the existing like row — verify the card re-renders with a disabled heart.

## Acceptance criteria

- [ ] A My Recipes card shows all of: clickable title, favorite heart, Private/Public toggle, author, tags, `Prep Time:`, `Cook Time:`, `Servings:`, `Difficulty:`, `+ Meal Plan`, `+ Cookbook`, Edit, Delete, Share.
- [ ] Clicking the card title navigates to that recipe's full view (`/recipes/:id`) and the page loads.
- [ ] Prep time, cook time, servings, and difficulty render in `Label: value` form and match the labels used on Browse cards for the same recipe.
- [ ] A field that is empty renders no stray label and no empty metadata row.
- [ ] Clicking the heart on a Public recipe toggles favorite state without a full-page navigation, and the state survives a page reload.
- [ ] The heart remains disabled, with its explanatory title, on a Private recipe.
- [ ] `Make Public` on a Private card flips the card to Public, shows a confirmation flash, and the recipe then appears on `/browse`.
- [ ] `Make Private` on a Public card flips it back, and the recipe then returns 404/redirect at `/r/:id` for a signed-out visitor and disappears from `/browse`.
- [ ] Toggling visibility while a category or tag filter is active returns to `/recipes` with that same filter still applied.
- [ ] A POST to `/recipes/:id/visibility` with `visibility` missing, misspelled, wrong-case, or sent twice results in `status = 'draft'` (Private) — never Public.
- [ ] A POST to `/recipes/:id/visibility` for a recipe owned by another user changes nothing and returns the same generic failure as a nonexistent id.
- [ ] A POST to `/recipes/:id/visibility` without a valid CSRF token is rejected.
- [ ] A POST to `/recipes/:id/visibility` with a non-UUID id is rejected before any database call.
- [ ] `+ Meal Plan` opens the existing modal and adds the recipe, including for a Private recipe the user owns.
- [ ] `+ Cookbook` adds the recipe to a chosen owned cookbook, is a no-op (not an error) when clicked twice, and the recipe then appears on that cookbook's page.
- [ ] Edit opens `/recipes/:id/edit`; Delete still prompts for confirmation and removes the recipe.
- [ ] The Share button is visible on every owner card, is clearly inert, performs no navigation or request, and exposes no URL.
- [ ] Browse cards show no Edit, Delete, visibility toggle, or Share — including when the signed-in viewer is the recipe's owner.
- [ ] Favoriting a Public recipe and then making it Private does not error; the card re-renders with a disabled heart.
- [ ] Card actions wrap rather than overflow at 375px width, and Delete is not adjacent enough to Edit to be mis-tapped.
- [ ] All controls are reachable by keyboard with visible focus, and icon-only controls have accessible labels.
- [ ] A recipe titled `<script>alert(1)</script>` renders escaped on the card.
- [ ] `npm test` passes, including the new visibility-toggle handler tests.

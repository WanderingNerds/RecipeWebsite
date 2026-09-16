# REW-89 — Standardize Meal Plan Recipe Card Content & Actions

## Jira issue

[REW-89 — Standardize Meal Plan Recipe Card Content & Actions](https://wanderingnerds.atlassian.net/browse/REW-89)
Task · Medium · status **To Do** · parent epic [REW-2 — Phase 2: Core Recipe Organization & Import](https://wanderingnerds.atlassian.net/browse/REW-2)
Branch: `REW-89-standardize-meal-plan-recipe-card`

Predecessors (all merged to `main`, and the pattern this ticket must extend rather than replace):
REW-86 My Recipes · REW-87 My Favorites · REW-88 Cookbook.

## Confluence page

[REW-89 — Standardize Meal Plan Recipe Card Content and Actions — Implementation Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/32079873/REW-89+Standardize+Meal+Plan+Recipe+Card+Content+and+Actions+Implementation+Plan)
Related feature page: [Meal Plans (REW-63, REW-69)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25198593)

## Summary

`views/meal-plans/view.ejs` is the last of the five recipe-card surfaces still
hand-rolling its own card markup. It renders a bespoke `feature-card` with
abbreviated metadata (`Prep:`, `Cook:`, `4 servings`), an unconditional
Private/Public pill, no tags, no categories, no favorite heart, no `+ Cookbook`,
no Share, and no Edit/Delete — and its only action is Remove. REW-89 replaces
that markup with the shared `views/partials/recipe-summary-card.ejs` partial by
adding a fifth `surface` value, `'meal-plan'`, exactly the way REW-88 added
`'cookbook'`. The partial change is small; the substantive work is in the data
layer, because `getMealPlanRecipes()` in `src/routes/mealPlanRoutes.js` does not
currently select the columns the standardized card needs (`user_id`,
`original_author`, categories, tags) and the handler never computes `isLiked`.
Without widening that query the new card would render with no tags, a dead
heart, and Edit/Delete silently suppressed for the owner.

## Open questions / assumptions

1. **Remove is not in the ticket's list, but must stay.** The ticket enumerates
   Title/Author/Tags/times/Favorite/+ Cookbook/Edit/Delete/Share and says not to
   show `+ Meal Plan`. It never mentions Remove-from-meal-plan — but its last
   acceptance criterion says formatting stays consistent "while preserving these
   page-specific actions," and REW-88 set the precedent by carrying the
   cookbook's Remove into the partial. **Assumption: Remove stays**, and keeps
   its own confirm copy ("Remove this recipe from the meal plan? The recipe
   itself will not be deleted."). Removing it would strand recipes in a plan.
2. **Private/Public pill: owner-only.** The ticket is silent. Today the meal
   plan page shows a pill on every card, including other people's recipes.
   **Assumption: adopt the REW-88 rule** — pill shown only when the viewer owns
   the recipe. The rationale transfers exactly: REW-69 sharing hides Private
   recipes from the shared `/m/:id` view, so the pill is how the owner learns a
   Private recipe will not appear to people they share the plan with; and a
   viewer should never be shown a status claim about somebody else's recipe.
   Since meal plans may only contain your own recipes (any status) or anyone's
   *published* recipes, a non-owned recipe in a plan is always Public anyway.
3. **`/m/:id` (the public shared meal plan) is out of scope.** It is
   `views/meal-plans/public-view.ejs`, served by `src/routes/publicRoutes.js`,
   anonymous and read-only, and uses the lightweight
   `views/partials/recipe-card.ejs`. REW-88 deliberately left the equivalent
   `views/cookbooks/public-view.ejs` alone. **Assumption: unchanged here too.**
   If Product wants the shared view standardized, flag it — it needs its own
   ticket and its own anonymous-safe surface, not a reuse of `'meal-plan'`.
4. **`+ Cookbook` on a recipe you do not own will fail server-side until
   REW-100.** The `cookbook_recipes` RLS INSERT policy still allows only your
   own recipes. The ticket asks for the button unconditionally, and REW-87
   already shipped it under the same known limitation on My Favorites; the
   failure surfaces as an error toast from `toggleCookbookMembership` in
   `public/js/cookbooks.js`. **Assumption: same accepted behavior**, no new
   gating. Raise with Product if a disabled-with-tooltip state is preferred.
5. **Share stays inert.** The ticket explicitly defers sharing behavior. Reuse
   the same disabled, hrefless placeholder REW-86/87/88 ship. Real sharing is
   REW-18.
6. **Meal plans are the first *genuinely* mixed-ownership card surface.**
   Cookbooks are owner-only in practice today (REW-88 computed ownership
   per-card for a future REW-100 world). Meal plans are not: the
   `meal_plan_recipes` RLS INSERT policy in
   `database/migrations/012_create_meal_plan_recipes_table.sql` allows your own
   recipes *or* anyone's published recipe, and `POST
   /api/meal-plans/:id/recipes/:recipeId` relies on exactly that. So owner-gating
   of Edit/Delete is load-bearing in production **today**, not hypothetical.
   QA must test a plan containing another user's recipe.

## Tasks

Ordered so each step leaves the suite green.

1. **Widen the meal-plan card query.** In `src/routes/mealPlanRoutes.js`, add a
   `MEAL_PLAN_CARD_COLUMNS` constant mirroring `COOKBOOK_CARD_COLUMNS` in
   `src/routes/cookbookRoutes.js` (id, user_id, title, author, original_author,
   prep_time, cook_time, servings, difficulty, thumbnail_url, status,
   created_at, plus the embedded `recipe_categories(categories(...))` and
   `recipe_tags(tags(...))` joins). Use it in `getMealPlanRecipes()` and flatten
   the junction embeds into flat `categories` / `tags` arrays the same way
   `getCookbookRecipes()` does. Keep the existing defensive
   `.filter(Boolean)` on a null `recipes` embed and the existing newest-first
   ordering on the junction row's `created_at`. Keep body fields (instructions,
   notes) off this listing query. Export the helper for handler-level tests.
2. **Extract and widen the view handler.** Refactor `GET /meal-plans/:id` into
   an exported `handleMealPlanView(req, res, { createClient = createSupabaseClient } = {})`,
   mirroring `handleCookbookView` in `src/routes/cookbookRoutes.js`, so a test
   can inject a fake client. Inside it, after fetching recipes, add a single
   batched `recipe_likes` lookup filtered to `req.user.id` and `.in()` the page's
   recipe ids, then map `isLiked` onto each recipe. Skip the query entirely when
   the plan is empty. On a likes error, log and continue with hearts rendering
   unfavorited — never fail the page. Leave `title`, `mealPlan`, `recipes` and
   `appUrl` locals otherwise unchanged.
3. **Do not touch the grocery-list query.** `getMealPlanRecipeIngredients()`
   stays narrow (`id, title, ingredients`) — it must not start shipping card
   metadata, and its skipped-row counting behavior is REW-26 contract.
4. **Teach the shared partial a `'meal-plan'` surface.** In
   `views/partials/recipe-summary-card.ejs`, extend the header comment's surface
   list, add `isMealPlan`, and add a `cardMealPlanId` optional local read through
   `typeof` under a distinct name, exactly as `cardCookbookId` is read — a caller
   that forgets it gets no Remove button rather than a form posting to
   `/meal-plans//recipes/...`.
5. **Add the one new flag the ticket requires.** Introduce `showMealPlanAdd`,
   true on every surface except `'meal-plan'`. This is the direct analogue of
   REW-88's `showCookbookAdd` and is the mechanism that satisfies "do not
   display + Meal Plan." Gate the existing `+ Meal Plan` button on it. Document
   in the comment that this is a **display rule only**: `POST
   /api/meal-plans/:id/recipes/:recipeId` keeps its auth, rate limiter and UUID
   guards whether or not a button is drawn.
6. **Extend `showStatusPill`** to include `isMealPlan && isOwner`, alongside the
   existing `isCookbook && isOwner`. Verify no other flag needs touching — and
   state in review that `showFavoriteHeart` (`!isBrowse`), `showOwnerControls`
   (`isOwner && !isBrowse`), `showCookbookAdd` (`!isBrowse && !isCookbook`),
   `showAdaptedFrom` (`!isBrowse`), `chipsAreLinks` (`isMyRecipes` only) and
   `recipeHref` (`/recipes/:id` off browse) already produce the correct
   meal-plan behavior with **no change**. That is the point of the pattern.
7. **Add the `isMealPlan` action-row branch** in the partial, modeled on the
   `isCookbook` branch: `+ Cookbook`, Share (inert), Remove (meal-plan URL and
   confirm copy, and **no `returnTo` field** — `POST
   /meal-plans/:id/recipes/:recipeId/remove` always redirects to
   `/meal-plans/:id`, unlike the cookbook route), then owner-gated Edit and
   Delete. Keep REW-88's deliberate ordering rationale: Edit sits between Remove
   and Delete so "take this out of the plan" and "destroy this recipe forever"
   are never adjacent taps; Delete is last and the only red control; the two
   confirm dialogs read differently. Carry `margin-top: auto` on the row (no
   visibility control above it to hold the card's bottom spacing) and reuse the
   `recipe-card-actions recipe-summary-actions` classes so no CSS change is
   needed. Do **not** merge the cookbook and meal-plan branches into one
   parameterized branch in this ticket — the consolidation is tempting but risks
   regressing REW-88, and the codebase's established style is explicit,
   heavily-commented per-surface branches.
8. **Swap the meal-plan page over.** In `views/meal-plans/view.ejs`, replace the
   hand-rolled card block inside the `recipes.forEach` with an include of
   `../partials/recipe-summary-card` passing `{ recipe, surface: 'meal-plan',
   mealPlanId: mealPlan.id }` — the same call shape `views/cookbooks/view.ejs`
   uses. `user` and `csrfToken` continue to reach the partial via `res.locals`.
   Leave every piece of page furniture untouched: back link, title, date range,
   recipe count, the `meal-plan-visibility-control` form, Add Recipes, Grocery
   List, Edit, Delete Meal Plan, the share panel, the empty state, the
   `organization-card-grid` wrapper, and the `/js/meal-plan-share.js` tag.
9. **Migrate the one existing test that this swap breaks.** See "Test plan"
   below — `src/views/mealPlanSharing.test.js` asserts against the *source* of
   `views/meal-plans/view.ejs` for a string that is moving into the partial.
10. **Add REW-89 coverage** to `src/views/recipeCard.test.js` and a new
    `src/routes/mealPlanRoutes.test.js`.
11. **Run `npm test`** and confirm the whole suite is green, including the
    meal-plan, grocery-list, visibility and organization-grid tests listed below.

## Affected files

### Changed

- `src/routes/mealPlanRoutes.js` — add `MEAL_PLAN_CARD_COLUMNS`; widen and
  export `getMealPlanRecipes()` and flatten categories/tags; extract `GET
  /meal-plans/:id` into an exported, client-injectable `handleMealPlanView`;
  add the batched `recipe_likes` lookup and the `isLiked` mapping. This is the
  largest change in the ticket.
- `views/partials/recipe-summary-card.ejs` — fifth surface: `isMealPlan`,
  `cardMealPlanId`, new `showMealPlanAdd` flag gating the `+ Meal Plan` button,
  `showStatusPill` extended, new `isMealPlan` action-row branch, header comment
  updated.
- `views/meal-plans/view.ejs` — delete the bespoke card markup; include the
  shared partial with `surface: 'meal-plan'` and `mealPlanId`. Page furniture
  unchanged.
- `src/views/recipeCard.test.js` — replace the thin "Meal-plan recipe cards link
  their titles and preserve protected removal without View" test with the full
  REW-89 block (see below).
- `src/views/mealPlanSharing.test.js` — migrate the "plan-level control reads as
  distinct from the per-recipe badges" test from template source to rendered
  output.

### New

- `src/routes/mealPlanRoutes.test.js` — handler-level coverage, modeled
  file-for-file on `src/routes/cookbookRoutes.test.js`.

### Read / verify only (no edits expected)

- `src/views/organizationCardGrid.test.js` — requires
  `class="organization-card-grid"` to remain in `views/meal-plans/view.ejs`. It
  does; this test should keep passing untouched.
- `src/views/recipeVisibility.test.js` — asserts the *source* of
  `views/meal-plans/view.ejs` matches `>Private</span>`. **This still passes
  after the swap** because the plan-level
  `meal-plan-visibility-badge meal-plan-visibility-private` control stays in the
  template and contains that exact substring. Cookbooks passed the same way in
  REW-88. Do not "fix" this test.
- `src/views/groceryList.test.js` — renders `views/meal-plans/view.ejs` with
  only `mealPlan`/`recipes`/`user`/`csrfToken`; the new locals must stay
  optional so this keeps working.
- `public/js/likes.js`, `public/js/cookbooks.js`, `public/js/meal-plans.js` —
  all three are already loaded globally from `views/layouts/main.ejs`, so the
  heart and `+ Cookbook` work on this page with **no client-side change**.
- `public/css/styles.css` — `recipe-summary-card`, `recipe-summary-actions`,
  `like-btn`, `badge-draft`/`badge-published`, `category-badge`, `tag-badge` and
  `organization-card-grid` all already exist. **No CSS change expected**; if the
  Developer finds one is needed, call it out rather than adding ad-hoc inline
  styles.
- `src/routes/publicRoutes.js` / `views/meal-plans/public-view.ejs` —
  out of scope (assumption 3).

## Database changes

**No migration is required.** Every column and table the standardized card needs
already exists and is already readable by the caller under existing RLS:

| Card needs | Source | Already exists via |
| --- | --- | --- |
| `user_id` (owner gating, never rendered) | `recipes` | `001_create_recipes_table.sql` |
| `original_author` ("Adapted from") | `recipes` | `018_add_recipe_clone_provenance.sql` |
| categories | `recipe_categories` → `categories` | `003`/`005` |
| tags | `recipe_tags` → `tags` | `004`/`006` |
| favorite state | `recipe_likes` | `008_create_recipe_likes_table.sql` |

This ticket is a **query-widening change only**. The `recipes` RLS SELECT policy
already exposes own-plus-published rows, so selecting `user_id` and
`original_author` on a row the caller can already see grants nothing new. The
`recipe_likes` read stays on the request-scoped client and is additionally
filtered by `user_id`, belt-and-braces on top of its own RLS.

Standing rule for the Developer: if implementation reveals a schema or RLS gap,
add a **new** file `database/migrations/021_<description>.sql` (021 is the next
free number; 020 is the highest applied) and update `database/README.md`. Never
edit an already-applied migration, `001`–`020`.

## Security considerations

- **`isOwner` is presentational only.** It decides whether Edit/Delete are
  *drawn*. Enforcement stays where it is: `/recipes/:id/edit`, `/:id/update` and
  `/:id/delete` each check ownership server-side, backed by RLS. Reviewer should
  confirm no new code treats the flag as authorization.
- **`recipe.user_id` must never reach the HTML.** It is newly selected by this
  ticket, which makes the existing "never rendered" invariant newly relevant to
  this surface. Tests assert a distinctive owner-id string is absent from output.
- **Real mixed ownership.** Unlike every prior surface, a meal plan can
  genuinely contain another user's published recipe today. Edit/Delete gating
  and the owner-only status pill are therefore live protections, not
  future-proofing. Verify with a non-owned recipe.
- **Fail closed on missing ownership data.** A recipe row with no `user_id`
  (sparse fixture, or a surface that does not select the column) must be treated
  as NOT owned. The existing `isOwner` guard already does this; keep it.
- **CSRF.** The meal-plan card now carries two POST forms for an owner (Remove
  and Delete). Each needs its own `_csrf` hidden field. `csrf-csrf` protection on
  `POST /meal-plans/:id/recipes/:recipeId/remove` and
  `POST /recipes/:id/delete` is unchanged.
- **No new endpoints, no new rate limiters.** Remove keeps `requireAuth`,
  `mealPlanLimiter`, its two UUID guards and its plan-ownership check.
  Suppressing `+ Meal Plan` is a display decision; `POST
  /api/meal-plans/:id/recipes/:recipeId` keeps `requireApiAuth`,
  `mealPlanApiLimiter` and its UUID validation regardless.
- **Share must stay inert.** No `href`, no handler, no target URL. It must never
  link to `/r/:id` — a meal plan can contain the owner's Private recipe, and
  that link would be wrong and misleading. Keep `disabled` +
  `aria-disabled="true"` + the "coming soon" title.
- **Output escaping.** All card fields render through `<%= %>`. Tests use a
  hostile title, author and tag fixture to prove no raw `<script>` survives on
  the new branch.
- **No secret or Host-derived data added.** `appUrl` still comes from
  `getAppUrl()`, never from the request Host header (REW-57).
- **Performance / N+1.** The likes lookup must be one batched query per page
  render, not one per recipe (the REW-55 / REW-88 batching pattern), and must be
  skipped entirely for an empty plan.

## Test plan

Node's built-in runner; everything runs via `npm test` (`node --test`). Tests are
co-located `*.test.js` beside the code, per repo convention.

### `src/views/recipeCard.test.js` (extend)

Add a `renderMealPlan(overrides, user, locals)` helper passing
`surface: 'meal-plan'` and `mealPlanId: 'meal-plan-1'`, mirroring the existing
`renderCookbook` helper, and reuse the existing hostile `recipe` fixture and
`OWNER_ID`. Replace the current thin meal-plan test at the bottom of the file.
New tests:

1. *A meal-plan recipe you own shows every standardized control plus Remove* —
   title links to `/recipes/:id`; live heart with `data-liked`; `By ...` author;
   `tag-badge` and `category-badge` present; all four of `Prep Time:`,
   `Cook Time:`, `Servings:`, `Difficulty:` in `Category: Answer` form; Share
   inert; Remove form posts to
   `/meal-plans/meal-plan-1/recipes/recipe-1/remove` with the meal-plan confirm
   copy; Edit link and Delete form present; exactly two `_csrf` tokens; Remove
   before Edit before Delete; Delete the only `--error-color` control.
2. ***No `+ Meal Plan` on this surface*** — the ticket's distinguishing
   assertion. Assert the existing `mealPlanTriggers(html)` helper returns length
   `0`, and that neither `meal-plan-add-btn` nor `meal-plan-add-btn-guest`
   appears. Pair it with a positive assertion that exactly one
   `cookbook-add-btn` *is* present.
3. *A meal-plan recipe you do not own keeps Remove but loses Edit, Delete and
   the pill* — the production-real mixed case; exactly one `_csrf` token.
4. *Owner-only pill and heart render together; Private disables the heart* —
   draft + owner gives a disabled heart with the "Make this recipe Public"
   label and a `badge-draft` pill; published + owner gives a live heart and a
   `badge-published` pill; a stranger sees neither badge; the surface never
   offers `/visibility`, `Make Public` or `Make Private`.
5. *Meal-plan cards never leak user_id, never link chips, and degrade safely* —
   `OWNER_ID` absent from output for owned/non-owned/missing-owner cards; chips
   are plain text (no `href="/recipes?`); hostile strings stay escaped; a caller
   that omits `mealPlanId` gets no Remove button and no `/remove` URL; a sparse
   recipe renders no stray label, no empty chip row, and no `undefined`/`null`.
6. *The meal plan page renders standardized cards and keeps its page furniture*
   — render `views/meal-plans/view.ejs` directly: one
   `feature-card recipe-summary-card`; zero meal-plan triggers; title links to
   `/recipes/:id`; Remove form and confirm present; `Prep Time:` / `Difficulty:`
   present and the old `Prep: ` / `Cook: ` / `4 servings` labels gone; no
   `>View</a>`; `OWNER_ID` absent. Furniture: `organization-card-grid`,
   `meal-plan-visibility-control`, `/meal-plans/:id/add-recipes`,
   `/meal-plans/:id/grocery-list`, `<script src="/js/meal-plan-share.js">`.
   Plus the empty-state case (no `recipe-summary-card`, keeps the "No recipes in
   this meal plan yet" copy and its Add Recipes CTA).

### `src/views/mealPlanSharing.test.js` (migrate — this one breaks otherwise)

The test *"the plan-level control reads as distinct from the per-recipe badges"*
currently does `readFile` on `views/meal-plans/view.ejs` and asserts the source
matches `class="badge-draft badge-draft-sm">Private<`. That literal moves into
`views/partials/recipe-summary-card.ejs` in task 8, so the assertion will fail.

Fix it the way REW-88 fixed the identical problem in
`src/views/cookbookSharing.test.js`: change the assertion from template **source**
to rendered **output**, rendering the owner view with one draft recipe the viewer
owns. Keep both halves of the claim (per-recipe pill classes present; the
`meal-plan-visibility-*` control does not reuse them; no `>Draft</span>` or
`>Published</span>` anywhere) and add the cookbook test's extra check that the
extracted `meal-plan-visibility-control` form contains no `badge-draft` /
`badge-published`. Leave a comment noting the assertion moved and why — output
is the stronger check because it now covers both templates at once.

Also re-verify *"the owner view survives callers that omit the new locals"* still
passes, since it renders with an empty `recipes` array.

### `src/routes/mealPlanRoutes.test.js` (new)

Model directly on `src/routes/cookbookRoutes.test.js`: same `responseRecorder()`,
same thenable `fakeQuery` builder (the recipe and like queries are awaited
directly, not via `.maybeSingle()`), same injected fake client, no live Supabase.
Cover the data contract the card depends on:

1. `getMealPlanRecipes()` selects every column the standardized card needs —
   assert the recorded `select` argument contains `user_id`,
   `original_author`, `difficulty`, `recipe_categories` and `recipe_tags`, and
   that it does **not** pull body fields such as `instructions`.
2. Junction embeds are flattened to plain `categories` / `tags` arrays, and a
   null/absent embed becomes an empty array rather than `undefined`.
3. Ordering is newest-first on the junction row's `created_at`.
4. A membership row whose `recipes` embed is `null` (deleted, or unpublished by
   another owner) is filtered out rather than crashing the page.
5. A query error logs and returns `[]` — the page still renders.
6. `handleMealPlanView` issues exactly **one** `recipe_likes` query for the whole
   page, filtered by the caller's `user_id` and `.in()` the page's recipe ids,
   and maps `isLiked` true/false correctly.
7. An empty meal plan issues **no** `recipe_likes` query at all.
8. A `recipe_likes` error is logged and the page still renders with every
   `isLiked` false.
9. A non-UUID `:id` and a plan the caller does not own both redirect with the
   same "Meal plan not found" flash — existence is never leaked. (Regression
   guard on the handler extraction.)

### Regression sweep

`npm test` must be fully green. Pay particular attention to:
`src/views/organizationCardGrid.test.js`, `src/views/recipeVisibility.test.js`,
`src/views/groceryList.test.js`, `src/views/mealPlanRecipeSearch.test.js`,
`src/routes/mealPlanVisibilityRoutes.test.js`,
`src/routes/recipeMealPlanRoutes.test.js`, `src/utils/mealPlanUtils.test.js`,
and the REW-86/87/88 blocks in `src/views/recipeCard.test.js` — the new
`showMealPlanAdd` flag touches the `+ Meal Plan` button on **all five** surfaces,
so browse / my-recipes / favorites / cookbook must each still render exactly one
meal-plan trigger.

### Manual / QA pass (browser)

1. A meal plan containing (a) your own Public recipe, (b) your own Private
   recipe, and (c) another user's Public recipe.
2. Desktop and mobile widths — the action row wraps rather than overflowing, and
   cards line up across a grid row.
3. Heart toggles and persists across reload; `+ Cookbook` opens the modal and
   adds; Remove removes from the plan without deleting the recipe; Delete
   deletes the recipe and confirms first.

## Acceptance criteria

Mapped one-to-one from the ticket, plus the consistency criteria the series
carries.

- [ ] Meal-plan recipe cards render via the shared
      `views/partials/recipe-summary-card.ejs`, not bespoke markup, and
      `views/meal-plans/view.ejs` contains no hand-rolled card block.
- [ ] **Recipe Title** is a link that opens the full recipe at `/recipes/:id`.
- [ ] **Author** is displayed when present, HTML-escaped.
- [ ] **Tags** are displayed when present (and categories alongside them, as on
      the other standardized surfaces). Chips are plain text, not links.
- [ ] **Prep Time**, **Cook Time**, **Servings** and **Difficulty** each render
      in the exact `Category: Answer` form — `Prep Time: 10 minutes`,
      `Cook Time: 30 minutes`, `Servings: 4`, `Difficulty: Easy` — matching
      REW-59/86/87/88. The old `Prep: `, `Cook: `, `4 servings` labels are gone.
- [ ] Each metadata field is omitted entirely when empty; no stray label, no
      `undefined`, no `null` in the output.
- [ ] **Favorite (heart)** is present and can be toggled directly from the card,
      with `data-liked` reflecting real, batched, server-side state.
- [ ] A Private recipe's heart is disabled with an explanatory label rather than
      hidden (matching My Recipes / Cookbook).
- [ ] **+ Cookbook** is available directly from the card.
- [ ] **+ Meal Plan is not displayed** anywhere on this surface — zero
      `meal-plan-add-btn` and zero `meal-plan-add-btn-guest` occurrences.
- [ ] `+ Meal Plan` still renders exactly once per card on Browse, My Recipes,
      My Favorites and Cookbook (no collateral damage from the new flag).
- [ ] **Edit** and **Delete** appear only when the logged-in user owns the
      recipe; they are absent for a non-owned recipe and absent when `user_id`
      is missing (fail closed).
- [ ] **Share** is visible, disabled, has no `href` and no handler; no new
      sharing behavior ships.
- [ ] **Remove from meal plan** is preserved, posts to
      `/meal-plans/:id/recipes/:recipeId/remove`, is confirm-guarded with
      meal-plan-specific copy, and never deletes the recipe itself.
- [ ] The Remove and Delete forms each carry their own valid `_csrf` token.
- [ ] The Private/Public pill renders only for a recipe the viewer owns; a
      non-owner sees no status claim about someone else's recipe.
- [ ] The card never renders `recipe.user_id` into the HTML.
- [ ] Hostile title, author and tag values stay escaped; no raw `<script>` in
      output on the meal-plan branch.
- [ ] `GET /meal-plans/:id` issues one batched `recipe_likes` query per page
      render, and none for an empty plan.
- [ ] Page furniture is unchanged: back link, title, date range, recipe count,
      plan-level visibility control, Add Recipes, Grocery List, Edit, Delete
      Meal Plan, share panel, empty state, `organization-card-grid`, and the
      `/js/meal-plan-share.js` tag.
- [ ] The grocery-list flow is unaffected (`getMealPlanRecipeIngredients()`
      untouched, `/meal-plans/:id/grocery-list` renders as before).
- [ ] `/m/:id` (public shared meal plan) is unchanged.
- [ ] No new database migration; no edits to `database/migrations/001`–`020`.
- [ ] `npm test` passes in full, including the migrated
      `src/views/mealPlanSharing.test.js` assertion and the new
      `src/routes/mealPlanRoutes.test.js`.

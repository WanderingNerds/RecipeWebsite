## Jira issue

REW-26 — [Grocery list generation](https://wanderingnerds.atlassian.net/browse/REW-26) (Task, Priority High, Status To Do, Epic parent [REW-2 — Phase 2 — Core Recipe Organization & Import](https://wanderingnerds.atlassian.net/browse/REW-2))

Ticket description (verbatim): "We need to be able to generate a grocery list off a mealplan. This would look at the recipes in the plan and create a printable grocery list separated by where you would find it in the store category wise."

The ticket carries no acceptance criteria and no comments. The criteria below were derived from that description plus existing repo conventions, and should be confirmed by the ticket owner if any of the stated assumptions are wrong.

## Confluence page

[REW-26: Grocery List Generation - Feature Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29786113/REW-26+Grocery+List+Generation+-+Feature+Plan)

## Summary

Add a printable grocery list generated from an existing meal plan. A new authenticated, owner-scoped page at `GET /meal-plans/:id/grocery-list` loads every recipe currently in the plan, parses each recipe's free-text `recipes.ingredients` column with the existing `src/utils/ingredientParser.js`, combines duplicate ingredients across recipes where their measurements are compatible, assigns each ingredient to a fixed store/aisle category, and renders the result as a shopping list optimized for browser printing. The entry point is a "Grocery List" action on the meal plan detail page. Nothing is persisted: the list is derived on demand, so it always reflects the plan and its recipes as they are right now. No new tables, migrations, dependencies, or environment variables are required.

## Open questions / assumptions

1. **Serving scaling.** The ticket does not mention scaling. *Assumption:* the list uses each recipe's quantities exactly as written (factor 1). The `planned_servings` column that REW-63 added to `meal_plan_recipes` as forward-compatibility stays unwritten and unread by this ticket — `meal_plan_recipes` has no UPDATE RLS policy today, so making it user-editable needs its own ticket and its own migration. Flag to the user if per-plan scaling is actually expected.
2. **Category taxonomy.** *Assumption:* a fixed, hard-coded, server-side aisle taxonomy (Produce, Meat & Seafood, Dairy & Eggs, Bakery, Frozen, Canned & Jarred, Dry Goods & Pasta, Baking, Spices & Seasonings, Condiments & Sauces, Beverages, Other), presented in that walk-the-store order. Not user-editable, not stored in the database, not reusing the existing `categories` table (which classifies recipes, e.g. Breakfast/Dinner — a different concept entirely).
3. **Combining duplicates.** *Assumption:* the same ingredient appearing in several recipes is merged into one line. Quantities are summed only when the measurements are genuinely compatible; otherwise the amounts are listed side by side on the same line (see Task 2). A wrong-but-tidy number is worse than two honest ones on a shopping list.
4. **Check-off state.** *Assumption:* the list renders plain unchecked checkboxes for printing/marking in the browser session. Nothing is persisted, so no table and no mutation route.
5. **"Printable."** *Assumption:* browser printing via a print stylesheet plus a Print button calling `window.print()`. No PDF-generation dependency, no new export formats (CSV/email/PDF are out of scope).
6. **Recipes that are no longer readable.** A plan can contain another user's recipe that was Public when added and has since been switched to Private (REW-85), or a recipe deleted mid-session. *Assumption:* those memberships are silently skipped for data, but the page shows a plain count such as "1 recipe could not be included" so the user is not misled by a short list. Never reveal the missing recipe's title or owner.
7. **Scope.** Deliberately excluded: pantry/"already have it" exclusion, multi-plan or date-range lists, shopping history, quantity editing, reordering categories, and day-level planning. If any of these are wanted, they need their own tickets — do not expand REW-26.

## Tasks

1. **Add the aisle taxonomy and categorizer** in a new `src/utils/groceryList.js`. Define an ordered list of category keys with display labels, and a keyword-to-category map. Resolve an ingredient name to a category by matching taxonomy keys longest-first as whole words (including simple plural tolerance), exactly the technique `findKey`/`escapeRegExp` already use in `src/utils/measurements.js`. Regexes are built only from escaped literal taxonomy keys, never from user text. Anything unmatched resolves to `other`. Export the ordered categories so the view and tests share one source of truth.

2. **Add the aggregation logic** to the same `src/utils/groceryList.js`. Given a list of `{ id, title, ingredients }` recipe records, it should:
   - parse each recipe's ingredients with `parseIngredients()`;
   - drop rows where `type === 'section'` (section headings like "For the sauce:" are not shopping items) and drop blank rows;
   - derive a normalized grouping key from the parsed `ingredient` name (lowercase, trim, collapse whitespace, strip punctuation, fold simple plurals) — implement this locally rather than exporting `measurements.js`'s private `normalizeName`, because grocery grouping wants plural folding and prep-note stripping that density lookup does not;
   - merge rows sharing a grouping key into one item, keeping the most representative display name and recording every contributing recipe's id and title;
   - combine amounts only within compatible measurement groups: identical `unit`; or `unitType === 'volume'` totals summed in millilitres via `measureRow()` and rendered with `formatVolume()`; or `unitType === 'weight'` totals summed in grams and rendered with `formatGrams()`/`formatImperialWeight()`; or counts with the same unit summed and rendered through `formatAmount()` with `roundCount()`. Rows that do not fit any compatible group (no quantity at all, `approximate` units, "to taste", unparseable text) are preserved verbatim as additional amount entries on the same item — never folded into a number;
   - preserve a per-item flag when at least one contributing row had no usable quantity, so the view can render a "check recipe" hint instead of a fake amount;
   - return categories in fixed store order, each with items sorted alphabetically by display name, plus simple counts (total items, recipes included, recipes skipped). Output must be deterministic for a given input.
   Keep the module pure — no Supabase, no Express, no `req` — matching `mealPlanUtils.js`.

3. **Add unit tests** in `src/utils/groceryList.test.js` using `node:test` + `node:assert/strict`, co-located per repo convention. Cover: categorization of representative ingredients per category and the "Other" fallback; cross-recipe merging; volume/weight/count combining; refusal to combine incompatible units; passthrough of unparseable and "to taste" rows; section-heading exclusion; empty/null/whitespace-only ingredient text; stable category order and alphabetical item order; recipe provenance capture.

4. **Add the route** `GET /meal-plans/:id/grocery-list` in the existing `src/routes/mealPlanRoutes.js`, placed above the catch-all `GET /:id` handler to match the file's existing specific-before-generic ordering. It must use `requireAuth`, validate `:id` against the existing `UUID_PATTERN`, build a request-scoped client with `createSupabaseClient(req.accessToken)`, and load the plan through the existing `getOwnedMealPlan()` helper so a missing plan and another user's plan are indistinguishable. Then add a new local helper (do not widen `getMealPlanRecipes()`, which feeds the card grid and should not start shipping full ingredient text) that selects `recipe_id, recipes(id, title, ingredients)` for the plan, filters out null `recipes` joins, and counts how many memberships were skipped. Pass the parsed/aggregated result plus the skipped count to the view. Follow the file's existing try/catch + `console.error` + flash + redirect error convention. Read-only: no inserts, no updates, no rate-limiter change.

5. **Add the view** `views/meal-plans/grocery-list.ejs` using the default `layouts/main` layout. It should render the plan title and date range, a back link to `/meal-plans/:id`, a Print button, the skipped-recipe notice when the count is non-zero, and one section per non-empty category with a heading and a checkbox item list. Each item shows its combined amount(s), the ingredient name, and the contributing recipe titles. Escape everything with `<%= %>`; never `<%- %>`. Render an empty state (mirroring the existing empty state in `views/meal-plans/view.ejs`) when the plan has no recipes or no parseable ingredients.

6. **Add the entry point** on `views/meal-plans/view.ejs`: a "Grocery List" link in the existing header action row next to Add Recipes / Edit, pointing at `/meal-plans/<id>/grocery-list`. It is a plain `GET` link, so no form and no `_csrf` hidden field. Show it only when the plan has recipes; the destination page still handles the empty case defensively.

7. **Add print and list styling** in `public/css/styles.css`: grocery list layout classes plus the repo's first `@media print` block. Print should hide the navbar, footer, flash alerts, and all buttons/links-as-buttons, keep the plan title and date range, avoid breaking a category group across pages where possible, and render checkboxes and text legibly in black on white.

8. **Add the print handler** to the existing `public/js/meal-plans.js` (already loaded globally by `views/layouts/main.ejs`, so no new script tag and no new global file): find the print button by a `data-` hook or id, no-op when it is absent, and call `window.print()` on click. No inline `onclick` — helmet's CSP allows `script-src 'self'` only.

9. **Add a view-render test** `src/views/groceryList.test.js`, following the `ejs.renderFile` pattern already used in `src/views/recipeCard.test.js`. Assert: category headings appear in store order; items render under the right heading; escaping of hostile ingredient/recipe names (`<script>` must not survive); empty state; skipped-recipe notice appears only when the count is non-zero; the print button and its script hook exist with no inline handler; `views/meal-plans/view.ejs` exposes the Grocery List link when recipes exist and omits it when they do not.

10. **Document the feature** in `docs/api/meal-plans.md` (the REW-63 API doc): add the new read-only route, its ownership rules, and the note that `planned_servings` remains unused. Run `npm test` and confirm the full suite passes.

## Affected files

- `src/utils/groceryList.js` — new. Aisle taxonomy, ingredient-to-category resolution, cross-recipe aggregation and amount combining. Pure module, no I/O.
- `src/utils/groceryList.test.js` — new. Unit coverage for categorization, merging, unit combining, refusal to combine, section exclusion, ordering, empty input.
- `src/routes/mealPlanRoutes.js` — modified. New `GET /:id/grocery-list` handler above the existing `GET /:id`, plus a local ingredient-fetching helper. Reuses `UUID_PATTERN`, `getOwnedMealPlan`, `createSupabaseClient`. No change to existing handlers or to `mealPlanLimiter`.
- `views/meal-plans/grocery-list.ejs` — new. Printable grouped list, empty state, skipped-recipe notice, print button.
- `views/meal-plans/view.ejs` — modified. "Grocery List" link in the existing header action row, shown only when the plan has recipes.
- `public/css/styles.css` — modified. Grocery list classes and the first `@media print` block in the repo.
- `public/js/meal-plans.js` — modified. Print button handler, defensively no-op on pages without the button.
- `src/views/groceryList.test.js` — new. EJS render coverage for the new view and the new link on the plan detail view.
- `docs/api/meal-plans.md` — modified. Document the new read-only route.
- `src/utils/ingredientParser.js`, `src/utils/measurements.js`, `src/utils/ingredientScaler.js` — read/reused, **not modified**. If the aggregation genuinely needs a helper that is currently module-private (for example a shared name normalizer), export it rather than duplicating the logic, and extend the existing co-located test file accordingly; do not change existing behavior or signatures.

## Database changes

**No migration required.** Everything this feature needs already exists:

- `meal_plans` (migration `011`) — owner-only SELECT RLS.
- `meal_plan_recipes` (migration `012`) — SELECT limited to the caller's own plans; already indexed on `meal_plan_id`.
- `recipes.ingredients` (migration `001`) — free text, already covered by the recipes RLS policies (own recipe of any status, or anyone's published recipe).

Explicit constraints for the Developer:

- Do not edit `012_create_meal_plan_recipes_table.sql` or any other already-applied migration. If a schema change turns out to be genuinely necessary, add a new `database/migrations/018_*.sql` file.
- `meal_plan_recipes.planned_servings` stays untouched. There is deliberately no UPDATE policy on that table; writing it would require a new migration adding an UPDATE policy scoped the same way as its SELECT/DELETE policies, which is out of scope here.
- RLS implication to verify rather than assume: the existing `meal_plan_recipes` SELECT policy plus the `recipes` policies already filter this join correctly. A recipe that became Private after being added simply returns a null join and must be skipped in application code, not worked around with a privileged client.

## Security considerations

- **Auth and ownership.** `requireAuth` plus an explicit `.eq("user_id", req.user.id)` ownership check through `getOwnedMealPlan()`, matching every existing meal plan route. Another user's plan and a nonexistent plan must produce the identical "Meal plan not found" flash and redirect — never leak existence.
- **Input validation.** Validate `:id` against `UUID_PATTERN` before any query, as the surrounding handlers do.
- **RLS boundary.** Always `createSupabaseClient(req.accessToken)`. Never the shared anon/service client for this route — that would bypass RLS and could expose another user's private recipe ingredients.
- **CSRF.** The route is a read-only GET, which the `csrf-csrf` configuration intentionally ignores; it must therefore never mutate state. The entry point is a plain link, not a form. Any future "save/share list" action must be a POST with the `_csrf` hidden field like every other mutation in this codebase.
- **Output escaping.** Ingredient text, notes, and recipe titles are user-entered or scraped during import. Use `<%= %>` exclusively in the new view, and assert in tests that `<script>` payloads render escaped.
- **CSP.** helmet allows `script-src 'self'` only. The print handler goes in `public/js/meal-plans.js`; no inline `<script>` and no inline `onclick` in the new view.
- **ReDoS.** Build category-matching regexes only from escaped literal taxonomy keys (reuse the `escapeRegExp` approach from `measurements.js`). Never compile a pattern from ingredient text.
- **Resource use.** The route parses every ingredient line of every recipe in the plan. Keep the work linear, and do not parse the same recipe twice. The production-only global limiter already covers this path; if QA finds large plans expensive, add a read limiter mirroring `mealPlanLimiter` rather than loosening anything.
- **No weakening of existing middleware.** No change to helmet/CSP config, `csrfProtectionExceptMultipart`, CORS, session options, or the existing `mealPlanLimiter` on mutations.

## Acceptance criteria

- [ ] `GET /meal-plans/:id/grocery-list` requires authentication; an anonymous request is redirected to login exactly like other `requireAuth` meal plan routes.
- [ ] Requesting another user's plan id, a nonexistent UUID, or a non-UUID string all produce the same "Meal plan not found" flash and redirect to `/meal-plans`, with no difference in status, body, or timing that reveals which case occurred.
- [ ] The page renders the plan's title and date range, and a back link to the plan detail page.
- [ ] Every recipe in the plan contributes its ingredients to the list; a recipe whose ingredients are empty or unparseable contributes nothing and causes no error.
- [ ] A membership whose recipe is no longer readable (deleted, or switched Public → Private by another owner) is excluded, and the page shows a count of excluded recipes without revealing title or owner.
- [ ] Items are grouped under store-category headings rendered in a fixed order, with unrecognized ingredients under "Other"; empty categories are not rendered.
- [ ] Two recipes listing the same ingredient in compatible units produce a single line with the summed amount (verifiable unit-test case: "2 cups flour" + "1 cup flour" → one flour line reading 3 cups).
- [ ] Two recipes listing the same ingredient in incompatible ways produce a single line showing both amounts separately rather than one invented number (verifiable unit-test case: "1 cup chopped onion" + "2 onions").
- [ ] An ingredient with no parseable quantity ("Salt and pepper to taste") appears on the list with its original text and no fabricated amount.
- [ ] Section headings inside a recipe's ingredients ("For the sauce:") never appear as shopping list items.
- [ ] Each list item names the recipe(s) it came from.
- [ ] A plan with no recipes renders the empty state and a link back to the plan, never an error or a blank page.
- [ ] The plan detail page shows a "Grocery List" action when the plan has recipes, and the action is a plain GET link with no CSRF field and no state change.
- [ ] Printing (or print preview) hides navbar, footer, flash alerts, and buttons; keeps the plan title, date range, category headings, and items legible; and does not split a category heading from its first items across a page break.
- [ ] A recipe or ingredient name containing `<script>alert(1)</script>` renders escaped on the grocery list page, with no `<script>` tag in the output.
- [ ] No inline `<script>` or inline event handler is added to any view; the print button works under the existing helmet CSP.
- [ ] `git diff` contains no changes to `database/migrations/001`–`017` and no new migration file.
- [ ] `npm test` passes in full, including the new `src/utils/groceryList.test.js` and `src/views/groceryList.test.js`.

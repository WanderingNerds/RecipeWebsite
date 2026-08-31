## Jira issue
REW-45 — Show grams as secondary measurement
https://wanderingnerds.atlassian.net/browse/REW-45
Type: Task | Priority: Medium | Status: To Do | Labels: QA-findings

## Confluence page
Intended target: "Recipe Scaling API" (page ID 14942210, space Recipe)
https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/14942210/Recipe+Scaling+API

This page already documents the `primaryAmount`/`secondaryAmount` fields that this
ticket changes the semantics of, so it should be updated in place (not forked).
**The update could not be applied during planning** — Confluence write calls
were blocked by the auto-mode permission classifier in this unattended run.
Whoever has Confluence write access should either:
- add a "Measurement display order (REW-45)" section stating: the
  practical kitchen measurement (cups/tbsp/oz/count) is now `primaryAmount`;
  grams is `secondaryAmount` and only appears when a practical measurement also
  exists; this is a fixed default with no user-facing toggle yet; link to REW-45.
- also update the field descriptions for `primaryAmount` / `secondaryAmount` in
  the existing response-fields table and swap the values in the example JSON
  (`primaryAmount: "4 cups"`, `secondaryAmount: "500g"` instead of the reverse).

The related "REW-11 Recipe Scaling Engine" release-notes page (ID 14974978) does
not need edits — it just narrates the original feature and isn't a source of
truth for field semantics.

## Summary
QA found that ingredient measurements currently show grams as the *primary*
display amount with the practical kitchen measurement (cups, tbsp, oz, count)
as secondary — the reverse of the desired UX. This work swaps which amount
leads: the practical/original-style measurement becomes primary (e.g. "2 cups"),
and the gram conversion becomes the secondary, smaller amount (e.g. "480g"),
rendered as "2 cups (480g)"-style output. This is a fixed default; no user
toggle between measurement systems exists yet or is in scope here.

## Open questions / assumptions
- **Assumption**: "secondary measurement in grams" means swapping the existing
  `primaryAmount`/`secondaryAmount` computation in `withDisplayAmounts()`, not
  building new formatting/UI. The ticket's own example behavior matches this
  reading, and no other measurement-preference code exists in the repo.
- **Assumption**: When only grams/kilograms is available (ingredient entered
  in a metric weight unit, e.g. "500 g flour", or no practical unit could be
  derived), grams stays the sole displayed amount with no secondary value —
  same as current behavior for that case. This does not change.
- **Open question**: Should the secondary grams value be wrapped in
  parentheses in the markup, e.g. `(480g)`, to visually read as a conversion
  rather than a second reading? Currently secondary text is rendered bare
  (`<span class="amount-secondary"><%= row.secondaryAmount %></span>`,
  `views/recipes/view.ejs` line 149; same pattern in `public/js/main.js`
  `updateIngredientsDisplay()`). **Assumption**: keep the existing bare-text
  rendering (no added parentheses) to minimize surface area, since the
  `.amount-secondary` CSS already visually de-emphasizes it (smaller font,
  muted color — `public/css/styles.css` lines 1768–1771). Flag to Developer/
  Reviewer as a one-line CSS/EJS tweak if QA wants parentheses added; does not
  require a new ticket if done as part of this task.
- **No Jira comments exist on REW-45** to clarify further; description is the
  only input. If the assumptions above are wrong, stop and re-scope before
  merging.
- No new Jira ticket is needed for *this* work — REW-45 covers it. A **future**
  ticket should be created for the user-facing toggle the ticket explicitly
  defers.

## Tasks
1. Swap the primary/secondary selection logic in `withDisplayAmounts()`
   (`src/utils/ingredientScaler.js`) so `measureText` (practical kitchen
   measurement) is preferred as `primaryAmount`, falling back to `gramsText`
   only when no practical measurement exists; `secondaryAmount` becomes
   `gramsText` but only when a practical measurement is also the primary
   (i.e., don't duplicate grams as both primary and secondary).
2. Update the JSDoc comment above `withDisplayAmounts()` to describe the new
   precedence (currently documents the old "grams primary" behavior).
3. Update `src/utils/ingredientScaler.test.js` assertions that currently
   assert grams-first ordering, to assert measurement-first ordering:
   - The `"shows imperial weights alongside grams, but not metric ones"` test
     — `primaryAmount`/`secondaryAmount` assertions for the metric case stay
     the same (grams-only, no secondary), but add assertions for the imperial
     case if not already covered.
   - The multi-row `scaleIngredients` test (asserting arrays of
     `primaryAmount` / `secondaryAmount`) needs its expected arrays swapped.
   - The `"leaves unrecognised ingredients unweighed rather than guessing"`
     test already expects `primaryAmount === "4 cups"` with no grams
     available — unaffected, but verify it still passes as a sanity check of
     the "grams unavailable" branch.
   - Add a new explicit test case for the common case (e.g. "2 cups
     all-purpose flour" scaled) asserting `primaryAmount` is the cup
     measurement and `secondaryAmount` is the gram figure, so this ordering
     is pinned down and can't silently regress again.
4. Update `docs/api/recipe-scaling.md` — the field table (`primaryAmount` /
   `secondaryAmount` descriptions) and the example JSON response currently
   document grams-first; correct both to match the new behavior and note it
   is a fixed default (no toggle).
5. Visually verify `views/recipes/view.ejs` and the AJAX path
   (`public/js/main.js` → `updateIngredientsDisplay()`) render correctly with
   no code change needed there, since both already consume
   `row.primaryAmount` / `row.secondaryAmount` generically. Confirm in a
   manual/QA pass rather than assuming — these are the only two render sites.
6. (Optional per open question above) If Reviewer wants the secondary
   gram amount visually parenthesized, add that as a one-line template change
   in both `views/recipes/view.ejs` (EJS) and `public/js/main.js`
   (`updateIngredientsDisplay`) — must be changed in both places to keep the
   server-rendered and AJAX-updated views consistent.
7. No changes needed to `src/utils/measurements.js` or
   `src/utils/ingredientParser.js` — the gram-conversion logic, density table,
   and formatting helpers (`formatGrams`, `formatVolume`,
   `formatImperialWeight`) are correct and unaffected; only which value is
   labeled "primary" vs "secondary" changes.
8. No changes needed to `src/routes/recipeRoutes.js` — both the page render
   route (`GET /recipes/:id`) and the AJAX scale route
   (`GET /recipes/:id/scale`) already pass through `scaleIngredients()`
   output unmodified.

## Affected files
- `src/utils/ingredientScaler.js` — `withDisplayAmounts()` (and its JSDoc):
  swap which of `measureText` / `gramsText` is selected as primary vs
  secondary.
- `src/utils/ingredientScaler.test.js` — update existing
  `primaryAmount`/`secondaryAmount` assertions to the new expected values;
  add a pinning test for the common cups+grams case.
- `docs/api/recipe-scaling.md` — update field descriptions and example JSON
  for `primaryAmount` / `secondaryAmount` to reflect measurement-first,
  grams-secondary, and note this is a fixed default (no toggle yet).
- `views/recipes/view.ejs` (lines ~146–151) — no functional change expected;
  re-verify rendering only. If parentheses are added per task 6, edit here.
- `public/js/main.js` (`updateIngredientsDisplay()`, lines ~108–157) — no
  functional change expected; re-verify AJAX-updated rendering only. If
  parentheses are added per task 6, edit here (must match view.ejs).
- No changes to `src/utils/measurements.js`, `src/utils/ingredientParser.js`,
  or `src/routes/recipeRoutes.js`.

## Database changes
None. There is no per-user or per-recipe measurement-preference column, and
no migration is needed for this ticket — the ticket explicitly scopes this as
a fixed default, deferring any user-facing toggle (which would need its own
future migration, e.g. a `measurement_system` preference column on a user
profile table, if/when that ticket is created). Existing gram-conversion data
is fully derived at render time from static tables in `measurements.js`
(`GRAMS_PER_CUP`, `GRAMS_PER_ITEM`, `GRAMS_PER_UNIT`) — nothing is persisted
in Postgres for this feature, so there is no schema/RLS impact.

## Security considerations
- This is a display-formatting change only; no new user input, auth surface,
  file upload, or CSRF-protected form is touched.
- `GET /recipes/:id/scale` already requires `requireAuth` — unaffected by this
  change; do not weaken or remove that check while touching nearby code.
- No new untrusted input paths are introduced. Existing query-string parsing
  (`servings`, `scale`) in `resolveScaling()` / `parseRequestedNumber()` in
  `src/utils/ingredientScaler.js` is unchanged and remains defensive (rejects
  non-numeric, negative, zero values).
- Reviewer should confirm the swap doesn't change what data is present in the
  JSON response (only which field name maps to which value) — no new PII or
  sensitive data is exposed either way.

## Acceptance criteria
- [ ] For an ingredient with both a practical measurement and a known gram
      conversion (e.g. "2 cups all-purpose flour"), `primaryAmount` is the
      practical measurement (e.g. "2 cups") and `secondaryAmount` is the gram
      figure (e.g. "240g"), on both the initial server-rendered page load
      (`GET /recipes/:id`) and the AJAX scale endpoint
      (`GET /recipes/:id/scale`).
- [ ] For an ingredient entered directly in a metric weight unit with no
      separate practical measurement (e.g. "500 g bread flour"), the display
      still shows only the gram figure as `primaryAmount` with an empty
      `secondaryAmount` — unchanged from current behavior.
- [ ] For an ingredient with no known gram conversion (e.g. "2 cups chopped
      kale" — no density in the lookup table), `primaryAmount` is the
      practical measurement and `secondaryAmount` is empty — unchanged from
      current behavior.
- [ ] Recipe scaling (servings +/-, quick-scale buttons) continues to work
      identically; only the primary/secondary labeling of amounts changes,
      not the scaling math itself.
- [ ] `npm test` passes, including updated assertions in
      `src/utils/ingredientScaler.test.js` that pin the new
      measurement-primary / grams-secondary ordering.
- [ ] No UI element or copy anywhere (view, JSON docs, Confluence) implies a
      user can currently choose between measurement systems — this remains a
      fixed default per the ticket, with only prose noting a toggle may come
      later.
- [ ] `docs/api/recipe-scaling.md` accurately reflects the new field
      semantics and example payload.

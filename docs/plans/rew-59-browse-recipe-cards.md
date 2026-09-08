## Jira issue

[REW-59](https://wanderingnerds.atlassian.net/browse/REW-59) — align Browse recipe cards with My Recipes. The parent agent fetched the issue live; its requirements are the source for this plan.

## Confluence page

Publication pending; this file is the ready-to-publish planning draft. Read-only Confluence discovery found no REW-59-specific page among the 13 results for `type = page AND (text ~ "REW-59" OR title ~ "Recipe")`. Related existing documentation: [REW-47: Use Fixed-Width Recipe Cards](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/20873242) and [Manual Recipe Entry and Recipe Search](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/10485762). Before publication, inspect the relevant page and update in place if appropriate. No Confluence or Jira writes were performed by the planner.

## Summary

Browse currently uses a separate card template that omits tags, difficulty, creation date, and one of the two cooking times; its route does not load tags or categories. Bring Browse's core recipe information and its placement/presentation into line with My Recipes while preserving each surface's navigation and controls. Database SELECT policies also need a narrow public-read extension: existing tag and recipe/category junction policies allow only owner reads, so adding a template loop alone would leave Browse metadata empty.

## Open questions / assumptions

- My Recipes is the visual reference: thumbnail when available, title/status header, author, categories, tags, separate prep/cook times, servings, difficulty, and creation date in that order.
- Favorite is an action rather than core metadata. Preserve My Recipes' favorite control and Browse's existing Meal Plan action; adding a new Browse favorite interaction is outside this ticket.
- Public category/tag badges should use the same styling and placement but need not link into the private My Recipes filters. Use noninteractive badges on Browse unless a real public filter already exists. Do not add unrelated filtering behavior.
- Search shares the old public card partial. Keep its current behavior unless a safe explicit variant can preserve its existing rendering and data expectations.
- The existing migrations, rather than assumptions about a remote database, define the access-policy gap. Applying the migration to a connected deployment is separate from preparing the reviewed change.

## Tasks

1. Extract reusable card presentation from My Recipes into a narrowly scoped partial or partials. Keep the same ordering, badge classes, optional-field behavior, and wrapping. Make surface-specific navigation and actions explicit; retain Search's existing defaults if changing the existing public partial.
2. Load Browse category and tag relationships using the anonymous client and published-only recipes. Prefer embedded relationships or page-batched queries rather than per-card queries. Normalize missing relationships to empty arrays and discard null nested records. Preserve pagination, exact count, newest-first order, and error handling.
3. Add migration `013_public_recipe_card_metadata.sql` with additive SELECT policies permitting public reads of recipe_tags and recipe_categories only when linked to published recipes, and tags only when attached to at least one published recipe. Preserve existing owner reads and all mutation policies. Avoid circular RLS dependencies: the tags public-read predicate can inspect recipe_tags, whose public predicate should inspect recipes only.
4. Render Browse using the shared presentation, with public `/r/:id` links, Published status, and its existing signed-in/guest Meal Plan control. Render My Recipes with its existing private detail links, category/tag filters, favorite controls, and View/Edit/Delete actions including delete confirmation and CSRF field.
5. Add focused rendering and route/data tests covering actual acceptance failures: zero/one/multiple tags, optional fields, separate times, matching placement, safe escaping, public action boundaries, pagination/data shaping, and unchanged Search rendering. Validate RLS behavior against a local database if available; otherwise clearly record that deployment-level policy verification remains pending.
6. Run the existing suite, obtain independent review, and perform acceptance checks. Record precise results and any unavailable browser/database checks in the handoff before documentation claims completion.

## Affected files

- `src/routes/publicRoutes.js` — Browse relationship loading and published card metadata; keep anonymous public reads and pagination intact.
- `views/recipes/browse.ejs` — opt into the aligned card presentation.
- `views/recipes/index.ejs` — reuse extracted presentation while preserving all private controls/filter links.
- `views/partials/recipe-card.ejs` and/or a new focused shared card partial — reuse core metadata layout; protect existing Search consumers.
- `public/css/styles.css` — only any minimal reusable spacing/wrapping rules needed to match the existing My Recipes presentation.
- `database/migrations/013_public_recipe_card_metadata.sql` — scoped public SELECT policies for published metadata.
- Focused new `*.test.js` files under `src/` — rendering/data regression coverage using the built-in Node test runner.
- `docs/plans/rew-59-browse-recipe-cards.md` and final implementation/verification notes — traceable plan and actual outcomes.

## Database changes

One new migration is required for SELECT policies on `tags`, `recipe_tags`, and `recipe_categories`; no tables, columns, or mutation privileges change. Public users can read tags attached to published recipes and relationships belonging to published recipes. Draft-only tags and draft relationships remain private. A tag shared by a published and draft recipe becomes publicly visible as published metadata, but its draft relationship must remain hidden. Owners retain their complete private metadata access.

## Security considerations

Keep the anonymous public listing client and explicit published filter. Do not introduce service-role reads or broaden tag reads to every user's private tags. Public cards must never render Edit/Delete even for a signed-in owner; authorization remains enforced server-side. Escape tag/category/author/title text with EJS escaped interpolation. Preserve My Recipes' delete form and existing action authentication/CSRF behavior. Public badge URLs must not misleadingly navigate guests to private filters.

## Acceptance criteria

- [ ] The same published recipe shows the same core metadata and field ordering on Browse and My Recipes: title, author, categories, tags, both times, servings, difficulty, created date, and thumbnail when present.
- [ ] Zero tags produce no empty tag row; one and multiple tags render each tag with My Recipes' badge styling, placement below categories, and wrapping without overflow.
- [ ] More than two categories are not silently truncated on Browse when My Recipes displays all of them.
- [ ] Missing optional author/image/time/servings/difficulty values render cleanly; supplied prep and cook values both remain visible.
- [ ] Browse exposes neither Edit nor Delete for guests, signed-in owners, or other users; public recipe navigation and guest/signed-in Meal Plan behavior still work.
- [ ] My Recipes retains View/Edit/Delete, deletion confirmation, favorite state/draft disabling, and working category/tag filter links.
- [ ] Browse remains published-only, newest-first, with the same counts, pagination, empty state, and error behavior; Search does not regress.
- [ ] Public metadata reads include published associations but exclude draft associations and draft-only tags; owner access and write policies remain intact.
- [ ] Tag and other free-text content are HTML-escaped; long tags and titles do not overlap actions at narrow viewport widths.
- [ ] Existing automated tests and focused regressions pass; browser/database checks are reported truthfully as completed or pending.

## Accepted implementation correction

Migration 003 also restricts `categories` itself to authenticated reads. The parent accepted adding a fourth additive SELECT policy allowing category records associated with published recipes to be read by anon/authenticated roles. Without this correction public embedded category records would remain null. Existing authenticated category access is preserved.

# REW-26: Grocery List Generation

**Status:** Implemented, tested, not yet QA-verified
**Jira:** [REW-26](https://wanderingnerds.atlassian.net/browse/REW-26)
**Plan:** [REW-26: Grocery List Generation - Feature Plan](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/29786113/REW-26+Grocery+List+Generation+-+Feature+Plan) — update this page in place with the content below; do not fork a new page.

## What shipped

A printable grocery list generated on demand from a meal plan. `GET /meal-plans/:id/grocery-list` (owner-only, `requireAuth` + `getOwnedMealPlan`) loads every recipe in the plan, parses each recipe's free-text ingredients with the existing `parseIngredients()`, merges the same ingredient across recipes when their units are genuinely compatible (volumes/weights/counts summed; incompatible or unparseable amounts listed side by side rather than an invented number), and groups everything under a fixed, walk-the-store aisle taxonomy (Produce → ... → Other). Nothing is persisted — the list always reflects the plan's recipes exactly as they are right now. Entry point is a "Grocery List" link on the meal plan detail page, shown only when the plan has recipes.

A membership whose recipe can no longer be read (deleted, or switched Public → Private by another owner under REW-85) is skipped and counted, without ever revealing the missing recipe's title or owner.

## Interactive / print behavior (added after initial implementation)

- **Check off = strike through, not delete.** Checking an item's box toggles a CSS class; the row stays in the DOM, struck through and muted on screen, and is fully reversible by unchecking. Nothing is persisted here either — a page refresh clears every checkbox.
- **Checked items are left off the printout.** The same class that renders the strike-through on screen is hidden entirely under `@media print`, so what actually prints is only what's still needed.
- **Printing is condensed to far fewer pages.** The original print stylesheet forced an entire category to stay on one page (`break-inside: avoid` on the whole category), so one long "Produce" list that didn't fit the remaining page space pushed itself — and everything after it — onto a mostly blank next page, ballooning a normal list to 4 pages. Fixed by only protecting a category from splitting across the new **two-column print layout** (`break-inside: avoid-column`, not `avoid`), keeping each heading with its first item, and tightening print font sizes/spacing throughout.
- **Small/Large print size toggle.** A radio pair in the page header lets the shopper trade page count for legibility — "Small" (the condensed default) or "Large" (~25-30% bigger). The rules live entirely inside `@media print`, so the choice has no effect on the on-screen page.
- **Print-only "Potluck" brand line.** Printing hides the navbar, which is the only place the site name normally appears — so the printed page previously carried no indication of where it came from. A small brand line now appears only on the printed page (hidden on screen, where the navbar already covers it).

## A shipped bug, found and fixed mid-implementation

The aggregation module (`src/utils/groceryList.js`) was committed mid-refactor: `accumulate()` called a `pushVerbatim(item, text, isNote)` helper that had been split into `pushAmount()`/`pushNote()` without updating the call sites, and `renderAmounts()` read a field (`item.verbatim`) that was never set. Every real grocery list threw as soon as it hit an ingredient row. Fixed by routing the three call sites to the correct helper and renaming the mismatched `volume`/`volumeMl` field to match; confirmed via the full unit + view test suites before moving on to the interactive features above.

## Testing

`npm test`: **310/312 passing.** The 2 failures are a pre-existing, unrelated Windows Unix-domain-socket limitation in `csrf.integration.test.js` (not something this ticket touches). New/extended coverage: `src/utils/groceryList.test.js` (24 tests — categorization, cross-recipe merging, unit-compatible summing, refusal to invent numbers, section-heading exclusion, determinism, provenance) and `src/views/groceryList.test.js` (13 tests — store-ordered category rendering, `<script>` escaping, empty state, skipped-recipe notice, the checklist's strike-through/print-hide behavior, the print-only brand line, and the Small/Large toggle's markup/CSS/JS wiring).

No manual/QA verification against a running app has been performed in this session — recommended before considering this fully production-verified, particularly a real Chrome print-preview check of page count and the Small/Large sizing (`break-inside: avoid-column` and CSS `:has()` are both modern-browser features; verify against whatever the household actually prints from).

## Deployment

No migration, no new environment variable, no new dependency. `database/migrations/001`-`017` are untouched; no new migration file was added.

## Links

- API reference: `docs/api/meal-plans.md` (`GET /meal-plans/:id/grocery-list` section)
- Plan: `docs/plans/rew-26-grocery-list-generation.md`

# Jira Comment for REW-45

*Posted to the REW-45 Jira issue after documentation review:*

---

## Documentation Complete — Shipped

The ingredient measurement display ordering has been fixed per this QA
finding and is documented.

**What changed:**
- `withDisplayAmounts()` in `src/utils/ingredientScaler.js` now selects the
  practical kitchen measurement (cups/tbsp/oz/count) as `primaryAmount`,
  falling back to grams only when no practical measurement exists.
  `secondaryAmount` is the gram conversion, shown only alongside a practical
  measurement (never duplicated, never shown empty).
- This is a fixed default — there is still no user-facing toggle between
  measurement systems (out of scope for this ticket).
- No route, view, or database changes — display-formatting only. Both
  render sites (`views/recipes/view.ejs` and `public/js/main.js`
  `updateIngredientsDisplay()`) already consumed `primaryAmount`/
  `secondaryAmount` generically and needed no code changes.

**Testing:**
72/72 tests passing in `src/utils/ingredientScaler.test.js`, including a new
pinning test for the measurement-first/grams-second ordering and updated
assertions on the existing imperial/metric-weight and multi-row scaling
tests.

**Documentation updated:**
- `docs/api/recipe-scaling.md` — field descriptions and example JSON
  (developer-authored during implementation; verified accurate against the
  shipped code)
- `docs/RELEASE_NOTES_REW-11.md` — added an "Amendments" section noting the
  ordering reversal, with a historical note on the original (now outdated)
  example so that snapshot isn't rewritten
- Confluence: [Recipe Scaling API](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/14942210/Recipe+Scaling+API)
  — updated in place (field table, example JSON, and a new "Measurement
  display order (REW-45)" callout). This was blocked by permissions during
  planning; write access worked at documentation time and the page is now
  current.

**Deployment:**
No special configuration required. Display-formatting change only.

---

# REW-84 QA validation

Date: 2026-09-14  
Branch: `REW-84-clone-other-users-recipes`  
Overall result: **Automated/static QA passed; full acceptance not complete because live database and browser checks were not run.**

## Scope and evidence

Independent QA compared the current working tree with Jira REW-84, the implementation plan in `docs/plans/rew-84-clone-other-users-recipes.md`, the Jira developer report, and the reviewer verdict. Application code and product documentation were not changed by QA.

Evidence inspected:

- `database/migrations/018_add_recipe_clone_provenance.sql` and its contract tests
- `src/routes/recipeRoutes.js` and `src/routes/recipeCloneRoutes.test.js`
- `src/routes/recipeVisibilityRoutes.test.js`
- `views/recipes/view.ejs`, `views/recipes/public-view.ejs`, and `views/partials/recipe-summary-card.ejs`
- `src/views/recipeVisibility.test.js` and `src/views/recipeCard.test.js`
- Existing owner-scoped recipe, cookbook, meal-plan, favorite/like, visibility, public-read, and CSRF implementation/tests
- The complete Git working-tree diff, including `git diff --check`

## Command results

| Command | Result |
| --- | --- |
| `node --test database/migrations/018_add_recipe_clone_provenance.test.js src/routes/recipeCloneRoutes.test.js src/views/recipeVisibility.test.js src/views/recipeCard.test.js` | **Pass:** 27 tests, 0 failures |
| `npm test` | **Pass:** 283 tests, 0 failures |
| `git diff --check` | **Pass:** no whitespace errors |

The expected invalid-CSRF diagnostic messages printed by the existing CSRF integration tests did not fail the suite.

## Acceptance matrix

| Acceptance area | Result | Evidence / limitation |
| --- | --- | --- |
| Authenticated non-owner sees Add Recipe; owner and guest do not | **Pass (automated/static)** | View rendering test covers guest, owner, and authenticated non-owner; public view condition is `user && !isOwner`. Owner detail retains Edit and removes Clone/Add Recipe. No live browser session was run. |
| Mutation is POST-only, authenticated, CSRF-protected, and rate-limited | **Pass (automated/static)** | Router contract asserts POST and four-handler chain; route order is `requireAuth`, `addRecipeLimiter`, `csrfProtection`, handler. The full suite includes live HTTP middleware-level CSRF tests. Rate-limit exhaustion was not separately exercised. |
| Malformed, missing/inaccessible/private, and owner sources create no clone | **Pass (automated)** | Clone handler test covers malformed ID, source read failure, and current owner with no insert. Source query uses caller token plus explicit `status = published`. Live RLS behavior was not run. |
| Exactly one new Private recipe is owned by current user; success redirects with feedback | **Pass (automated)** | Insert assertion verifies server-selected `user_id`, `status = draft`, one recipe insert, success flash, and redirect to `/recipes/<new-id>`. |
| Supported recipe content/source URL/categories copied | **Pass (automated)** | Explicit inserted payload and two category rows are asserted. |
| IDs, timestamps, source ownership, likes, tags, cookbook/meal-plan associations, and hosted images omitted | **Pass (automated/static)** | Insert assertion is an exact allowlist and forces image fields null; only categories receive relationship inserts. No source tags or other association tables are read or written. |
| Root attribution is recorded, displayed separately, escaped, and retained through edits | **Pass (automated/static)** | Clone and clone-of-clone tests verify snapshot derivation/propagation; view/card tests verify escaped, distinct attribution. Migration contract rejects provenance rewrites. A real edit round trip was not run. |
| Category-copy failure does not report success and cleans up inserted recipe | **Pass (automated)** | Test verifies owner-scoped cleanup delete, no success flash, and error redirect. Cleanup-delete failure logging exists but was not separately simulated; such a failure would not report success but could leave an incomplete private row. |
| Editing/deleting source or one clone does not mutate siblings; source delete preserves clone attribution | **Pass (static/contract)** | Clone is a new row and existing update/delete routes are owner/id scoped. FK is `ON DELETE SET NULL`; trigger contract permits only referential source clearing while preserving `original_author`. No live PostgreSQL behavior was run. |
| Clone behaves as current-user-owned for edit/delete, cookbook, meal plan, favorite/like, and visibility flows | **Pass (static/regression)** | New row uses the current user's ID and redirects to normal owned detail; existing relevant route/regression tests pass against the new recipe-ID model. No authenticated end-to-end workflow was run. |
| Non-owner source update/delete stays protected; provenance rewrite rejected | **Pass (static/automated contract)** | Existing update regression verifies `id` plus `user_id` filters and prevents relationship mutations after non-owner failure. Migration tests verify immutable provenance trigger and unchanged grants/RLS. Live direct database attempts were not run. |
| Source deletion, migration constraints/triggers, and RLS on a real Supabase database | **Not run** | `.env` provides application Supabase URL/anon key only; no safe isolated database, Supabase CLI, `psql`, seeded users, or migration test target was configured. QA did not mutate a potentially shared remote database. |
| Owner/non-owner/guest authenticated browser workflows | **Not run** | No browser automation dependency/harness or seeded test credentials were configured. |
| Desktop/mobile responsive layout and keyboard/focus affordance | **Not run** | Static markup uses a native `<form>` and `<button>`, which is keyboard-operable by default, but rendered layout, focus visibility, activation, and responsive behavior require browser acceptance. |

## Findings and residual risks

No automated acceptance blocker was found.

One non-blocking documentation defect from review remains: `database/README.md` says cloning copies “category/tag selections,” while REW-84 intentionally copies categories and omits user-owned tags. This should be corrected before final documentation publication.

The cleanup strategy is compensating rather than transactional. The tested category-insert failure path deletes the new recipe and reports failure; if that cleanup delete itself fails, the handler logs the cleanup error and reports failure, but a private incomplete recipe may remain. This is a residual operational risk, not an observed test failure.

## Required completion checks

Before claiming complete acceptance, run migration 018 in an isolated/live Supabase test environment and verify paired provenance, immutability, owner/non-owner RLS, and source deletion. Then run authenticated browser acceptance with separate owner/viewer/guest sessions, including clone/edit independence, organization flows, keyboard activation/focus, and desktop/mobile layouts.

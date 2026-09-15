# Release Notes: REW-69 - Add Meal Plan Sharing

**Date:** 2026-09-14
**Jira Issue:** [REW-69](https://wanderingnerds.atlassian.net/browse/REW-69) (Task, Medium, epic REW-2 — Phase 2: Core Recipe Organization & Import)
**Branch:** `REW-69-meal-plan-sharing`
**Pipeline:** Planner → Developer → Reviewer (**Approved**, no blocking issues). **QA was deliberately skipped for this run.** These notes describe what was built and reviewed, not what has been verified in a live environment. The change is **uncommitted in the working tree** — nothing was pushed and no PR was opened. REW-69 remains **In Progress** in Jira; it has not been transitioned to Done.

---

## Summary

Meal plan owners get one explicit, reversible **Private ↔ Public** choice per plan. Making a plan Public makes it readable by anyone at `/m/<meal-plan-id>` — the plan's own UUID *is* the share link, exactly the pattern the app already uses for public recipes at `/r/<recipe-id>` and shared cookbooks at `/c/<cookbook-id>`. There is no share token, no `meal_plan_shares` table, and no per-user grant.

Private is the default, stays the default for every new plan, and is the state of every plan that existed before migration `020`. Making a plan Private again revokes its link on the very next request — visibility is re-read from Postgres per request and never cached, so there is nothing to invalidate.

The shared page renders the plan's title, its scheduled start–end date range, and its Public recipes as read-only cards. It is read-only for **everyone**, including the owner opening their own share link.

The privacy-critical behavior: a meal plan may contain the owner's Private (draft) recipes, because REW-63 deliberately made membership independent of publish status. A shared plan shows **only** Public recipes, and that is enforced structurally rather than by a filter someone could later remove — see "How Private-recipe privacy is enforced" below.

**The one deliberate divergence from REW-19 (cookbook sharing): meal plans are link-only and are not surfaced in site search.** A meal plan is a time-boxed personal schedule ("Week of Sept 20"), not browsable content. Indexing strangers' plans into a recipe search would be noise for searchers and a privacy surprise for owners, and the ticket asks only that another person can easily see what meals are planned. No `search_meal_plans` RPC, no `tsvector` column, no index, no change to `/search`.

---

## User-Facing Changes

- A meal plan's detail page (`/meal-plans/:id`) now has a labelled visibility control in the header action row showing the current state (Private or Public) and a single button to switch it. It is visually and structurally distinct from the per-recipe Private/Public pills on the cards below, so "this plan is Public" can't be confused with "this recipe is Public."
- While a plan is Public, the detail page shows a share panel with the full URL in a read-only field and a **Copy link** button.
- Switching visibility shows a confirming flash in Private/Public wording: *"This meal plan is now Public. Anyone with the link can view it."* / *"This meal plan is now Private. Its share link no longer works."*
- The **My Meal Plans** list (`/meal-plans`) shows a Public marker on shared plans so an owner can see at a glance which ones are out in the world.
- Opening a share link renders a read-only page: the plan's title, its start–end date range (formatted identically to the owner view), the visible recipe count, and its Public recipes as cards linking through to `/r/:id`. There is no edit, rename, re-date, delete, add-recipe, remove-recipe, or grocery-list control anywhere on that page **for anyone, including the owner opening their own link**. Signed-out visitors also see a sign-up call to action.
- A Public plan whose recipes are all Private renders a neutral empty state ("This meal plan doesn't include any Public recipes yet.") with no hint that anything is hidden — no "n recipes hidden" counter, no placeholder cards.
- A Private plan, a nonexistent plan, and a malformed link all return the same 404 page with the same message, so a Private plan's existence can't be probed.
- Public meal plans do **not** appear anywhere in site search, for anyone, including their owner searching the exact title.
- A plan containing another user's Public recipe shows that recipe with its author attribution — a shared plan is not necessarily "the owner's recipes."

---

## Technical Changes

### Database — one new migration

`database/migrations/020_add_meal_plan_sharing.sql` (new; migrations `001`–`019` are untouched). Purely additive:

- `meal_plans.is_public BOOLEAN NOT NULL DEFAULT false`, added `IF NOT EXISTS` — so every pre-existing row is Private with no backfill.
- **Two additive SELECT policies**, both `TO anon, authenticated`. On `meal_plans`: rows where `is_public = true`. On `meal_plan_recipes`: rows where the parent plan is Public **and** the referenced recipe has `status = 'published'`, as two `AND`-ed `EXISTS` subqueries. The second condition is not redundant — without it, an anonymous PostgREST read of `meal_plan_recipes?meal_plan_id=eq.<public_id>&select=recipe_id,created_at` would have disclosed the count, UUIDs, add-times, and `planned_servings` of the owner's Private recipes even while the recipe rows themselves stayed hidden. This is the REW-92 lesson already applied to cookbooks in `019`.
- The four owner-only policies from `011` and the three from `012` are untouched. Permissive policies are OR'd, so the owner still sees all of their own rows, including membership rows pointing at their Private recipes.
- Explicit `GRANT SELECT` on `meal_plans` and `meal_plan_recipes` to `anon, authenticated`, matching the pattern in `003`, `013`, and `019`. RLS remains the row-visibility boundary; the grant only permits the read to be attempted.
- **No index, no search vector, no RPC, no trigram extension.** The only query against a Public plan is `id = ? AND is_public = true`, which the primary key already serves.
- **No new UPDATE/INSERT/DELETE policy anywhere.** "Users can update own meal plans" from `011` already covers an owner writing a new column on a row they can update; membership stays insert/delete only.
- **No change to `recipes`**, its policies, or its grants. The published/owner SELECT policy from `001` is precisely the mechanism relied on for Private-recipe privacy.
- The migration header explicitly notes that it supersedes `011`'s "deliberately NO public/shared SELECT policy" comment, and carries a ROLLBACK block. `011` itself is not edited — it has already been applied.

### `src/routes/publicRoutes.js`

- New `GET /m/:id`. Screens the ID against the file's UUID pattern, fetches the plan on `id` + `is_public = true` selecting only `id, title, start_date, end_date` (never `user_id`), and renders the generic 404 for missing *and* private rows with one identical message — with no second query on the not-found branch that could be timed.
- New module-local `getPublicMealPlanRecipes(mealPlanId)` helper using an inner-join embed (`recipes!inner(...)`) plus an explicit `.eq("recipes.status", "published")`, ordered by the membership row's `created_at` descending, with a defensive `.filter(Boolean)` for delete races and a log-and-return-`[]` error path.
- **Every query runs on the module-level anon-key client.** No owner-scoped client is constructed anywhere in the handler or the helper, and the rendered page has no `isOwner` branch.
- `GET /search` is **not** touched.

### `src/routes/mealPlanRoutes.js`

New `POST /:id/visibility` behind `requireAuth` and the **existing** `mealPlanLimiter` (30/min per user — no new limiter). Screens the ID, normalizes `req.body.visibility` fail-closed, and updates with both `.eq("id", id)` and `.eq("user_id", req.user.id)` plus `.select().maybeSingle()`, so a missing row and someone else's row are indistinguishable. A real database error and a not-found result are logged differently but produce the same user-facing flash. The handler is exported as `handleMealPlanVisibilityUpdate(req, res, { createClient })` with an injectable client factory — the first named export in this file — following the `handleCookbookVisibilityUpdate` precedent. `GET /:id` now also passes `appUrl: getAppUrl()` so the view can render the share URL.

### `src/utils/mealPlanUtils.js`

Adds the frozen `MEAL_PLAN_VISIBILITY` constant and `normalizeMealPlanVisibility()`, which returns `true` only for the exact string `"public"` — a missing field, an array from duplicated inputs, wrong casing, `"true"`, `"published"`, a number, or an object all resolve to Private. Modeled directly on `normalizeCookbookVisibility()` (REW-19) and `normalizeRecipeVisibility()` (REW-85).

### Views and assets

- `views/meal-plans/public-view.ejs` (new) — read-only shared-plan page reusing `views/partials/recipe-card.ejs` and the shared `organization-card-grid` class. No mutation form, no `_csrf`, no `isOwner` anywhere in the template. Includes the signed-out sign-up CTA.
- `views/meal-plans/view.ejs` — visibility control, share-link panel, and a page-local `<script src="/js/meal-plan-share.js">` tag.
- `views/meal-plans/index.ejs` — Public marker on shared plans.
- `public/js/meal-plan-share.js` (new) — Copy-link handler only, using `navigator.clipboard.writeText` with a visible `aria-live` confirmation and a select-the-text fallback when the Clipboard API is unavailable or the page isn't a secure context. External file only; CSP is `script-src 'self'` and was not changed. A deliberate near-copy of `cookbook-share.js` rather than a generalization, to avoid editing a file whose contents `cookbookSharing.test.js` pins.
- `public/css/styles.css` — `.meal-plan-visibility-*` and `.meal-plan-share-*` classes, grouped with their `.cookbook-*` equivalents.

New locals (`appUrl` on the plan view, `is_public` on plan cards) are `typeof`-guarded so the existing view tests, which render these templates with fixed fixtures, keep passing.

---

## How Private-recipe privacy is enforced

Three layers, listed in the order of how much weight each actually carries:

1. **The anon key.** `/m/:id` and its recipe fetch use the anon-key Supabase client exclusively. Under it `auth.uid()` is null, so the `recipes` SELECT policy from migration `001` (owner **or** `status = 'published'`) can only return published rows. A Private recipe in a Public plan is invisible at the database layer regardless of what the route handler does — including when the owner is the one viewing.
2. **The junction policy.** The new `meal_plan_recipes` policy requires the recipe to be published, so Private recipes can't be enumerated through a direct anon-key API read either. The threat model is the raw PostgREST request, not just the rendered page.
3. **The explicit predicate.** `.eq("recipes.status", "published")` in the query itself, as defence in depth, mirroring what `GET /r/:id` and `GET /c/:id` already do.

Deliberate consequence: a Public meal plan containing only Private recipes renders empty. That is correct, and it has its own empty state.

---

## Decisions and Tradeoffs

| Decision | Rationale | Tradeoff accepted |
|---|---|---|
| **Link-only — no search discoverability** (the one deliberate divergence from REW-19) | A meal plan is a time-boxed personal schedule, not browsable content. Indexing strangers' plans into a recipe search would be noise for searchers and a privacy surprise for owners. The ticket asks only that another person can easily see what meals are planned | Nobody can discover a shared plan without the link. If discoverability is wanted later it is a follow-up migration modeled on `search_cookbooks`, with its own privacy decision |
| Two states (Private/Public), not three | The ticket asks for one reversible sharing choice; an "unlisted" middle state was not requested — and since plans aren't searchable at all, the distinction wouldn't mean anything today | No separate link-only-vs-listed axis. `is_public` would split into two booleans if search is ever added |
| No share token or slug — the plan UUID is the link | Matches the existing `/r/:id` and `/c/:id` precedent; a token doubles the surface area for the sole benefit of revoking the link independently of search visibility, which doesn't exist here | Revoking means flipping the plan back to Private; there is no narrower revocation |
| No plan-level owner attribution on the public page | `getAccountDisplayName()` reads `user_metadata` off an auth user object — it can only describe the current viewer, and the anon client can't read another account's `auth.users` row at all. Doing it properly needs a public profiles table or an owner-name snapshot column, i.e. new schema and a new privacy decision the ticket never asked for | A shared plan shows no "by \<owner\>" line. Per-recipe attribution still appears, since each card renders the free-text `recipe.author` (REW-46) |
| The public page is read-only for *everyone*, including the owner | Removes the `isOwner` branch entirely, so there is nothing to get wrong and no reason for the handler to construct an owner-scoped client | An owner previewing their share link has to go back to `/meal-plans/:id` to edit |
| No new index | The only query against a Public plan is `id = ? AND is_public = true`, served by the primary key. There is no public-plan listing and no plan search | None in practice; adding `019`'s partial `created_at` index would have been cargo-culting |
| No day-level or meal-slot rendering on the shared page | The ticket's "any meal/date organization already supported by the Meal Plan feature" resolves today to exactly the plan-level date range plus the added-order recipe list. `meal_plan_recipes` has no `planned_date`, day offset, or meal slot — REW-63 deferred that | If a recipient expects a day-by-day grid, this doesn't give them one. That needs its own ticket, and it would have to land before a day-by-day share is meaningful |
| A new `public/js/meal-plan-share.js` rather than generalizing `cookbook-share.js` | Generalizing would edit a file that shipped hours earlier and require rewriting three assertions in `cookbookSharing.test.js` that pin the cookbook script's path and contents | ~45 lines of near-duplicate client JS, consistent with this repo's stated tolerance for small per-feature duplication |
| No grocery list on the shared page | `/meal-plans/:id/grocery-list` stays owner-only behind `requireAuth`. Not requested | A recipient can't generate a shopping list from a shared plan. Plausible follow-up |
| Copying a shared plan into your own account is out of scope | Same call REW-19 made for cookbook cloning | Tracked conceptually alongside [REW-91](https://wanderingnerds.atlassian.net/browse/REW-91) (the cookbook equivalent). Recipe-level cloning (REW-84) already works from `/r/:id`, so visitors can copy recipes one at a time today |

### Accepted residual exposure (reviewer's note)

For a **Public** plan, a direct anon PostgREST read of `meal_plans` can see that row's `user_id`, `created_at`, and `updated_at` alongside the title and dates the page already shows — so a determined reader can correlate several of one owner's *Public* plans to the same owner UUID. This was raised by the Reviewer and **accepted by design**: it is identical to the pre-existing posture for published `recipes` and Public `cookbooks`, whose `user_id` is likewise anon-readable, and **no Private plan is exposed by it**. The route handler itself never selects `user_id`. Tightening it would mean column-level grants — a new, app-wide convention that belongs in its own ticket.

Relatedly, `meal_plan_recipes.planned_servings` becomes anon-readable for a Public plan's published edges. It is schema-only today (no route or view writes it, REW-63), so nothing is disclosed in practice.

---

## Breaking Changes

None. Purely additive: one new column on an existing table, two new permissive SELECT policies (existing policies untouched), new grants, one new authenticated POST route, one new public GET route on a previously-unused path, and new optional template locals. No existing route, table, response shape, or environment variable changed.

---

## Deployment

- **Migration `020_add_meal_plan_sharing.sql` must be run manually** against the Supabase project's SQL editor, after `019`, following this repo's standard workflow (see `database/README.md`). Until it is applied, `POST /meal-plans/:id/visibility` and `GET /m/:id` will error.
- No backfill is required — `is_public` is `NOT NULL DEFAULT false`, so every existing meal plan is Private the moment the migration completes.
- **No new environment variables.** `APP_URL` must already be set correctly in Vercel's Production environment (required since REW-57) — it is now also the origin of every meal plan share link an owner copies, so a wrong value produces links that don't work for recipients.
- No Vercel configuration changes, no new packages, no auth/CSRF/CSP/rate-limiter middleware changes, no `src/app.js` changes.
- Rollback is documented in the migration header and in `database/README.md`: dropping the two policies and the `is_public` column returns meal plans to REW-63 behavior with no data loss. Application code must be rolled back alongside it. There is no index, function, or generated column to drop.

---

## Testing

**Reviewer verdict: Approved, no blocking issues.**

**Automated:** the change ships with new and extended coverage under `npm test` / `node --test`:

- `src/utils/mealPlanUtils.test.js` (extended) — `normalizeMealPlanVisibility()` fail-closed cases (`"public"` → true; `"private"`, `undefined`, `null`, `""`, `"PUBLIC"`, `"Public"`, `"true"`, `"published"`, `["public"]`, `{}`, `42` → false).
- `src/routes/mealPlanVisibilityRoutes.test.js` (new) — the stored value flips in both directions against table `meal_plans`; both `id` and `user_id` filters are applied on every call; malformed UUIDs never reach the database and redirect to `/meal-plans`; an unknown or absent `visibility` fails closed to Private; a not-found row flashes identically to the non-owned case and is not logged as a DB error while a real error is; the success flash uses Private/Public and never matches `/draft|published/i`; the route is registered for POST at `/:id/visibility` with a three-layer chain including `requireAuth`.
- `src/routes/publicRoutes.test.js` (extended) — `/m/:id` filters on `id` and `is_public = true`, queries only `meal_plans` on the not-found branch, and renders the 404 path; Private, nonexistent, and malformed IDs produce one identical payload; source-level assertions that neither the handler nor `getPublicMealPlanRecipes` contains `createSupabaseClient`/`req.accessToken`/`sb-access-token`, and that the fetcher contains `recipes!inner` and `.eq("recipes.status", "published")`; migration-content assertions against `020` read from disk (column definition present, exactly two `CREATE POLICY` statements, `AND EXISTS` with no `OR EXISTS`, no `MATERIALIZED VIEW`, no `DROP`/`ALTER POLICY` in executable SQL, nothing touching `recipes`).
- `src/views/mealPlanSharing.test.js` (new) — the shared page renders identically for `null`/owner/other-user `user` locals and contains no mutation link, no `<form`, no `_csrf`, no `isOwner`/`accessToken`/`csrfToken`; title, date range, and card metadata are HTML-escaped; cards link to `/r/<id>`; the empty state renders and matches nothing like `/hidden|private recipe|draft|not shown/i`; the owner view posts `private|public` with a real CSRF token, shows the share link only while Public, still renders when `appUrl` is omitted, and loads `/js/meal-plan-share.js` externally with no inline handler.
- `src/views/organizationCardGrid.test.js` (extended) — `views/meal-plans/public-view.ejs` added to the pinned `organizationViews` list.

**Note on suite totals:** this documentation pass did not execute the test suite, so no pass/fail count is claimed here. The pre-existing environmental `EACCES /tmp/*.sock` failures in `src/csrf.integration.test.js` on Windows are unrelated to this change and are expected to persist.

### QA was not run — unverified acceptance criteria

**No part of this feature has been exercised against a live Supabase with migration `020` applied.** The following acceptance criteria from `docs/plans/meal-plan-sharing.md` are **not** verified and must not be treated as passing:

- **AC3** — the rendered share URL's origin comes from `APP_URL`/`getAppUrl()` and does not change under a spoofed `Host` / `X-Forwarded-Host`, and the Copy button works.
- **AC5** — a Public plan containing at least one Private recipe shows zero trace of it at `/m/:id` — not in the cards, not in the count, not in the page source — to a logged-out visitor, a different logged-in user, **and** the owner.
- **AC6** — a Public plan whose recipes are all Private renders the neutral empty state.
- **AC11** — a direct PostgREST read of another user's Private plan rows, and of a Public plan's Private membership edges, returns nothing for both an anonymous key and a different authenticated user.
- **AC12** — an other-user recipe switched back to Private disappears from the shared page on the next load without error.
- **AC13** — toggling visibility changes no recipe's `status`, adds or removes no membership, alters no dates, and plan deletion still deletes zero recipes.
- **AC16** — the visibility endpoint is rate-limited at 30 mutations/minute like every other meal plan mutation.

The remaining criteria (AC1, AC2, AC4, AC7–AC10, AC14, AC15, AC17–AC19) are supported by code review and the automated suite but have likewise not had a manual browser pass. A full manual run against the plan's 19-item checklist is required before this is called done.

---

## Documentation

- `README.md` — new "Meal Plan Sharing (REW-69)" feature section; the Meal Plans section's "private with no sharing" line corrected; Project Structure updated for `publicRoutes.js`, `mealPlanRoutes.js`, `mealPlanUtils.js`, the meal-plans views directory, and `meal-plan-share.js`; `APP_URL` notes extended to mention the meal plan share link.
- `docs/api/meal-plans.md` — `POST /meal-plans/:id/visibility`, the public `GET /m/:id` contract including its identical-404 table, the deliberate no-search divergence, owner-facing UI notes, sharing-specific security notes including the accepted `user_id` exposure, and REW-69 testing/QA-gap notes. Also corrected a stale claim in that page's Security section that CSRF was disabled repo-wide — it is enforced.
- `docs/api/README.md` — visibility row added to the Meal Plans endpoint table, new "Public meal plan sharing" table, updated detailed-docs link text.
- `database/README.md` — migration row 20; the `is_public` column; the two new RLS policies and why the junction policy checks recipe status; the note that `011`'s "deliberately NO public/shared SELECT policy" statement is superseded by `020`; new grants; the deliberate absence of an index; a sharing/Private-recipe-privacy note; the accepted residual `user_id` exposure; a REW-69 deployment note; and a sharing-only rollback snippet.
- `docs/RELEASE_NOTES_REW-69.md` — this file.
- `docs/confluence/REW-69-meal-plan-sharing.md`, `docs/confluence/JIRA_COMMENT_REW-69.md` — repo record of the Confluence pages and Jira comment published this session.
- Confluence (posted): **Release: REW-69 - Add Meal Plan Sharing** (new) and **Meal Plans (REW-63, REW-69)** (the planner's page, brought from planned to as-built).
- `docs/plans/meal-plan-sharing.md` — left at its planning-complete state, matching this repo's convention.
- No `design_handoff_recipe_form/` changes — that directory does not exist in this repository, and this change touches meal plan pages, not the recipe form.

---

## Open Items for a Human

1. **Commit and push.** The entire change is uncommitted in the working tree on `REW-69-meal-plan-sharing`. No PR has been opened.
2. **Run migration `020` against Supabase.** It has not been applied to any live project by this pipeline run.
3. **Run QA.** The seven acceptance criteria listed above can only be confirmed against a live database, and none of the nineteen have had a manual browser pass.
4. **Confirm the link-only decision with the product owner.** Not surfacing Public meal plans in search is the largest scope judgement in this ticket. It is a defensible default and reversible, but it was an assumption, not a stated requirement.
5. **Confirm no day-by-day grid is expected.** The shared page shows the plan-level date range and an added-order recipe list, because that is all the schema supports. If the requester pictured a Monday–Sunday grid, that is a separate ticket that has to land first.
6. **Decide the Jira status.** REW-69 was deliberately left **In Progress**. It should not move to Done until QA has run.
7. **Confirm the share-link copy reads well in production**, in particular that `APP_URL` in Vercel matches the canonical origin users expect to receive.

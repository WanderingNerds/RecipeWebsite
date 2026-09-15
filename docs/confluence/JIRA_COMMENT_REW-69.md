# Jira Comment for REW-69

**Posted to [REW-69](https://wanderingnerds.atlassian.net/browse/REW-69) on 2026-09-14.** REW-69 was deliberately **left In Progress** — it was not transitioned, because QA has not run and the change is still uncommitted with no PR opened.

---

## Implementation and documentation complete; reviewer-approved. QA was NOT run and nothing is pushed — do not treat this as verified

Meal plan sharing is implemented: one explicit, reversible Private/Public choice per plan. Public makes a plan readable by anyone at `/m/<id>`; Private is the default and stays the default, and flipping back to Private revokes the link on the very next request (visibility is read from Postgres per request and never cached). The plan's own UUID is the share identifier — same pattern as `/r/<id>` for recipes and `/c/<id>` for cookbooks — so there is no share token and no new table. The whole mechanism is one boolean column plus two additive RLS SELECT policies.

The shared page shows the plan title, its scheduled date range, and its Public recipes as read-only cards. It is read-only for **everyone**, including the owner opening their own share link — there is no `isOwner` branch and no mutation form in the template at all.

**One deliberate divergence from REW-19 (cookbook sharing): meal plans are link-only and are NOT surfaced in site search.** No search RPC, no `tsvector` column, no index, no change to `/search`. A meal plan is a time-boxed personal schedule, not browsable content, and the ticket asks only that another person can easily see what meals are planned. This was an assumption in the plan rather than a stated requirement, and it is the largest scope judgement in the ticket — worth a one-line confirmation. It is reversible as a follow-up modeled on `search_cookbooks`.

Private recipes inside a shared plan are protected structurally, not by an application filter: `/m/:id` and its recipe fetch run entirely on the anon-key Supabase client, where `auth.uid()` is null, so the existing `recipes` SELECT policy can only return published rows. The new `meal_plan_recipes` policy additionally requires the joined recipe to be published — `AND`-ed with the parent-plan check, never `OR`-ed — so Private recipes cannot be enumerated through a direct anon-key API read either. A Public plan whose recipes are all Private renders a neutral empty state that does not hint anything is hidden.

**Review:** Approved, no blocking issues.

**Worth flagging explicitly (reviewer's note, accepted by design):** an anon PostgREST read of a **Public** plan's `meal_plans` row can see its `user_id`, `created_at`, and `updated_at`, so several of one owner's Public plans can be correlated to the same owner UUID. This is identical to the pre-existing posture for published recipes and Public cookbooks, and **no Private plan is exposed by it**. The route handler itself never selects `user_id`. Tightening it would require column-level grants — a new app-wide convention that belongs in its own ticket. Documented in both Confluence pages and in `database/README.md` so it is not rediscovered later as a finding.

**Automated validation:** new and extended coverage ships with the change — fail-closed visibility normalizer, visibility-handler unit tests (value flips both directions, both `id`/`user_id` filters applied on every call, malformed UUIDs never reach the database, unknown/absent value fails closed, not-found is not logged as a DB error, flash copy never matches `/draft|published/i`, route registered with a three-layer chain including `requireAuth`), `/m/:id` predicate and identical-404 tests, source-level assertions that no owner-scoped client appears in the public handler or its recipe fetcher, migration-content assertions against `020`, and public/owner template render assertions. **No suite pass/fail count is claimed** — the documentation pass did not execute the test suite.

**Documentation:**
- [Release: REW-69 - Add Meal Plan Sharing](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/30277641/Release+REW-69+-+Add+Meal+Plan+Sharing) (new)
- [Meal Plans (REW-63, REW-69)](https://wanderingnerds.atlassian.net/wiki/spaces/Recipe/pages/25198593/Meal+Plans+REW-63+REW-69) — the planner's page, brought from planned to as-shipped
- Repo: `README.md`, `docs/api/meal-plans.md`, `docs/api/README.md`, `database/README.md`, `docs/RELEASE_NOTES_REW-69.md`

**Not verified — QA was deliberately skipped for this run.** Nothing has been exercised against a live Supabase, and migration `020_add_meal_plan_sharing.sql` has not been applied to any project. These acceptance criteria are explicitly **not** claimed as passing: **AC3** (share URL origin unaffected by a spoofed `Host`/`X-Forwarded-Host`, Copy button), **AC5** (zero trace of a Private recipe at `/m/:id` for visitor, other user, and owner), **AC6** (all-private empty state), **AC11** (direct PostgREST anon/cross-user reads return nothing for a Private plan's rows or a Public plan's Private membership edges), **AC12** (an other-user recipe switched back to Private disappears cleanly), **AC13** (toggling visibility changes no recipe status, membership, or dates), **AC16** (30/min rate limiting on the visibility endpoint). The remaining criteria are supported by code review and the automated suite but have had no manual browser pass.

**Deployment:** migration `020_add_meal_plan_sharing.sql` must be run manually after `019`. It is additive with no backfill — every existing meal plan is Private afterwards. No new environment variables, no Vercel config change, no new packages. `APP_URL` must already be correct in Vercel Production, since it is now also the origin of every meal plan share link an owner copies.

**Also note:** the change is **uncommitted in the working tree** on branch `REW-69-meal-plan-sharing`. Nothing was pushed and no PR was opened by this run.

**Still open for a human:** confirm the link-only (non-searchable) decision, and confirm that no day-by-day meal grid is expected — the shared page shows the plan-level date range and an added-order recipe list, because that is all the schema supports today (REW-63 deferred per-day assignment, and REW-69 did not add it).

Leaving this ticket In Progress pending QA.

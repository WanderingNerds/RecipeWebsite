# Confluence Content Drafted for REW-62 (NOT POSTED)

**Status: NOT POSTED.** No Atlassian tool functions (`getAccessibleAtlassianResources`, `getJiraIssue`, `createConfluencePage`, `addCommentToJiraIssue`, `getTransitionsForJiraIssue`, `transitionJiraIssue`, etc.) were exposed in this documentation session's tool set — only `Read`, `Write`, `Edit`, `Grep`, and `Glob` were available. This matches what the Planner, Developer, and Reviewer stages of this same REW-62 pipeline run separately reported ("no such tool available" for every Atlassian call), and the same gap recorded in this repo's prior documentation sessions (REW-52 through REW-58). The Planner's plan (`docs/plans/rew-62-cookbooks.md`) also notes it could not create or find an existing Confluence page for this feature.

The next agent/human with working Atlassian access should:
1. Call `getAccessibleAtlassianResources` first and reuse the returned `cloudId` for every subsequent call.
2. Search Confluence for an existing "Recipe Collections" / "Cookbooks" page (the Planner flagged this as unchecked — check before creating Page 2 below, to avoid a duplicate).
3. Create **Page 1** (release notes) using `createConfluencePage`, titled exactly `Release: REW-62 - Create and Manage Cookbooks`.
4. Create or update **Page 2** (feature/architecture reference) — if no existing "Cookbooks"/"Recipe Collections" page is found, create it with the title `Cookbooks (REW-62)`; if one exists, update it in place with this content instead of duplicating it.
5. Post the Jira comment in `docs/confluence/JIRA_COMMENT_REW-62.md` to REW-62, linking both pages.
6. Decide the correct "implemented + reviewed, not yet QA'd" status for this team's Jira workflow (see that file for the recommendation) — do not transition straight to Done, since QA has not run.

---

## Page 1: "Release: REW-62 - Create and Manage Cookbooks"

**Suggested parent:** Release Notes / Sprint Releases space (same parent used for prior "Release: REW-XX" pages, e.g. REW-46, REW-56, REW-58).

### Page content

> ## Summary
> Users can now organize their own recipes into private, named collections called **cookbooks**. A cookbook belongs to one user, requires a title, and can hold any number of the owner's own recipes (draft or published); a recipe can belong to multiple cookbooks. Cookbooks can be created, renamed, and deleted; recipes can be added to and removed from a cookbook independently of the recipe's own lifecycle. Deleting a cookbook never deletes its recipes. Cookbooks are private by default, enforced at the database (Row Level Security) layer — not just hidden in the UI.
>
> ## What shipped
> - New "Cookbooks" navbar link → "My Cookbooks" list page, with recipe counts per cookbook.
> - Create / rename / delete a cookbook.
> - Bulk "Add Recipes" picker on a cookbook's detail page (checklist of the owner's own draft + published recipes).
> - "Save to Cookbook(s)" widget on the recipe detail page for one-recipe-at-a-time add/remove, without leaving the recipe.
> - Two new database tables: `cookbooks` and `cookbook_recipes` (junction table), both with Row Level Security. See the **Cookbooks (REW-62)** reference page for schema and endpoint details.
>
> ## Pipeline
> Planner → Developer → Reviewer (**Approved, no blocking issues**). **QA was explicitly skipped for this pipeline run per orchestrator instruction** — not a rejection. Manual/QA verification against the acceptance criteria in `docs/plans/rew-62-cookbooks.md` is still recommended before this is considered fully production-verified (see the release notes' Testing section for the checklist).
>
> ## Scope note
> Cookbook **sharing** (viewing another user's cookbook) is explicitly out of scope — tracked separately as REW-19. The schema was deliberately built so sharing can be added later without a breaking change.
>
> ## Links
> - Jira: REW-62 (link to be confirmed/attached by whoever posts this page — this session could not query Jira to verify the issue URL)
> - Full release notes: `docs/RELEASE_NOTES_REW-62.md` in the repo
> - API reference: `docs/api/cookbooks.md`
> - Database schema: `database/README.md` (`cookbooks` / `cookbook_recipes` sections)
> - Plan: `docs/plans/rew-62-cookbooks.md`

---

## Page 2: "Cookbooks (REW-62)" (feature/architecture reference)

**Suggested parent:** Same space/parent as other feature reference pages (e.g. wherever "Recipe Likes" or "Recipe Scaling" documentation lives, if such a page exists — check first per step 2 above).

### Page content

> ## What is a cookbook?
> A private, per-user named collection of the owner's own recipes. Modeled on the existing `recipes` + `recipe_categories` pattern: an owner-scoped `cookbooks` table plus a many-to-many `cookbook_recipes` junction table, both protected by Supabase Row Level Security.
>
> ## Key behaviors
> - A cookbook belongs to exactly one user; a recipe can belong to any number of a user's cookbooks.
> - Recipes are eligible regardless of draft/published status — cookbook membership is independent of a recipe's publish state.
> - Deleting a cookbook removes only the cookbook and its recipe associations — the recipes themselves are never touched.
> - Deleting a recipe removes it from any cookbooks it belonged to (standard cascade), without deleting the cookbook.
> - Cookbooks are **not visible to any user other than the owner** — there is no database policy allowing a non-owner to read a cookbook, so this holds even against a direct API/URL request, not just in the UI.
>
> ## Where it lives in the app
> | Area | Location |
> |---|---|
> | Routes | `src/routes/cookbookRoutes.js`, mounted at `/cookbooks` |
> | Validation helpers | `src/utils/cookbookUtils.js` (unit tested) |
> | Views | `views/cookbooks/*.ejs` |
> | Recipe-page integration | `src/routes/recipeRoutes.js` (`GET /:id`) + `views/recipes/view.ejs` "Save to Cookbook(s)" widget |
> | Database | `database/migrations/009_create_cookbooks_table.sql`, `010_create_cookbook_recipes_table.sql` |
> | Nav entry | `views/partials/navbar.ejs` |
>
> ## Security model
> - Every route requires authentication and layers an explicit ownership check on top of Row Level Security (belt-and-suspenders, matching the rest of this codebase's convention).
> - The `cookbook_recipes` INSERT policy requires the requester to own **both** the target cookbook and the recipe being added — enforced at the database layer, not just in application code.
> - Mutation endpoints are rate-limited to 30 requests/minute per user.
>
> ## Explicitly out of scope
> Cookbook sharing (viewing/collaborating on another user's cookbook) — tracked as REW-19. Not precluded by this design; would be added as an additional read policy or a `cookbook_shares` table.
>
> ## Related
> - API details: `docs/api/cookbooks.md`
> - Schema details: `database/README.md`
> - Release notes: `docs/RELEASE_NOTES_REW-62.md`

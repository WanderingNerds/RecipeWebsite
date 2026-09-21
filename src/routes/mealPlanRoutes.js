import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/authMiddleware.js";
import { csrfProtection } from "../middleware/csrfMiddleware.js";
import { createSupabaseClient } from "../config/supabase.js";
import {
  validateMealPlanTitle,
  validateDateRange,
  normalizeMealPlanVisibility,
} from "../utils/mealPlanUtils.js";
import { buildGroceryList } from "../utils/groceryList.js";
import { getAppUrl } from "../utils/authUtils.js";
// Recipe-id-selection normalization is generic UUID-array normalization,
// not cookbook-specific -- reused directly rather than duplicated, per the
// REW-63 plan (Task 3).
import { normalizeRecipeIdSelection } from "../utils/cookbookUtils.js";

const router = Router();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rate limiter for meal plan mutations (create/rename/delete/add/remove
// recipe). Mirrors cookbookLimiter in cookbookRoutes.js: keyed on the
// authenticated user's ID (not IP) since these routes always run after
// requireAuth, to prevent a compromised session or script from spamming
// meal plan creation or membership churn.
const mealPlanLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 mutations per minute
  message: "Too many meal plan actions. Please slow down.",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || "anonymous",
  validate: { xForwardedForHeader: false },
});

/**
 * Fetch a meal plan, scoped to the given owner. Returns null if the meal
 * plan doesn't exist OR belongs to someone else -- callers must treat both
 * cases identically (flash "not found", never leak existence).
 */
async function getOwnedMealPlan(supabaseClient, mealPlanId, userId) {
  const { data, error } = await supabaseClient
    .from("meal_plans")
    .select("*")
    .eq("id", mealPlanId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching meal plan:", error);
    return null;
  }

  return data;
}

// Columns the standardized meal plan card needs (REW-89). Mirrors
// COOKBOOK_CARD_COLUMNS in cookbookRoutes.js -- both surfaces render the same
// partial, so they must feed it the same shape -- plus the two fields the old
// lightweight meal plan card never fetched:
//
//   user_id         decides whether Edit/Delete are drawn. Presentational
//                   only, never rendered into the HTML, and never the sole
//                   authorization check: /recipes/:id/edit, /:id/update and
//                   /:id/delete each enforce ownership themselves. It matters
//                   more here than anywhere else so far: the RLS INSERT policy
//                   on meal_plan_recipes (migration 012) allows your own
//                   recipes OR anyone's published recipe, so this surface is
//                   genuinely mixed-ownership in production today.
//   original_author immutable "Adapted from" attribution.
//
// Body fields (instructions, notes) stay off a listing query --
// getMealPlanRecipeIngredients() below is the one that reads ingredients, and
// only for the grocery list.
const MEAL_PLAN_CARD_COLUMNS =
  "id, user_id, title, author, original_author, prep_time, cook_time, servings, difficulty, thumbnail_url, status, created_at, recipe_categories(categories(id, name, slug, icon)), recipe_tags(tags(id, name, slug))";

/**
 * Fetch the recipes currently in a meal plan, most recently added first.
 *
 * Exported for handler-level tests; the meal plan view handler below is the
 * only production caller.
 */
export async function getMealPlanRecipes(supabaseClient, mealPlanId) {
  const { data, error } = await supabaseClient
    .from("meal_plan_recipes")
    .select(`recipe_id, created_at, recipes(${MEAL_PLAN_CARD_COLUMNS})`)
    .eq("meal_plan_id", mealPlanId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching meal plan recipes:", error);
    return [];
  }

  // recipes(...) can be null if a row's recipe was deleted in the same
  // instant as this query (race), or if it's another user's recipe that
  // has since been unpublished -- filter defensively either way.
  //
  // One query, then flatten the embedded junction rows into the flat
  // categories/tags the card expects -- the same mapping GET /browse,
  // GET /recipes/liked and GET /cookbooks/:id use. The ordering above is on
  // the junction row's created_at, i.e. added-to-plan order, newest first.
  return (data || [])
    .map((row) => row.recipes)
    .filter(Boolean)
    .map(({ recipe_categories, recipe_tags, ...recipe }) => ({
      ...recipe,
      categories: (recipe_categories ?? []).map((link) => link?.categories).filter(Boolean),
      tags: (recipe_tags ?? []).map((link) => link?.tags).filter(Boolean),
    }));
}

/**
 * Fetch the ingredient text of every recipe in a meal plan, for grocery list
 * generation (REW-26).
 *
 * Deliberately separate from getMealPlanRecipes() above: that one feeds the
 * card grid and should not start shipping full ingredient text on every plan
 * detail page render.
 *
 * A membership row whose `recipes` join comes back null is one the caller can
 * no longer read -- the recipe was deleted, or it belonged to another user and
 * has since been switched from Public to Private (REW-85). RLS does that
 * filtering for us; all we do is skip the row and count it, so the page can
 * say "1 recipe could not be included" without leaking its title or owner.
 */
async function getMealPlanRecipeIngredients(supabaseClient, mealPlanId) {
  const { data, error } = await supabaseClient
    .from("meal_plan_recipes")
    .select("recipe_id, created_at, recipes(id, title, ingredients)")
    .eq("meal_plan_id", mealPlanId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching meal plan recipe ingredients:", error);
    return null;
  }

  const rows = data || [];
  const recipes = rows.map((row) => row.recipes).filter(Boolean);

  return { recipes, skippedCount: rows.length - recipes.length };
}

/**
 * Fetch recipe counts for a set of meal plans in one query, to avoid an
 * N+1 pattern on the meal plan list page (same batching approach used for
 * cookbooks in cookbookRoutes.js).
 */
async function getMealPlanRecipeCounts(supabaseClient, mealPlanIds) {
  const counts = new Map();
  if (!mealPlanIds.length) return counts;

  const { data, error } = await supabaseClient
    .from("meal_plan_recipes")
    .select("meal_plan_id")
    .in("meal_plan_id", mealPlanIds);

  if (error) {
    console.error("Error fetching meal plan recipe counts:", error);
    return counts;
  }

  for (const row of data || []) {
    counts.set(row.meal_plan_id, (counts.get(row.meal_plan_id) || 0) + 1);
  }

  return counts;
}

// GET /meal-plans/new - Show create-meal-plan form
router.get("/new", requireAuth, (req, res) => {
  res.render("meal-plans/new", {
    title: "New Meal Plan",
  });
});

// POST /meal-plans - Create a new meal plan
router.post("/", requireAuth, mealPlanLimiter, async (req, res) => {
  try {
    const { title, startDate, endDate } = req.body;

    const titleValidation = validateMealPlanTitle(title);
    if (!titleValidation.valid) {
      req.flash("error", titleValidation.error);
      return res.redirect("/meal-plans/new");
    }

    const dateValidation = validateDateRange(startDate, endDate);
    if (!dateValidation.valid) {
      req.flash("error", dateValidation.error);
      return res.redirect("/meal-plans/new");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    const { error } = await supabaseClient.from("meal_plans").insert([
      {
        user_id: req.user.id,
        title: titleValidation.title,
        start_date: dateValidation.startDate,
        end_date: dateValidation.endDate,
      },
    ]);

    if (error) {
      console.error("Error creating meal plan:", error);
      req.flash("error", "Failed to create meal plan. Please try again.");
      return res.redirect("/meal-plans/new");
    }

    req.flash("success", "Meal plan created!");
    res.redirect("/meal-plans");
  } catch (error) {
    console.error("Error in meal plan creation:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans/new");
  }
});

// GET /meal-plans - List all meal plans for the current user
router.get("/", requireAuth, async (req, res) => {
  try {
    const supabaseClient = createSupabaseClient(req.accessToken);

    const { data: mealPlans, error } = await supabaseClient
      .from("meal_plans")
      .select("*")
      .eq("user_id", req.user.id)
      .order("start_date", { ascending: true });

    if (error) {
      console.error("Error fetching meal plans:", error);
      req.flash("error", "Failed to load meal plans");
      return res.redirect("/dashboard");
    }

    const mealPlanIds = (mealPlans || []).map((mp) => mp.id);
    const counts = await getMealPlanRecipeCounts(supabaseClient, mealPlanIds);

    const mealPlansWithCounts = (mealPlans || []).map((mp) => ({
      ...mp,
      recipeCount: counts.get(mp.id) || 0,
    }));

    res.render("meal-plans/index", {
      title: "My Meal Plans",
      mealPlans: mealPlansWithCounts,
    });
  } catch (error) {
    console.error("Error in meal plans list:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/dashboard");
  }
});

// GET /meal-plans/:id/edit - Show rename/re-date form
router.get("/:id/edit", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const mealPlan = await getOwnedMealPlan(supabaseClient, id, req.user.id);

    if (!mealPlan) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    res.render("meal-plans/edit", {
      title: `Edit ${mealPlan.title}`,
      mealPlan,
    });
  } catch (error) {
    console.error("Error loading meal plan for edit:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans");
  }
});

// POST /meal-plans/:id/update - Rename and/or re-date a meal plan
router.post("/:id/update", requireAuth, mealPlanLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, startDate, endDate } = req.body;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const titleValidation = validateMealPlanTitle(title);
    if (!titleValidation.valid) {
      req.flash("error", titleValidation.error);
      return res.redirect(`/meal-plans/${id}/edit`);
    }

    const dateValidation = validateDateRange(startDate, endDate);
    if (!dateValidation.valid) {
      req.flash("error", dateValidation.error);
      return res.redirect(`/meal-plans/${id}/edit`);
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    // Belt-and-suspenders ownership check alongside RLS, matching the
    // convention in cookbookRoutes.js's/recipeRoutes.js's update handlers.
    const { data, error } = await supabaseClient
      .from("meal_plans")
      .update({
        title: titleValidation.title,
        start_date: dateValidation.startDate,
        end_date: dateValidation.endDate,
      })
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select()
      .maybeSingle();

    if (error || !data) {
      console.error("Error updating meal plan:", error);
      req.flash("error", "Failed to update meal plan. Please try again.");
      return res.redirect(`/meal-plans/${id}/edit`);
    }

    req.flash("success", "Meal plan updated!");
    res.redirect(`/meal-plans/${id}`);
  } catch (error) {
    console.error("Error in meal plan update:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans");
  }
});

/**
 * REW-69: flip a meal plan between Private and Public.
 *
 * Exported with an injectable client so the handler itself is unit testable
 * without a live Supabase, following the handleCookbookVisibilityUpdate
 * precedent in cookbookRoutes.js. Mounted below with requireAuth +
 * mealPlanLimiter.
 *
 * Public is what makes the meal plan readable at GET /m/:id; Private revokes
 * that on the very next request, because nothing caches this flag -- every
 * read re-checks it at the database layer.
 */
export async function handleMealPlanVisibilityUpdate(
  req,
  res,
  { createClient = createSupabaseClient } = {}
) {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    // Fails closed to Private on anything unexpected (missing field, array
    // from duplicated inputs, wrong case, non-string) -- a malformed or
    // forged submission can never accidentally share a meal plan.
    const isPublic = normalizeMealPlanVisibility(req.body.visibility);

    const supabaseClient = createClient(req.accessToken);

    // Belt-and-suspenders ownership check alongside RLS, matching the
    // convention in the update/delete handlers above. A missing row and a
    // row owned by somebody else are deliberately indistinguishable.
    const { data, error } = await supabaseClient
      .from("meal_plans")
      .update({ is_public: isPublic })
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select()
      .maybeSingle();

    // A real database failure and a row that simply isn't the caller's are
    // different events and must not be logged identically -- the not-found
    // path arrives with error === null. The user-facing flash is deliberately
    // the same for both, so a non-owner still cannot tell the two apart.
    if (error) {
      console.error("Error updating meal plan visibility:", error);
      req.flash("error", "Failed to update sharing. Please try again.");
      return res.redirect(`/meal-plans/${id}`);
    }

    if (!data) {
      req.flash("error", "Failed to update sharing. Please try again.");
      return res.redirect(`/meal-plans/${id}`);
    }

    req.flash(
      "success",
      isPublic
        ? "This meal plan is now Public. Anyone with the link can view it."
        : "This meal plan is now Private. Its share link no longer works."
    );
    res.redirect(`/meal-plans/${id}`);
  } catch (error) {
    console.error("Error in meal plan visibility update:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans");
  }
}

// POST /meal-plans/:id/visibility - Share or unshare a meal plan (REW-69)
router.post("/:id/visibility", requireAuth, mealPlanLimiter, (req, res) =>
  handleMealPlanVisibilityUpdate(req, res)
);

// POST /meal-plans/:id/delete - Delete a meal plan (never deletes its recipes).
// csrfProtection is re-applied at the route level (REW-105) for the reason
// spelled out on POST /recipes/:id/delete in recipeRoutes.js: the global
// csrfProtectionExceptMultipart in app.js skips token validation for any
// multipart/form-data body, and this handler reads no body fields, so a
// forged cross-site multipart POST would otherwise reach it and run the
// delete. The delete form in views/meal-plans/view.ejs posts urlencoded
// with a hidden _csrf field, so this is transparent to it.
// Ordering rule: requireAuth -> csrfProtection -> mealPlanLimiter -> handler.
// CSRF runs BEFORE mealPlanLimiter so a forged request cannot burn the
// victim's limiter quota; mealPlanDeleteRoutes.test.js enforces this.
// Do not add a Multer/body-parsing stage here: the route must keep rejecting
// multipart bodies outright.
router.post("/:id/delete", requireAuth, csrfProtection, mealPlanLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    const { error } = await supabaseClient
      .from("meal_plans")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.id);

    if (error) {
      console.error("Error deleting meal plan:", error);
      req.flash("error", "Failed to delete meal plan. Please try again.");
      return res.redirect(`/meal-plans/${id}`);
    }

    req.flash("success", "Meal plan deleted. Its recipes were not affected.");
    res.redirect("/meal-plans");
  } catch (error) {
    console.error("Error in meal plan deletion:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans");
  }
});

// GET /meal-plans/:id/add-recipes - Show recipe picker for this meal plan
router.get("/:id/add-recipes", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const mealPlan = await getOwnedMealPlan(supabaseClient, id, req.user.id);

    if (!mealPlan) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    // The bulk picker only offers the owner's own recipes (draft +
    // published), exactly like Cookbooks' bulk picker -- keeps this page
    // simple. Adding another user's published recipe to a plan is only
    // done via the per-recipe "Add to Meal Plan" modal (card or recipe
    // page), not this bulk picker. See Open Questions #3 in the REW-63
    // plan.
    const { data: recipes, error } = await supabaseClient
      .from("recipes")
      .select("id, title, status, thumbnail_url, created_at")
      .eq("user_id", req.user.id)
      .order("title", { ascending: true });

    if (error) {
      console.error("Error fetching recipes for meal plan picker:", error);
      req.flash("error", "Failed to load your recipes");
      return res.redirect(`/meal-plans/${id}`);
    }

    const { data: memberRows, error: memberError } = await supabaseClient
      .from("meal_plan_recipes")
      .select("recipe_id")
      .eq("meal_plan_id", id);

    if (memberError) {
      console.error("Error fetching meal plan membership:", memberError);
    }

    const memberRecipeIds = new Set((memberRows || []).map((row) => row.recipe_id));

    const recipesWithMembership = (recipes || []).map((recipe) => ({
      ...recipe,
      inMealPlan: memberRecipeIds.has(recipe.id),
    }));

    res.render("meal-plans/add-recipes", {
      title: `Add Recipes to ${mealPlan.title}`,
      mealPlan,
      recipes: recipesWithMembership,
    });
  } catch (error) {
    console.error("Error loading meal plan recipe picker:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans");
  }
});

// POST /meal-plans/:id/add-recipes - Bulk add selected recipes to a meal plan
router.post("/:id/add-recipes", requireAuth, mealPlanLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const mealPlan = await getOwnedMealPlan(supabaseClient, id, req.user.id);

    if (!mealPlan) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const recipeIds = normalizeRecipeIdSelection(req.body.recipeIds);

    if (!recipeIds.length) {
      req.flash("error", "Select at least one recipe to add");
      return res.redirect(`/meal-plans/${id}/add-recipes`);
    }

    // Explicit ownership check on the submitted recipe ids, belt-and-
    // suspenders alongside the RLS INSERT policy on meal_plan_recipes.
    // The bulk picker only offers the user's own recipes -- see Open
    // Questions #3 in the REW-63 plan.
    const { data: ownedRecipes, error: ownedError } = await supabaseClient
      .from("recipes")
      .select("id")
      .eq("user_id", req.user.id)
      .in("id", recipeIds);

    if (ownedError) {
      console.error("Error verifying recipe ownership:", ownedError);
      req.flash("error", "Failed to add recipes. Please try again.");
      return res.redirect(`/meal-plans/${id}/add-recipes`);
    }

    const ownedRecipeIds = (ownedRecipes || []).map((r) => r.id);

    if (!ownedRecipeIds.length) {
      req.flash("error", "None of the selected recipes could be added");
      return res.redirect(`/meal-plans/${id}/add-recipes`);
    }

    const records = ownedRecipeIds.map((recipeId) => ({
      meal_plan_id: id,
      recipe_id: recipeId,
    }));

    // Ignore duplicates so re-submitting an already-checked recipe (or a
    // race between two tabs) doesn't error on the composite primary key.
    const { error: insertError } = await supabaseClient
      .from("meal_plan_recipes")
      .upsert(records, { onConflict: "meal_plan_id,recipe_id", ignoreDuplicates: true });

    if (insertError) {
      console.error("Error adding recipes to meal plan:", insertError);
      req.flash("error", "Failed to add recipes. Please try again.");
      return res.redirect(`/meal-plans/${id}/add-recipes`);
    }

    req.flash(
      "success",
      `Added ${ownedRecipeIds.length} recipe${ownedRecipeIds.length !== 1 ? "s" : ""} to ${mealPlan.title}!`
    );
    res.redirect(`/meal-plans/${id}`);
  } catch (error) {
    console.error("Error in bulk add to meal plan:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans");
  }
});

// POST /meal-plans/:id/recipes/:recipeId/remove - Remove a recipe from a
// meal plan (used by the plan detail page). This never deletes the recipe
// itself, only its meal plan membership.
// csrfProtection is re-applied at the route level (REW-102) for the same
// reason as POST /:id/delete above: the global csrfProtectionExceptMultipart
// in app.js skips token validation for any multipart/form-data body, and this
// handler reads NO body fields at all (unlike its cookbook twin
// POST /cookbooks/:id/recipes/:recipeId/remove, which reads req.body.returnTo
// and therefore throws on an unparsed body), so a forged cross-site multipart
// POST would otherwise reach it and delete the membership row. The Remove form
// on the meal plan card (views/partials/recipe-summary-card.ejs:340) posts
// urlencoded with a hidden _csrf field, so this is transparent to it.
// Ordering rule: requireAuth -> csrfProtection -> mealPlanLimiter -> handler.
// CSRF runs BEFORE mealPlanLimiter so a forged request cannot burn the
// victim's limiter quota; mealPlanRecipeRemoveRoutes.test.js enforces this.
// Do not add a Multer/body-parsing stage here: the route must keep rejecting
// multipart bodies outright.
router.post("/:id/recipes/:recipeId/remove", requireAuth, csrfProtection, mealPlanLimiter, async (req, res) => {
  try {
    const { id, recipeId } = req.params;

    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(recipeId)) {
      req.flash("error", "Meal plan or recipe not found");
      return res.redirect("/meal-plans");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const mealPlan = await getOwnedMealPlan(supabaseClient, id, req.user.id);

    if (!mealPlan) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const { error } = await supabaseClient
      .from("meal_plan_recipes")
      .delete()
      .eq("meal_plan_id", id)
      .eq("recipe_id", recipeId);

    if (error) {
      console.error("Error removing recipe from meal plan:", error);
      req.flash("error", "Failed to remove recipe from meal plan. Please try again.");
      return res.redirect(`/meal-plans/${id}`);
    }

    req.flash("success", `Removed from ${mealPlan.title}.`);
    res.redirect(`/meal-plans/${id}`);
  } catch (error) {
    console.error("Error removing recipe from meal plan:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans");
  }
});

// GET /meal-plans/:id/grocery-list - Printable grocery list for a meal plan
// (REW-26). Read-only: nothing is persisted, so the list always reflects the
// plan and its recipes exactly as they are right now.
router.get("/:id/grocery-list", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const mealPlan = await getOwnedMealPlan(supabaseClient, id, req.user.id);

    if (!mealPlan) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const result = await getMealPlanRecipeIngredients(supabaseClient, id);

    if (!result) {
      req.flash("error", "Failed to build the grocery list. Please try again.");
      return res.redirect(`/meal-plans/${id}`);
    }

    const groceryList = buildGroceryList(result.recipes, {
      skippedCount: result.skippedCount,
    });

    res.render("meal-plans/grocery-list", {
      title: `Grocery List - ${mealPlan.title}`,
      mealPlan,
      groceryList,
    });
  } catch (error) {
    console.error("Error building meal plan grocery list:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans");
  }
});

/**
 * GET /meal-plans/:id - View a single meal plan and its recipes.
 *
 * Exported with an injectable client, following the
 * handleMealPlanVisibilityUpdate precedent above and handleCookbookView in
 * cookbookRoutes.js: the data contract the standardized REW-89 card depends on
 * (widened columns, flattened categories/tags, batched like status) is worth
 * testing without a live Supabase. Mounted below with requireAuth, unchanged.
 */
export async function handleMealPlanView(
  req,
  res,
  { createClient = createSupabaseClient } = {}
) {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const supabaseClient = createClient(req.accessToken);
    const mealPlan = await getOwnedMealPlan(supabaseClient, id, req.user.id);

    if (!mealPlan) {
      req.flash("error", "Meal plan not found");
      return res.redirect("/meal-plans");
    }

    const recipes = await getMealPlanRecipes(supabaseClient, id);

    // REW-89: the card's favorite heart needs to know which of these the
    // caller has already favorited. One batched query for the whole page
    // (the REW-55 batching pattern, same as the My Recipes and cookbook
    // handlers) rather than one per recipe, and none at all for an empty
    // plan. Stays on the request-scoped client: recipe_likes is RLS-scoped to
    // the caller, and the explicit user_id filter is belt and braces on top.
    //
    // A failure here is not worth failing the page over -- log it and let the
    // hearts render unfavorited.
    const recipeIds = recipes.map((recipe) => recipe.id);
    let likedRecipeIds = new Set();
    if (recipeIds.length) {
      const { data: likedRows, error: likesError } = await supabaseClient
        .from("recipe_likes")
        .select("recipe_id")
        .eq("user_id", req.user.id)
        .in("recipe_id", recipeIds);

      if (likesError) {
        console.error("Error fetching like status:", likesError);
      } else {
        likedRecipeIds = new Set((likedRows || []).map((row) => row.recipe_id));
      }
    }

    res.render("meal-plans/view", {
      title: mealPlan.title,
      mealPlan,
      recipes: recipes.map((recipe) => ({
        ...recipe,
        isLiked: likedRecipeIds.has(recipe.id),
      })),
      // REW-69: share-link origin comes from APP_URL/getAppUrl() only, never
      // from the request Host header -- this string exists to be copied and
      // re-shared by a human.
      appUrl: getAppUrl(),
    });
  } catch (error) {
    console.error("Error viewing meal plan:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans");
  }
}

// GET /meal-plans/:id - View a single meal plan and its recipes
router.get("/:id", requireAuth, (req, res) => handleMealPlanView(req, res));

export default router;

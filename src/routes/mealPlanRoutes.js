import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createSupabaseClient } from "../config/supabase.js";
import { validateMealPlanTitle, validateDateRange } from "../utils/mealPlanUtils.js";
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

/**
 * Fetch the recipes currently in a meal plan, most recently added first.
 */
async function getMealPlanRecipes(supabaseClient, mealPlanId) {
  const { data, error } = await supabaseClient
    .from("meal_plan_recipes")
    .select(
      "recipe_id, created_at, recipes(id, title, author, prep_time, cook_time, servings, difficulty, thumbnail_url, status, created_at)"
    )
    .eq("meal_plan_id", mealPlanId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching meal plan recipes:", error);
    return [];
  }

  // recipes(...) can be null if a row's recipe was deleted in the same
  // instant as this query (race), or if it's another user's recipe that
  // has since been unpublished -- filter defensively either way.
  return (data || [])
    .map((row) => row.recipes)
    .filter(Boolean);
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

// POST /meal-plans/:id/delete - Delete a meal plan (never deletes its recipes)
router.post("/:id/delete", requireAuth, mealPlanLimiter, async (req, res) => {
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
router.post("/:id/recipes/:recipeId/remove", requireAuth, mealPlanLimiter, async (req, res) => {
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

// GET /meal-plans/:id - View a single meal plan and its recipes
router.get("/:id", requireAuth, async (req, res) => {
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

    const recipes = await getMealPlanRecipes(supabaseClient, id);

    res.render("meal-plans/view", {
      title: mealPlan.title,
      mealPlan,
      recipes,
    });
  } catch (error) {
    console.error("Error viewing meal plan:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/meal-plans");
  }
});

export default router;

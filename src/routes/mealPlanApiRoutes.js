import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createSupabaseClient, supabase } from "../config/supabase.js";
import { validateMealPlanTitle, validateDateRange } from "../utils/mealPlanUtils.js";

const router = Router();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rate limiter for meal plan API mutations (create/add/remove). Mirrors
// likeLimiter in likeRoutes.js: keyed on the authenticated user's ID since
// every route in this file runs after requireApiAuth.
const mealPlanApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 actions per minute
  message: { error: "Too many meal plan actions. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || "anonymous",
  validate: { xForwardedForHeader: false },
});

/**
 * API-specific auth middleware that returns JSON errors instead of
 * redirecting. Duplicated from likeRoutes.js's requireApiAuth rather than
 * shared, matching this repo's existing per-route-file helper convention.
 *
 * Unlike likeRoutes.js (where GET is public), EVERY route in this file
 * requires auth -- meal plans have no public/shared read at all, so there
 * is no anonymous-GET case to support here.
 */
async function requireApiAuth(req, res, next) {
  try {
    const accessToken = req.cookies["sb-access-token"];

    if (!accessToken) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    req.user = user;
    req.accessToken = accessToken;
    next();
  } catch (error) {
    console.error("Meal plan API auth error:", error);
    res.status(500).json({ error: "Authentication error" });
  }
}

/**
 * Serialize a meal_plans row for JSON responses.
 */
function serializeMealPlan(plan) {
  return {
    id: plan.id,
    title: plan.title,
    startDate: plan.start_date,
    endDate: plan.end_date,
  };
}

/**
 * Fetch a meal plan scoped to its owner, mirroring getOwnedMealPlan in
 * mealPlanRoutes.js. Returns null if the plan doesn't exist OR belongs to
 * someone else -- callers must treat both cases identically (404, never
 * leak existence).
 */
async function getOwnedMealPlan(supabaseClient, mealPlanId, userId) {
  const { data, error } = await supabaseClient
    .from("meal_plans")
    .select("id, title")
    .eq("id", mealPlanId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching meal plan:", error);
    return null;
  }

  return data;
}

// GET /api/meal-plans?recipeId=<uuid> - list the current user's meal plans,
// optionally flagging which ones already contain the given recipe. Powers
// the shared "Add to Meal Plan" modal on open (see meal-plan-modal.ejs /
// public/js/meal-plans.js).
router.get("/", requireApiAuth, async (req, res) => {
  try {
    const { recipeId } = req.query;

    if (recipeId !== undefined && !UUID_PATTERN.test(recipeId)) {
      return res.status(400).json({ error: "Invalid recipe ID" });
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    const { data: plans, error } = await supabaseClient
      .from("meal_plans")
      .select("*")
      .eq("user_id", req.user.id)
      .order("start_date", { ascending: true });

    if (error) {
      console.error("Error fetching meal plans:", error);
      return res.status(500).json({ error: "Failed to load meal plans" });
    }

    let memberPlanIds = new Set();
    if (recipeId && plans && plans.length) {
      const { data: memberRows, error: memberError } = await supabaseClient
        .from("meal_plan_recipes")
        .select("meal_plan_id")
        .eq("recipe_id", recipeId)
        .in("meal_plan_id", plans.map((p) => p.id));

      if (memberError) {
        console.error("Error fetching meal plan membership:", memberError);
      } else {
        memberPlanIds = new Set((memberRows || []).map((row) => row.meal_plan_id));
      }
    }

    res.json({
      mealPlans: (plans || []).map((plan) => ({
        ...serializeMealPlan(plan),
        containsRecipe: memberPlanIds.has(plan.id),
      })),
    });
  } catch (error) {
    console.error("Error listing meal plans:", error);
    res.status(500).json({ error: "Failed to load meal plans" });
  }
});

// POST /api/meal-plans - quick-create a new meal plan (the modal's inline
// "+ New meal plan" mini-form)
router.post("/", requireApiAuth, mealPlanApiLimiter, async (req, res) => {
  try {
    const { title, startDate, endDate } = req.body;

    const titleValidation = validateMealPlanTitle(title);
    if (!titleValidation.valid) {
      return res.status(400).json({ error: titleValidation.error });
    }

    const dateValidation = validateDateRange(startDate, endDate);
    if (!dateValidation.valid) {
      return res.status(400).json({ error: dateValidation.error });
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    const { data, error } = await supabaseClient
      .from("meal_plans")
      .insert([
        {
          user_id: req.user.id,
          title: titleValidation.title,
          start_date: dateValidation.startDate,
          end_date: dateValidation.endDate,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Error creating meal plan:", error);
      return res.status(500).json({ error: "Failed to create meal plan" });
    }

    res.status(201).json({
      mealPlan: { ...serializeMealPlan(data), containsRecipe: false },
    });
  } catch (error) {
    console.error("Error creating meal plan:", error);
    res.status(500).json({ error: "Failed to create meal plan" });
  }
});

// POST /api/meal-plans/:id/recipes/:recipeId - add a recipe to a meal plan
router.post("/:id/recipes/:recipeId", requireApiAuth, mealPlanApiLimiter, async (req, res) => {
  try {
    const { id, recipeId } = req.params;

    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(recipeId)) {
      return res.status(400).json({ error: "Invalid meal plan or recipe ID" });
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    const mealPlan = await getOwnedMealPlan(supabaseClient, id, req.user.id);
    if (!mealPlan) {
      return res.status(404).json({ error: "Meal plan not found" });
    }

    // Explicit recipe-visibility check, belt-and-suspenders alongside the
    // RLS INSERT policy on meal_plan_recipes: the recipe must be either
    // the user's own (any status) or published by anyone. The same query,
    // scoped by the user's access token, naturally returns a row only in
    // those two cases, because of the recipes table's own RLS SELECT
    // policies (own recipes + published recipes) -- see
    // 001_create_recipes_table.sql.
    const { data: recipe, error: recipeError } = await supabaseClient
      .from("recipes")
      .select("id")
      .eq("id", recipeId)
      .maybeSingle();

    if (recipeError || !recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    const { error } = await supabaseClient
      .from("meal_plan_recipes")
      .upsert(
        [{ meal_plan_id: id, recipe_id: recipeId }],
        { onConflict: "meal_plan_id,recipe_id", ignoreDuplicates: true }
      );

    if (error) {
      console.error("Error adding recipe to meal plan:", error);
      return res.status(500).json({ error: "Failed to add recipe to meal plan" });
    }

    res.json({ added: true, mealPlanId: id, recipeId, mealPlanTitle: mealPlan.title });
  } catch (error) {
    console.error("Error adding recipe to meal plan:", error);
    res.status(500).json({ error: "Failed to add recipe to meal plan" });
  }
});

// DELETE /api/meal-plans/:id/recipes/:recipeId - remove a recipe from a
// meal plan (used by the shared modal's toggle-off action)
router.delete("/:id/recipes/:recipeId", requireApiAuth, mealPlanApiLimiter, async (req, res) => {
  try {
    const { id, recipeId } = req.params;

    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(recipeId)) {
      return res.status(400).json({ error: "Invalid meal plan or recipe ID" });
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    const mealPlan = await getOwnedMealPlan(supabaseClient, id, req.user.id);
    if (!mealPlan) {
      return res.status(404).json({ error: "Meal plan not found" });
    }

    const { error } = await supabaseClient
      .from("meal_plan_recipes")
      .delete()
      .eq("meal_plan_id", id)
      .eq("recipe_id", recipeId);

    if (error) {
      console.error("Error removing recipe from meal plan:", error);
      return res.status(500).json({ error: "Failed to remove recipe from meal plan" });
    }

    res.json({ added: false, mealPlanId: id, recipeId, mealPlanTitle: mealPlan.title });
  } catch (error) {
    console.error("Error removing recipe from meal plan:", error);
    res.status(500).json({ error: "Failed to remove recipe from meal plan" });
  }
});

export default router;

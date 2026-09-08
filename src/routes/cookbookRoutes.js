import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createSupabaseClient } from "../config/supabase.js";
import { validateCookbookTitle, normalizeRecipeIdSelection } from "../utils/cookbookUtils.js";

const router = Router();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rate limiter for cookbook mutations (create/rename/delete/add/remove
// recipe). Mirrors likeLimiter in likeRoutes.js: keyed on the authenticated
// user's ID (not IP) since these routes always run after requireAuth, to
// prevent a compromised session or script from spamming cookbook creation
// or membership churn.
const cookbookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 mutations per minute
  message: "Too many cookbook actions. Please slow down.",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || "anonymous",
  validate: { xForwardedForHeader: false },
});

/**
 * Fetch a cookbook, scoped to the given owner. Returns null if the
 * cookbook doesn't exist OR belongs to someone else -- callers must treat
 * both cases identically (flash "not found", never leak existence).
 */
async function getOwnedCookbook(supabaseClient, cookbookId, userId) {
  const { data, error } = await supabaseClient
    .from("cookbooks")
    .select("*")
    .eq("id", cookbookId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error fetching cookbook:", error);
    return null;
  }

  return data;
}

/**
 * Fetch the recipes currently in a cookbook, most recently added first.
 */
async function getCookbookRecipes(supabaseClient, cookbookId) {
  const { data, error } = await supabaseClient
    .from("cookbook_recipes")
    .select(
      "recipe_id, created_at, recipes(id, title, author, prep_time, cook_time, servings, difficulty, thumbnail_url, status, created_at)"
    )
    .eq("cookbook_id", cookbookId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching cookbook recipes:", error);
    return [];
  }

  // recipes(...) can be null if a row's recipe was deleted in the same
  // instant as this query (race) -- filter defensively.
  return (data || [])
    .map((row) => row.recipes)
    .filter(Boolean);
}

/**
 * Fetch recipe counts for a set of cookbooks in one query, to avoid an
 * N+1 pattern on the cookbook list page (same batching approach used for
 * like-status in recipeRoutes.js / recipes/liked.ejs).
 */
async function getCookbookRecipeCounts(supabaseClient, cookbookIds) {
  const counts = new Map();
  if (!cookbookIds.length) return counts;

  const { data, error } = await supabaseClient
    .from("cookbook_recipes")
    .select("cookbook_id")
    .in("cookbook_id", cookbookIds);

  if (error) {
    console.error("Error fetching cookbook recipe counts:", error);
    return counts;
  }

  for (const row of data || []) {
    counts.set(row.cookbook_id, (counts.get(row.cookbook_id) || 0) + 1);
  }

  return counts;
}

// GET /cookbooks/new - Show create-cookbook form
router.get("/new", requireAuth, (req, res) => {
  res.render("cookbooks/new", {
    title: "New Cookbook",
  });
});

// POST /cookbooks - Create a new cookbook
router.post("/", requireAuth, cookbookLimiter, async (req, res) => {
  try {
    const { title } = req.body;
    const validation = validateCookbookTitle(title);

    if (!validation.valid) {
      req.flash("error", validation.error);
      return res.redirect("/cookbooks/new");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    const { error } = await supabaseClient
      .from("cookbooks")
      .insert([{ user_id: req.user.id, title: validation.title }]);

    if (error) {
      console.error("Error creating cookbook:", error);
      req.flash("error", "Failed to create cookbook. Please try again.");
      return res.redirect("/cookbooks/new");
    }

    req.flash("success", "Cookbook created!");
    res.redirect("/cookbooks");
  } catch (error) {
    console.error("Error in cookbook creation:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/cookbooks/new");
  }
});

// GET /cookbooks - List all cookbooks for the current user
router.get("/", requireAuth, async (req, res) => {
  try {
    const supabaseClient = createSupabaseClient(req.accessToken);

    const { data: cookbooks, error } = await supabaseClient
      .from("cookbooks")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching cookbooks:", error);
      req.flash("error", "Failed to load cookbooks");
      return res.redirect("/dashboard");
    }

    const cookbookIds = (cookbooks || []).map((cb) => cb.id);
    const counts = await getCookbookRecipeCounts(supabaseClient, cookbookIds);

    const cookbooksWithCounts = (cookbooks || []).map((cb) => ({
      ...cb,
      recipeCount: counts.get(cb.id) || 0,
    }));

    res.render("cookbooks/index", {
      title: "My Cookbooks",
      cookbooks: cookbooksWithCounts,
    });
  } catch (error) {
    console.error("Error in cookbooks list:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/dashboard");
  }
});

// GET /cookbooks/:id/edit - Show rename form
router.get("/:id/edit", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const cookbook = await getOwnedCookbook(supabaseClient, id, req.user.id);

    if (!cookbook) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    res.render("cookbooks/edit", {
      title: `Rename ${cookbook.title}`,
      cookbook,
    });
  } catch (error) {
    console.error("Error loading cookbook for edit:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/cookbooks");
  }
});

// POST /cookbooks/:id/update - Rename a cookbook
router.post("/:id/update", requireAuth, cookbookLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    const validation = validateCookbookTitle(title);
    if (!validation.valid) {
      req.flash("error", validation.error);
      return res.redirect(`/cookbooks/${id}/edit`);
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    // Belt-and-suspenders ownership check alongside RLS, matching the
    // convention in recipeRoutes.js's update/delete handlers.
    const { data, error } = await supabaseClient
      .from("cookbooks")
      .update({ title: validation.title })
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select()
      .maybeSingle();

    if (error || !data) {
      console.error("Error updating cookbook:", error);
      req.flash("error", "Failed to rename cookbook. Please try again.");
      return res.redirect(`/cookbooks/${id}/edit`);
    }

    req.flash("success", "Cookbook renamed!");
    res.redirect(`/cookbooks/${id}`);
  } catch (error) {
    console.error("Error in cookbook rename:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/cookbooks");
  }
});

// POST /cookbooks/:id/delete - Delete a cookbook (never deletes its recipes)
router.post("/:id/delete", requireAuth, cookbookLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    const { error } = await supabaseClient
      .from("cookbooks")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.id);

    if (error) {
      console.error("Error deleting cookbook:", error);
      req.flash("error", "Failed to delete cookbook. Please try again.");
      return res.redirect(`/cookbooks/${id}`);
    }

    req.flash("success", "Cookbook deleted. Its recipes were not affected.");
    res.redirect("/cookbooks");
  } catch (error) {
    console.error("Error in cookbook deletion:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/cookbooks");
  }
});

// GET /cookbooks/:id/add-recipes - Show recipe picker for this cookbook
router.get("/:id/add-recipes", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const cookbook = await getOwnedCookbook(supabaseClient, id, req.user.id);

    if (!cookbook) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    // All of the user's own recipes (draft + published) are eligible --
    // cookbooks are a private organizational tool independent of publish
    // status.
    const { data: recipes, error } = await supabaseClient
      .from("recipes")
      .select("id, title, status, thumbnail_url, created_at")
      .eq("user_id", req.user.id)
      .order("title", { ascending: true });

    if (error) {
      console.error("Error fetching recipes for cookbook picker:", error);
      req.flash("error", "Failed to load your recipes");
      return res.redirect(`/cookbooks/${id}`);
    }

    const { data: memberRows, error: memberError } = await supabaseClient
      .from("cookbook_recipes")
      .select("recipe_id")
      .eq("cookbook_id", id);

    if (memberError) {
      console.error("Error fetching cookbook membership:", memberError);
    }

    const memberRecipeIds = new Set((memberRows || []).map((row) => row.recipe_id));

    const recipesWithMembership = (recipes || []).map((recipe) => ({
      ...recipe,
      inCookbook: memberRecipeIds.has(recipe.id),
    }));

    res.render("cookbooks/add-recipes", {
      title: `Add Recipes to ${cookbook.title}`,
      cookbook,
      recipes: recipesWithMembership,
    });
  } catch (error) {
    console.error("Error loading cookbook recipe picker:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/cookbooks");
  }
});

// POST /cookbooks/:id/add-recipes - Bulk add selected recipes to a cookbook
router.post("/:id/add-recipes", requireAuth, cookbookLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const cookbook = await getOwnedCookbook(supabaseClient, id, req.user.id);

    if (!cookbook) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    const recipeIds = normalizeRecipeIdSelection(req.body.recipeIds);

    if (!recipeIds.length) {
      req.flash("error", "Select at least one recipe to add");
      return res.redirect(`/cookbooks/${id}/add-recipes`);
    }

    // Explicit ownership check on the submitted recipe ids, belt-and-
    // suspenders alongside the RLS INSERT policy's own recipe-ownership
    // check on cookbook_recipes -- a user can only add their own recipes.
    const { data: ownedRecipes, error: ownedError } = await supabaseClient
      .from("recipes")
      .select("id")
      .eq("user_id", req.user.id)
      .in("id", recipeIds);

    if (ownedError) {
      console.error("Error verifying recipe ownership:", ownedError);
      req.flash("error", "Failed to add recipes. Please try again.");
      return res.redirect(`/cookbooks/${id}/add-recipes`);
    }

    const ownedRecipeIds = (ownedRecipes || []).map((r) => r.id);

    if (!ownedRecipeIds.length) {
      req.flash("error", "None of the selected recipes could be added");
      return res.redirect(`/cookbooks/${id}/add-recipes`);
    }

    const records = ownedRecipeIds.map((recipeId) => ({
      cookbook_id: id,
      recipe_id: recipeId,
    }));

    // Ignore duplicates so re-submitting an already-checked recipe (or a
    // race between two tabs) doesn't error on the composite primary key.
    const { error: insertError } = await supabaseClient
      .from("cookbook_recipes")
      .upsert(records, { onConflict: "cookbook_id,recipe_id", ignoreDuplicates: true });

    if (insertError) {
      console.error("Error adding recipes to cookbook:", insertError);
      req.flash("error", "Failed to add recipes. Please try again.");
      return res.redirect(`/cookbooks/${id}/add-recipes`);
    }

    req.flash("success", `Added ${ownedRecipeIds.length} recipe${ownedRecipeIds.length !== 1 ? "s" : ""} to ${cookbook.title}!`);
    res.redirect(`/cookbooks/${id}`);
  } catch (error) {
    console.error("Error in bulk add to cookbook:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/cookbooks");
  }
});

// POST /cookbooks/:id/recipes/:recipeId - Add a single recipe to a cookbook
// (used by the "Save to Cookbook(s)" widget on the recipe view page)
router.post("/:id/recipes/:recipeId", requireAuth, cookbookLimiter, async (req, res) => {
  try {
    const { id, recipeId } = req.params;

    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(recipeId)) {
      req.flash("error", "Cookbook or recipe not found");
      return res.redirect("/cookbooks");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const cookbook = await getOwnedCookbook(supabaseClient, id, req.user.id);

    if (!cookbook) {
      req.flash("error", "Cookbook not found");
      return res.redirect(`/recipes/${recipeId}`);
    }

    // Explicit recipe-ownership check, belt-and-suspenders alongside the
    // RLS INSERT policy on cookbook_recipes.
    const { data: recipe, error: recipeError } = await supabaseClient
      .from("recipes")
      .select("id")
      .eq("id", recipeId)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (recipeError || !recipe) {
      req.flash("error", "Recipe not found");
      return res.redirect(`/recipes/${recipeId}`);
    }

    const { error } = await supabaseClient
      .from("cookbook_recipes")
      .upsert(
        [{ cookbook_id: id, recipe_id: recipeId }],
        { onConflict: "cookbook_id,recipe_id", ignoreDuplicates: true }
      );

    if (error) {
      console.error("Error adding recipe to cookbook:", error);
      req.flash("error", "Failed to add recipe to cookbook. Please try again.");
      return res.redirect(`/recipes/${recipeId}`);
    }

    req.flash("success", `Added to ${cookbook.title}!`);
    res.redirect(`/recipes/${recipeId}`);
  } catch (error) {
    console.error("Error adding single recipe to cookbook:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect(`/recipes/${req.params.recipeId}`);
  }
});

// POST /cookbooks/:id/recipes/:recipeId/remove - Remove a recipe from a
// cookbook (used by both the cookbook detail page and the recipe view page).
// This never deletes the recipe itself, only its cookbook membership.
router.post("/:id/recipes/:recipeId/remove", requireAuth, cookbookLimiter, async (req, res) => {
  try {
    const { id, recipeId } = req.params;
    // Optional redirect target so both call sites (cookbook view, recipe
    // view) can send the user back to where they clicked "Remove" from.
    const returnTo = req.body.returnTo === "recipe" ? `/recipes/${recipeId}` : `/cookbooks/${id}`;

    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(recipeId)) {
      req.flash("error", "Cookbook or recipe not found");
      return res.redirect("/cookbooks");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const cookbook = await getOwnedCookbook(supabaseClient, id, req.user.id);

    if (!cookbook) {
      req.flash("error", "Cookbook not found");
      return res.redirect(returnTo);
    }

    const { error } = await supabaseClient
      .from("cookbook_recipes")
      .delete()
      .eq("cookbook_id", id)
      .eq("recipe_id", recipeId);

    if (error) {
      console.error("Error removing recipe from cookbook:", error);
      req.flash("error", "Failed to remove recipe from cookbook. Please try again.");
      return res.redirect(returnTo);
    }

    req.flash("success", `Removed from ${cookbook.title}.`);
    res.redirect(returnTo);
  } catch (error) {
    console.error("Error removing recipe from cookbook:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/cookbooks");
  }
});

// GET /cookbooks/:id - View a single cookbook and its recipes
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    const supabaseClient = createSupabaseClient(req.accessToken);
    const cookbook = await getOwnedCookbook(supabaseClient, id, req.user.id);

    if (!cookbook) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    const recipes = await getCookbookRecipes(supabaseClient, id);

    res.render("cookbooks/view", {
      title: cookbook.title,
      cookbook,
      recipes,
    });
  } catch (error) {
    console.error("Error viewing cookbook:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/cookbooks");
  }
});

export default router;

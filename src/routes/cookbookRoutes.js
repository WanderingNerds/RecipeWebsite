import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/authMiddleware.js";
import { csrfProtection } from "../middleware/csrfMiddleware.js";
import { createSupabaseClient } from "../config/supabase.js";
import { getAppUrl } from "../utils/authUtils.js";
import {
  validateCookbookTitle,
  normalizeRecipeIdSelection,
  normalizeCookbookVisibility,
} from "../utils/cookbookUtils.js";

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

// Columns the standardized cookbook card needs (REW-88). Mirrors
// FAVORITE_CARD_COLUMNS in index.js -- both surfaces render the same
// partial, so they must feed it the same shape -- plus the two fields the
// old lightweight cookbook card never fetched:
//
//   user_id         decides whether Edit/Delete are drawn. Presentational
//                   only, never rendered into the HTML, and never the sole
//                   authorization check: /recipes/:id/edit, /:id/update and
//                   /:id/delete each enforce ownership themselves.
//   original_author immutable "Adapted from" attribution.
//
// Body fields (instructions, notes) stay off a listing query.
const COOKBOOK_CARD_COLUMNS =
  "id, user_id, title, author, original_author, prep_time, cook_time, servings, difficulty, thumbnail_url, status, created_at, recipe_categories(categories(id, name, slug, icon)), recipe_tags(tags(id, name, slug))";

/**
 * Fetch the recipes currently in a cookbook, most recently added first.
 *
 * Exported for handler-level tests; the cookbook view handler below is the
 * only production caller.
 */
export async function getCookbookRecipes(supabaseClient, cookbookId) {
  const { data, error } = await supabaseClient
    .from("cookbook_recipes")
    .select(`recipe_id, created_at, recipes(${COOKBOOK_CARD_COLUMNS})`)
    .eq("cookbook_id", cookbookId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching cookbook recipes:", error);
    return [];
  }

  // recipes(...) can be null if a row's recipe was deleted in the same
  // instant as this query (race) -- filter defensively.
  //
  // One query, then flatten the embedded junction rows into the flat
  // categories/tags the card expects -- the same mapping GET /browse and
  // GET /recipes/liked use, and deliberately not the per-recipe fan-out
  // GET /recipes still does. The ordering above is on the junction row's
  // created_at, i.e. added-to-cookbook order, newest first.
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

/**
 * REW-19: flip a cookbook between Private and Public.
 *
 * Exported with an injectable client so the handler itself is unit testable
 * without a live Supabase, following the handleRecipeUpdate precedent in
 * recipeRoutes.js. Mounted below with requireAuth + cookbookLimiter.
 *
 * Public is what makes the cookbook readable at GET /c/:id and discoverable
 * in search; Private revokes both on the very next request, because nothing
 * caches this flag -- every read re-checks it at the database layer.
 */
export async function handleCookbookVisibilityUpdate(
  req,
  res,
  { createClient = createSupabaseClient } = {}
) {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    // Fails closed to Private on anything unexpected (missing field, array
    // from duplicated inputs, wrong case, non-string) -- a malformed or
    // forged submission can never accidentally share a cookbook.
    const isPublic = normalizeCookbookVisibility(req.body.visibility);

    const supabaseClient = createClient(req.accessToken);

    // Belt-and-suspenders ownership check alongside RLS, matching the
    // convention in the rename/delete handlers above. A missing row and a
    // row owned by somebody else are deliberately indistinguishable.
    const { data, error } = await supabaseClient
      .from("cookbooks")
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
      console.error("Error updating cookbook visibility:", error);
      req.flash("error", "Failed to update sharing. Please try again.");
      return res.redirect(`/cookbooks/${id}`);
    }

    if (!data) {
      req.flash("error", "Failed to update sharing. Please try again.");
      return res.redirect(`/cookbooks/${id}`);
    }

    req.flash(
      "success",
      isPublic
        ? "This cookbook is now Public. Anyone with the link can view it."
        : "This cookbook is now Private. Its share link no longer works."
    );
    res.redirect(`/cookbooks/${id}`);
  } catch (error) {
    console.error("Error in cookbook visibility update:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/cookbooks");
  }
}

// POST /cookbooks/:id/visibility - Share or unshare a cookbook (REW-19)
router.post("/:id/visibility", requireAuth, cookbookLimiter, (req, res) =>
  handleCookbookVisibilityUpdate(req, res)
);

// POST /cookbooks/:id/delete - Delete a cookbook (never deletes its recipes).
// csrfProtection is re-applied at the route level (REW-105) for the reason
// spelled out on POST /recipes/:id/delete in recipeRoutes.js: the global
// csrfProtectionExceptMultipart in app.js skips token validation for any
// multipart/form-data body, and this handler reads no body fields, so a
// forged cross-site multipart POST would otherwise reach it and run the
// delete. The delete form in views/cookbooks/view.ejs posts urlencoded with
// a hidden _csrf field, so this is transparent to it.
// Ordering rule: requireAuth -> csrfProtection -> cookbookLimiter -> handler.
// CSRF runs BEFORE cookbookLimiter so a forged request cannot burn the
// victim's limiter quota; cookbookDeleteRoutes.test.js enforces this.
// Do not add a Multer/body-parsing stage here: the route must keep rejecting
// multipart bodies outright.
router.post("/:id/delete", requireAuth, csrfProtection, cookbookLimiter, async (req, res) => {
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

    // Explicit ownership check on the submitted recipe ids: this bulk picker
    // is own-recipes-only, and after REW-100 it is the ONLY thing enforcing
    // that. Migration 021 widened the cookbook_recipes INSERT policy to
    // own-or-published, so RLS no longer backs this check up -- it now admits
    // strictly more than this route does. That is deliberate and safe (an
    // application check narrower than RLS always is): the picker above lists
    // only the caller's own recipes, so anything else arriving here is a
    // tampered form post and must still be dropped. Do not delete this filter
    // on the assumption that RLS covers it.
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

    // Explicit recipe-ownership check. This form route stays own-recipes-only:
    // its only entry point is the "Save to Cookbook(s)" widget inside the
    // `isOwner` branch of views/recipes/view.ejs. After REW-100 this filter is
    // the ONLY thing enforcing that -- migration 021 widened the
    // cookbook_recipes INSERT policy to own-or-published, so RLS now admits
    // strictly more than this route does. Narrower than RLS is always safe, but
    // it means the filter is load-bearing on its own. The widened rule is
    // available deliberately, via POST /api/cookbooks/:id/recipes/:recipeId.
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

/**
 * GET /cookbooks/:id - View a single cookbook and its recipes.
 *
 * Exported with an injectable client, following the
 * handleCookbookVisibilityUpdate precedent above: the data contract the
 * standardized REW-88 card depends on (widened columns, flattened
 * categories/tags, batched like status) is worth testing without a live
 * Supabase. Mounted below with requireAuth, unchanged.
 */
export async function handleCookbookView(
  req,
  res,
  { createClient = createSupabaseClient } = {}
) {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    const supabaseClient = createClient(req.accessToken);
    const cookbook = await getOwnedCookbook(supabaseClient, id, req.user.id);

    if (!cookbook) {
      req.flash("error", "Cookbook not found");
      return res.redirect("/cookbooks");
    }

    const recipes = await getCookbookRecipes(supabaseClient, id);

    // REW-88: the card's favorite heart needs to know which of these the
    // caller has already favorited. One batched query for the whole page
    // (the REW-55 batching pattern, same as the My Recipes handler) rather
    // than one per recipe, and none at all for an empty cookbook. Stays on
    // the request-scoped client: recipe_likes is RLS-scoped to the caller,
    // and the explicit user_id filter is belt and braces on top of that.
    //
    // A failure here is not worth failing the page over -- log it and let
    // the hearts render unfavorited.
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

    res.render("cookbooks/view", {
      title: cookbook.title,
      cookbook,
      recipes: recipes.map((recipe) => ({
        ...recipe,
        isLiked: likedRecipeIds.has(recipe.id),
      })),
      // Share-link origin comes from APP_URL/getAppUrl() only, never from the
      // request's Host / X-Forwarded-Host -- this string is explicitly
      // designed to be copied and re-shared by a human, so a header-derived
      // origin would be a ready-made phishing vector (see REW-57).
      appUrl: getAppUrl(),
    });
  } catch (error) {
    console.error("Error viewing cookbook:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/cookbooks");
  }
}

// GET /cookbooks/:id - View a single cookbook and its recipes
router.get("/:id", requireAuth, (req, res) => handleCookbookView(req, res));

export default router;

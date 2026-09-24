import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createSupabaseClient } from "../config/supabase.js";
import { createRequireApiAuth } from "../middleware/authMiddleware.js";
import { csrfProtection } from "../middleware/csrfMiddleware.js";
import { validateCookbookTitle } from "../utils/cookbookUtils.js";

const router = Router();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rate limiter for cookbook API mutations (create/add/remove). Mirrors
// mealPlanApiLimiter in mealPlanApiRoutes.js: keyed on the authenticated
// user's ID since every route in this file runs after requireApiAuth.
const cookbookApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 actions per minute
  message: { error: "Too many cookbook actions. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || "anonymous",
  validate: { xForwardedForHeader: false },
});

/**
 * API auth for this file. The implementation is shared from
 * middleware/authMiddleware.js (REW-86, previously copied verbatim into
 * likeRoutes.js, mealPlanApiRoutes.js and cookbookApiRoutes.js); only the
 * log label is customized here.
 *
 * Every route in this file requires auth: the "+ Cookbook" card action only
 * ever operates on the caller's OWN cookbooks -- and, as of REW-100, on
 * either the caller's own recipe (any status) or anyone's published recipe --
 * so there is no anonymous read case to support here. The public cookbook
 * read lives at GET /c/:id in publicRoutes.js and is unaffected.
 */
const requireApiAuth = createRequireApiAuth({
  logLabel: "Cookbook API auth error:",
});

/**
 * Serialize a cookbooks row for JSON responses. Deliberately narrow: the
 * modal needs an id and a title, nothing else.
 */
function serializeCookbook(cookbook) {
  return {
    id: cookbook.id,
    title: cookbook.title,
  };
}

/**
 * Fetch a cookbook scoped to its owner, mirroring getOwnedCookbook in
 * cookbookRoutes.js. Returns null if the cookbook doesn't exist OR belongs
 * to someone else -- callers must treat both cases identically (404, never
 * leak existence).
 */
async function getOwnedCookbook(supabaseClient, cookbookId, userId) {
  const { data, error } = await supabaseClient
    .from("cookbooks")
    .select("id, title")
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
 * GET /api/cookbooks?recipeId=<uuid> - list the current user's cookbooks,
 * optionally flagging which ones already contain the given recipe. Powers
 * the shared "+ Cookbook" modal on open (see cookbook-modal.ejs /
 * public/js/cookbooks.js).
 *
 * Exported with an injectable client, like handleRecipeVisibilityUpdate in
 * recipeRoutes.js, so the owner scoping can be unit tested without a live
 * Supabase.
 */
export async function handleCookbookList(
  req,
  res,
  { createClient = createSupabaseClient } = {}
) {
  try {
    const { recipeId } = req.query;

    if (recipeId !== undefined && !UUID_PATTERN.test(recipeId)) {
      return res.status(400).json({ error: "Invalid recipe ID" });
    }

    const supabaseClient = createClient(req.accessToken);

    const { data: cookbooks, error } = await supabaseClient
      .from("cookbooks")
      .select("id, title")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching cookbooks:", error);
      return res.status(500).json({ error: "Failed to load cookbooks" });
    }

    let memberCookbookIds = new Set();
    if (recipeId && cookbooks && cookbooks.length) {
      const { data: memberRows, error: memberError } = await supabaseClient
        .from("cookbook_recipes")
        .select("cookbook_id")
        .eq("recipe_id", recipeId)
        .in("cookbook_id", cookbooks.map((cb) => cb.id));

      if (memberError) {
        console.error("Error fetching cookbook membership:", memberError);
      } else {
        memberCookbookIds = new Set((memberRows || []).map((row) => row.cookbook_id));
      }
    }

    res.json({
      cookbooks: (cookbooks || []).map((cookbook) => ({
        ...serializeCookbook(cookbook),
        containsRecipe: memberCookbookIds.has(cookbook.id),
      })),
    });
  } catch (error) {
    console.error("Error listing cookbooks:", error);
    res.status(500).json({ error: "Failed to load cookbooks" });
  }
}

/**
 * POST /api/cookbooks - quick-create a new cookbook (the modal's inline
 * "+ New cookbook" mini-form), so a user with no cookbooks yet isn't stuck.
 */
export async function handleCookbookCreate(
  req,
  res,
  { createClient = createSupabaseClient } = {}
) {
  try {
    const validation = validateCookbookTitle(req.body?.title);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const supabaseClient = createClient(req.accessToken);

    const { data, error } = await supabaseClient
      .from("cookbooks")
      .insert([{ user_id: req.user.id, title: validation.title }])
      .select("id, title")
      .single();

    if (error) {
      console.error("Error creating cookbook:", error);
      return res.status(500).json({ error: "Failed to create cookbook" });
    }

    res.status(201).json({
      cookbook: { ...serializeCookbook(data), containsRecipe: false },
    });
  } catch (error) {
    console.error("Error creating cookbook:", error);
    res.status(500).json({ error: "Failed to create cookbook" });
  }
}

/**
 * POST /api/cookbooks/:id/recipes/:recipeId - add a recipe to a cookbook.
 * The cookbook must be the caller's. The recipe must be either the caller's
 * own (any status) or published by anyone (REW-100) -- deliberately wider
 * than the two form-based routes in cookbookRoutes.js, which stay
 * own-recipes-only because their only UI entry points are owner-gated.
 */
export async function handleCookbookRecipeAdd(
  req,
  res,
  { createClient = createSupabaseClient } = {}
) {
  try {
    const { id, recipeId } = req.params;

    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(recipeId)) {
      return res.status(400).json({ error: "Invalid cookbook or recipe ID" });
    }

    const supabaseClient = createClient(req.accessToken);

    const cookbook = await getOwnedCookbook(supabaseClient, id, req.user.id);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found" });
    }

    // REW-100: the recipe rule is own-or-published -- the caller's own recipe
    // at any status, or anyone's status = 'published' recipe. Migration 021
    // widens the cookbook_recipes INSERT policy to match, using the same shape
    // 012 already uses for meal_plan_recipes.
    //
    // The predicate is written out in JavaScript on purpose, rather than
    // delegating to the `recipes` SELECT policy the way mealPlanApiRoutes.js
    // does: the whole point of this lookup is to be an independent second
    // layer, and an explicit check keeps rejecting non-owned drafts even if a
    // future migration ever widens recipe visibility. Two columns are selected
    // because they are exactly what the decision needs.
    //
    // Every reject path below -- lookup error, no row, another user's draft --
    // returns the identical generic 404 and writes nothing, so the endpoint
    // cannot be used to probe whether a recipe id exists.
    const { data: recipe, error: recipeError } = await supabaseClient
      .from("recipes")
      .select("id, user_id, status")
      .eq("id", recipeId)
      .maybeSingle();

    if (recipeError || !recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // The ownership half is type-guarded the way the card partial guards its
    // own isOwner: a row with a missing/non-string user_id is treated as NOT
    // owned rather than compared loosely. Identical behavior for real rows --
    // this only closes a hypothetical sparse-row comparison.
    const recipeIsAddable =
      (typeof recipe.user_id === "string" && recipe.user_id === req.user.id) ||
      recipe.status === "published";
    if (!recipeIsAddable) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Ignore duplicates so clicking "Add" twice (or a race between tabs) is a
    // no-op instead of a composite-primary-key error.
    const { error } = await supabaseClient
      .from("cookbook_recipes")
      .upsert(
        [{ cookbook_id: id, recipe_id: recipeId }],
        { onConflict: "cookbook_id,recipe_id", ignoreDuplicates: true }
      );

    if (error) {
      console.error("Error adding recipe to cookbook:", error);
      return res.status(500).json({ error: "Failed to add recipe to cookbook" });
    }

    res.json({ added: true, cookbookId: id, recipeId, cookbookTitle: cookbook.title });
  } catch (error) {
    console.error("Error adding recipe to cookbook:", error);
    res.status(500).json({ error: "Failed to add recipe to cookbook" });
  }
}

/**
 * DELETE /api/cookbooks/:id/recipes/:recipeId - remove a recipe from a
 * cookbook (the modal's toggle-off action). Never deletes the recipe itself,
 * only its cookbook membership -- same contract as the form-based
 * POST /cookbooks/:id/recipes/:recipeId/remove.
 */
export async function handleCookbookRecipeRemove(
  req,
  res,
  { createClient = createSupabaseClient } = {}
) {
  try {
    const { id, recipeId } = req.params;

    if (!UUID_PATTERN.test(id) || !UUID_PATTERN.test(recipeId)) {
      return res.status(400).json({ error: "Invalid cookbook or recipe ID" });
    }

    const supabaseClient = createClient(req.accessToken);

    const cookbook = await getOwnedCookbook(supabaseClient, id, req.user.id);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found" });
    }

    const { error } = await supabaseClient
      .from("cookbook_recipes")
      .delete()
      .eq("cookbook_id", id)
      .eq("recipe_id", recipeId);

    if (error) {
      console.error("Error removing recipe from cookbook:", error);
      return res.status(500).json({ error: "Failed to remove recipe from cookbook" });
    }

    res.json({ added: false, cookbookId: id, recipeId, cookbookTitle: cookbook.title });
  } catch (error) {
    console.error("Error removing recipe from cookbook:", error);
    res.status(500).json({ error: "Failed to remove recipe from cookbook" });
  }
}

router.get("/", requireApiAuth, (req, res) => handleCookbookList(req, res));

// Every mutation below re-applies csrfProtection at the route level rather
// than relying on the global csrfProtectionExceptMultipart in app.js: that
// wrapper skips token validation for any multipart/form-data body, so a
// forged cross-site multipart POST would otherwise reach these handlers
// unchecked. Same precedent as POST /recipes/:id/clone. The browser client
// already sends x-csrf-token on every state-changing fetch (main.js).
//
// Order matters: csrfProtection runs before the rate limiter so that a forged
// cross-site request is rejected without consuming any of the victim's
// limiter quota (which would otherwise let an attacker lock them out).
router.post("/", requireApiAuth, csrfProtection, cookbookApiLimiter, (req, res) =>
  handleCookbookCreate(req, res)
);

router.post(
  "/:id/recipes/:recipeId",
  requireApiAuth,
  csrfProtection,
  cookbookApiLimiter,
  (req, res) => handleCookbookRecipeAdd(req, res)
);

router.delete(
  "/:id/recipes/:recipeId",
  requireApiAuth,
  csrfProtection,
  cookbookApiLimiter,
  (req, res) => handleCookbookRecipeRemove(req, res)
);

export default router;

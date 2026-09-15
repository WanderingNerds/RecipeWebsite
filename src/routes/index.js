import { Router } from "express";
import authRoutes from "./authRoutes.js";
import recipeRoutes from "./recipeRoutes.js";
import cookbookRoutes from "./cookbookRoutes.js";
import mealPlanRoutes from "./mealPlanRoutes.js";
import mealPlanApiRoutes from "./mealPlanApiRoutes.js";
import cookbookApiRoutes from "./cookbookApiRoutes.js";
import importRoutes from "./importRoutes.js";
import categoryRoutes from "./categoryRoutes.js";
import tagRoutes from "./tagRoutes.js";
import publicRoutes from "./publicRoutes.js";
import likeRoutes from "./likeRoutes.js";
import helpFeedbackRoutes from "./helpFeedbackRoutes.js";
import adminAuthRoutes from "./adminAuthRoutes.js";
import adminFeedbackRoutes from "./adminFeedbackRoutes.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createSupabaseClient, supabase } from "../config/supabase.js";
import { getEmailLinkForwardPath } from "../utils/authUtils.js";

const router = Router();

// Home page
//
// Guard against misdirected email links (REW-57): if a password-reset or
// email-confirmation link's redirect_to wasn't allow-listed in Supabase, or
// the email template links straight to the Site URL, the browser can land
// here carrying ?token_hash=...&type=... instead of on /auth/reset-password
// or /auth/callback. Forward those requests to the correct handler instead
// of silently rendering Home (the reported bug) or ignoring the token.
//
// getEmailLinkForwardPath only ever returns one of two fixed internal
// paths carrying a whitelisted token_hash/type pair -- this can never
// become an open redirect.
router.get("/", (req, res) => {
  const forwardPath = getEmailLinkForwardPath(req.query);
  if (forwardPath) {
    return res.redirect(302, forwardPath);
  }

  res.render("home", {
    title: "Recipe Website",
    isHomePage: true,
  });
});

// Public search and browse (no login required)
router.use("/", publicRoutes);

// Auth routes
router.use("/auth", authRoutes);
router.use("/admin", adminAuthRoutes);
router.use("/admin/feedback", adminFeedbackRoutes);

// Import routes (must be BEFORE /recipes to prevent /:id matching "import")
router.use("/recipes/import", importRoutes);

// Columns the standardized My Favorites card needs (REW-87). Mirrors
// CARD_COLUMNS in publicRoutes.js -- the Browse card reads the same shape --
// plus two fields only the favorites surface uses:
//
//   user_id         decides whether Edit/Delete are drawn. Presentational
//                   only, never rendered into the HTML, and never the sole
//                   authorization check: /recipes/:id/edit, /:id/update and
//                   /:id/delete each enforce ownership themselves.
//   original_author immutable "Adapted from" attribution, shown on both
//                   detail views and therefore on this card too.
//
// Body fields (instructions, notes) stay off a listing query.
const FAVORITE_CARD_COLUMNS =
  "id, user_id, title, status, author, original_author, prep_time, cook_time, servings, difficulty, thumbnail_url, created_at, recipe_categories(categories(id, name, slug, icon)), recipe_tags(tags(id, name, slug))";

/**
 * GET /recipes/liked - "My Favorites".
 *
 * Exported for handler-level tests; the route below is the only production
 * caller. `createClient` is injectable for the same reason.
 */
export async function handleLikedRecipes(
  req,
  res,
  { createClient = createSupabaseClient, publicClient = supabase } = {}
) {
  try {
    const supabaseClient = createClient(req.accessToken);

    // Which recipes this user has favorited, newest favorite first. Stays on
    // the request-scoped client: recipe_likes is RLS-scoped to the caller.
    const { data: likes, error: likesError } = await supabaseClient
      .from("recipe_likes")
      .select("recipe_id, created_at")
      .order("created_at", { ascending: false });

    if (likesError) {
      console.error("Error fetching liked recipes:", likesError);
      req.flash("error", "Failed to load favorites");
      return res.redirect("/dashboard");
    }

    if (!likes || likes.length === 0) {
      return res.render("recipes/liked", {
        title: "My Favorites",
        recipes: [],
      });
    }

    // The recipe rows themselves come from the anon client, exactly as Browse
    // does: these are other people's recipes and RLS must limit the read to
    // published ones. The .eq("status", "published") filter is belt and
    // braces on top of that -- a favorite whose owner later flips it Private
    // must disappear from this page rather than leak.
    const recipeIds = likes.map((l) => l.recipe_id);
    const { data: recipes, error: recipesError } = await publicClient
      .from("recipes")
      .select(FAVORITE_CARD_COLUMNS)
      .in("id", recipeIds)
      .eq("status", "published");

    if (recipesError) {
      console.error("Error fetching recipe details:", recipesError);
      req.flash("error", "Failed to load recipe details");
      return res.redirect("/dashboard");
    }

    // One query, then flatten the embedded junction rows into the flat
    // categories/tags the card expects -- same mapping as GET /browse, and
    // deliberately not the per-recipe fan-out GET /recipes still uses.
    //
    // isLiked is stamped rather than queried: by construction every recipe
    // reachable from this list is one the caller has favorited.
    const recipeMap = new Map(
      (recipes ?? []).map(({ recipe_categories, recipe_tags, ...recipe }) => [
        recipe.id,
        {
          ...recipe,
          categories: (recipe_categories ?? []).map(link => link?.categories).filter(Boolean),
          tags: (recipe_tags ?? []).map(link => link?.tags).filter(Boolean),
          isLiked: true,
        },
      ])
    );

    // Sort recipes by the order they were liked (most recent first)
    const sortedRecipes = likes
      .map((l) => recipeMap.get(l.recipe_id))
      .filter(Boolean);

    res.render("recipes/liked", {
      title: "My Favorites",
      recipes: sortedRecipes,
    });
  } catch (error) {
    console.error("Error loading favorites page:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/dashboard");
  }
}

// Favorites page (must be BEFORE /recipes to prevent /:id matching "liked").
// The URL stays /recipes/liked: the dashboard card, the navbar and any
// bookmark point at it. Only the wording changed (REW-66 terminology).
router.get("/recipes/liked", requireAuth, (req, res) => handleLikedRecipes(req, res));

// Recipe routes
router.use("/recipes", recipeRoutes);

// Cookbook routes (REW-62)
router.use("/cookbooks", cookbookRoutes);

// Meal plan routes (REW-63)
router.use("/meal-plans", mealPlanRoutes);

// Authenticated Help & Feedback intake (REW-70)
router.use("/help-feedback", helpFeedbackRoutes);

// API routes for categories, tags, likes, meal plans, and cookbooks
router.use("/api/categories", categoryRoutes);
router.use("/api/tags", tagRoutes);
router.use("/api/likes", likeRoutes);
router.use("/api/meal-plans", mealPlanApiRoutes);
router.use("/api/cookbooks", cookbookApiRoutes);

// Protected dashboard (example)
router.get("/dashboard", requireAuth, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
  });
});

export default router;

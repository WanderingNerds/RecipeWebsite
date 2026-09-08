import { Router } from "express";
import { supabase, createSupabaseClient } from "../config/supabase.js";

const router = Router();

/**
 * Helper to get like count for a recipe
 */
async function getLikeCount(recipeId) {
  const { data, error } = await supabase.rpc("get_recipe_like_count", {
    p_recipe_id: recipeId,
  });

  if (error) {
    console.error("Error getting like count:", error);
    return 0;
  }

  return data || 0;
}

/**
 * Helper to check if user has liked a recipe
 */
async function hasUserLiked(supabaseClient, recipeId) {
  const { data, error } = await supabaseClient
    .from("recipe_likes")
    .select("user_id")
    .eq("recipe_id", recipeId)
    .maybeSingle();

  if (error) {
    console.error("Error checking like status:", error);
    return false;
  }

  return !!data;
}

// Every route here is public. We deliberately use the anon-key client rather than
// createSupabaseClient(req.accessToken) so results are identical whether or not the
// visitor is signed in — RLS then limits reads to published recipes.

const PAGE_SIZE = 12;
const MAX_QUERY_LENGTH = 100;

// Columns safe to expose on a listing. Body fields (instructions, notes) are
// only loaded on the detail page.
const CARD_COLUMNS =
  "id, title, status, author, prep_time, cook_time, servings, difficulty, thumbnail_url, created_at, recipe_categories(categories(id, name, slug, icon)), recipe_tags(tags(id, name, slug))";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function renderNotFound(res, message) {
  return res.status(404).render("error", {
    title: "Not Found",
    message,
    error: { status: 404 },
  });
}

// GET /search - Search all published recipes
router.get("/search", async (req, res, next) => {
  try {
    const query = String(req.query.q ?? "").trim().slice(0, MAX_QUERY_LENGTH);
    const page = parsePage(req.query.page);

    // Empty query renders the prompt state rather than every recipe
    if (!query) {
      return res.render("recipes/search", {
        title: "Search Recipes",
        query: "",
        recipes: [],
        page: 1,
        totalPages: 0,
        totalCount: 0,
      });
    }

    const { data, error } = await supabase.rpc("search_recipes", {
      search_query: query,
      result_limit: PAGE_SIZE,
      result_offset: (page - 1) * PAGE_SIZE,
    });

    if (error) {
      console.error("Error searching recipes:", error);
      req.flash("error", "Search is unavailable right now. Please try again.");
      return res.redirect("/browse");
    }

    const recipes = data ?? [];
    // The window function returns the same total on every row
    const totalCount = recipes.length > 0 ? Number(recipes[0].total_count) : 0;

    res.render("recipes/search", {
      title: `Search: ${query}`,
      query,
      recipes,
      page,
      totalPages: Math.ceil(totalCount / PAGE_SIZE),
      totalCount,
    });
  } catch (error) {
    next(error);
  }
});

// GET /browse - All published recipes, newest first
router.get("/browse", async (req, res, next) => {
  try {
    const page = parsePage(req.query.page);
    const from = (page - 1) * PAGE_SIZE;

    const { data, error, count } = await supabase
      .from("recipes")
      .select(CARD_COLUMNS, { count: "exact" })
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("Error browsing recipes:", error);
      req.flash("error", "Unable to load recipes right now. Please try again.");
      return res.redirect("/");
    }

    const totalCount = count ?? 0;

    res.render("recipes/browse", {
      title: "Browse Recipes",
      recipes: (data ?? []).map(({ recipe_categories, recipe_tags, ...recipe }) => ({
        ...recipe,
        categories: (recipe_categories ?? []).map(link => link?.categories).filter(Boolean),
        tags: (recipe_tags ?? []).map(link => link?.tags).filter(Boolean),
      })),
      page,
      totalPages: Math.ceil(totalCount / PAGE_SIZE),
      totalCount,
    });
  } catch (error) {
    next(error);
  }
});

// GET /r/:id - Public read-only view of a published recipe
router.get("/r/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Postgres rejects a malformed uuid outright, so screen it here
    if (!UUID_PATTERN.test(id)) {
      return renderNotFound(res, "That recipe doesn't exist.");
    }

    const { data: recipe, error } = await supabase
      .from("recipes")
      .select("*")
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle();

    if (error) {
      console.error("Error loading public recipe:", error);
      return next(error);
    }

    // Drafts and missing rows are indistinguishable from here, which is intended
    if (!recipe) {
      return renderNotFound(
        res,
        "That recipe doesn't exist or hasn't been published."
      );
    }

    // Get like count
    const likeCount = await getLikeCount(id);

    // Check if user has liked (if authenticated)
    let isLiked = false;
    if (req.user && req.cookies["sb-access-token"]) {
      const supabaseClient = createSupabaseClient(req.cookies["sb-access-token"]);
      isLiked = await hasUserLiked(supabaseClient, id);
    }

    res.render("recipes/public-view", {
      title: recipe.title,
      recipe,
      isOwner: req.user?.id === recipe.user_id,
      likeCount,
      isLiked,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

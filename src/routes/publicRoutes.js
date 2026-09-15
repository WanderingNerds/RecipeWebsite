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
// Cookbooks are a secondary result surface on a recipe site: a small capped
// section, not a paginated one. Recipes keep full pagination.
const COOKBOOK_RESULT_LIMIT = 5;

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
        cookbooks: [],
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

    // REW-19: Public cookbooks are a bonus discovery surface. Reuse the same
    // already-trimmed/capped `query` rather than re-reading req.query.q.
    //
    // The section is a single capped set shown once, on the first page of
    // recipe results -- it is not paginated alongside the recipe grid. Paging
    // deeper into recipes would otherwise re-run the same offset-0 query and
    // repeat the identical five cookbooks on every page, so skip the RPC
    // entirely past page 1.
    //
    // Degrade silently on failure -- a cookbook-search outage must not take
    // recipe search down with it, so no flash/redirect here.
    let cookbooks = [];

    if (page === 1) {
      const { data: cookbookData, error: cookbookError } = await supabase.rpc(
        "search_cookbooks",
        {
          search_query: query,
          result_limit: COOKBOOK_RESULT_LIMIT,
          result_offset: 0,
        }
      );

      if (cookbookError) {
        console.error("Error searching cookbooks:", cookbookError);
      } else {
        cookbooks = cookbookData ?? [];
      }
    }

    res.render("recipes/search", {
      title: `Search: ${query}`,
      query,
      recipes,
      cookbooks,
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

/**
 * REW-19: fetch the recipes in a Public cookbook for an anonymous visitor.
 *
 * Deliberately NOT a reuse of getCookbookRecipes() in cookbookRoutes.js --
 * that helper is module-private and takes an owner-scoped client. This one
 * always runs on the module-level anon `supabase` client, where auth.uid()
 * is null, so the recipes SELECT policy from migration 001 returns published
 * rows only. That is the actual guarantee that a draft recipe sitting in a
 * Public cookbook never reaches a visitor -- including the owner viewing
 * their own share link.
 *
 * The !inner embed drops membership rows whose recipe is RLS-invisible
 * instead of returning them with a null recipe, and the explicit status
 * predicate is defence in depth on top of RLS, mirroring GET /r/:id.
 */
async function getPublicCookbookRecipes(cookbookId) {
  const { data, error } = await supabase
    .from("cookbook_recipes")
    .select(
      "created_at, recipes!inner(id, title, author, prep_time, cook_time, servings, difficulty, thumbnail_url, created_at)"
    )
    .eq("cookbook_id", cookbookId)
    .eq("recipes.status", "published")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading public cookbook recipes:", error);
    return [];
  }

  // Defensive: a recipe deleted in the same instant as this query could still
  // yield a null embed, same race getCookbookRecipes() guards against.
  return (data || []).map((row) => row.recipes).filter(Boolean);
}

// GET /c/:id - Public read-only view of a shared cookbook (REW-19)
router.get("/c/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Postgres rejects a malformed uuid outright, so screen it here
    if (!UUID_PATTERN.test(id)) {
      return renderNotFound(res, "That cookbook doesn't exist or isn't shared.");
    }

    const { data: cookbook, error } = await supabase
      .from("cookbooks")
      .select("id, title, created_at")
      .eq("id", id)
      .eq("is_public", true)
      .maybeSingle();

    if (error) {
      console.error("Error loading public cookbook:", error);
      return next(error);
    }

    // A Private cookbook and a nonexistent one must be indistinguishable from
    // out here: same status, same message, same template, no extra query on
    // either branch.
    if (!cookbook) {
      return renderNotFound(res, "That cookbook doesn't exist or isn't shared.");
    }

    const recipes = await getPublicCookbookRecipes(id);

    // No owner-scoped client is ever constructed in this handler, and the page
    // is unconditionally read-only -- there is no isOwner branch to get wrong.
    res.render("cookbooks/public-view", {
      title: cookbook.title,
      cookbook,
      recipes,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * REW-69: fetch the recipes in a Public meal plan for an anonymous visitor.
 *
 * Deliberately NOT a reuse of getMealPlanRecipes() in mealPlanRoutes.js --
 * that helper is module-private, takes an owner-scoped client, and selects
 * `status`, which this page has no use for. This one always runs on the
 * module-level anon `supabase` client, where auth.uid() is null, so the
 * recipes SELECT policy from migration 001 returns published rows only. That
 * is the actual guarantee that a Private recipe sitting in a Public meal plan
 * never reaches a visitor -- including the owner viewing their own share link.
 *
 * The !inner embed drops membership rows whose recipe is RLS-invisible instead
 * of returning them with a null recipe, and the explicit status predicate is
 * defence in depth on top of RLS, mirroring GET /r/:id and GET /c/:id.
 *
 * Ordered by the junction row's created_at descending, matching the owner
 * view's ordering in getMealPlanRecipes().
 */
async function getPublicMealPlanRecipes(mealPlanId) {
  const { data, error } = await supabase
    .from("meal_plan_recipes")
    .select(
      "created_at, recipes!inner(id, title, author, prep_time, cook_time, servings, difficulty, thumbnail_url, created_at)"
    )
    .eq("meal_plan_id", mealPlanId)
    .eq("recipes.status", "published")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading public meal plan recipes:", error);
    return [];
  }

  // Defensive: a recipe deleted in the same instant as this query could still
  // yield a null embed, same race getMealPlanRecipes() guards against.
  return (data || []).map((row) => row.recipes).filter(Boolean);
}

// GET /m/:id - Public read-only view of a shared meal plan (REW-69)
router.get("/m/:id", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Postgres rejects a malformed uuid outright, so screen it here
    if (!UUID_PATTERN.test(id)) {
      return renderNotFound(res, "That meal plan doesn't exist or isn't shared.");
    }

    // Only the columns the template needs -- user_id has no business being
    // handed to a public page.
    const { data: mealPlan, error } = await supabase
      .from("meal_plans")
      .select("id, title, start_date, end_date")
      .eq("id", id)
      .eq("is_public", true)
      .maybeSingle();

    if (error) {
      console.error("Error loading public meal plan:", error);
      return next(error);
    }

    // A Private meal plan and a nonexistent one must be indistinguishable from
    // out here: same status, same message, same template, no extra query on
    // either branch that could be timed.
    if (!mealPlan) {
      return renderNotFound(res, "That meal plan doesn't exist or isn't shared.");
    }

    const recipes = await getPublicMealPlanRecipes(id);

    // No owner-scoped client is ever constructed in this handler, and the page
    // is unconditionally read-only -- there is no isOwner branch to get wrong.
    res.render("meal-plans/public-view", {
      title: mealPlan.title,
      mealPlan,
      recipes,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

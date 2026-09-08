import { Router } from "express";
import authRoutes from "./authRoutes.js";
import recipeRoutes from "./recipeRoutes.js";
import cookbookRoutes from "./cookbookRoutes.js";
import importRoutes from "./importRoutes.js";
import categoryRoutes from "./categoryRoutes.js";
import tagRoutes from "./tagRoutes.js";
import publicRoutes from "./publicRoutes.js";
import likeRoutes from "./likeRoutes.js";
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

// Import routes (must be BEFORE /recipes to prevent /:id matching "import")
router.use("/recipes/import", importRoutes);

// Liked recipes page (must be BEFORE /recipes to prevent /:id matching "liked")
router.get("/recipes/liked", requireAuth, async (req, res) => {
  try {
    const supabaseClient = createSupabaseClient(req.accessToken);

    // Fetch user's liked recipes with recipe details
    const { data: likes, error: likesError } = await supabaseClient
      .from("recipe_likes")
      .select("recipe_id, created_at")
      .order("created_at", { ascending: false });

    if (likesError) {
      console.error("Error fetching liked recipes:", likesError);
      req.flash("error", "Failed to load liked recipes");
      return res.redirect("/dashboard");
    }

    if (!likes || likes.length === 0) {
      return res.render("recipes/liked", {
        title: "Liked Recipes",
        recipes: [],
      });
    }

    // Fetch the actual recipe data for liked recipes
    const recipeIds = likes.map((l) => l.recipe_id);
    const { data: recipes, error: recipesError } = await supabase
      .from("recipes")
      .select("id, title, author, prep_time, cook_time, servings, difficulty, thumbnail_url, created_at")
      .in("id", recipeIds)
      .eq("status", "published");

    if (recipesError) {
      console.error("Error fetching recipe details:", recipesError);
      req.flash("error", "Failed to load recipe details");
      return res.redirect("/dashboard");
    }

    // Sort recipes by the order they were liked (most recent first)
    const recipeMap = new Map(recipes?.map((r) => [r.id, r]) || []);
    const sortedRecipes = likes
      .map((l) => recipeMap.get(l.recipe_id))
      .filter(Boolean);

    res.render("recipes/liked", {
      title: "Liked Recipes",
      recipes: sortedRecipes,
    });
  } catch (error) {
    console.error("Error loading liked recipes page:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/dashboard");
  }
});

// Recipe routes
router.use("/recipes", recipeRoutes);

// Cookbook routes (REW-62)
router.use("/cookbooks", cookbookRoutes);

// API routes for categories, tags, and likes
router.use("/api/categories", categoryRoutes);
router.use("/api/tags", tagRoutes);
router.use("/api/likes", likeRoutes);

// Protected dashboard (example)
router.get("/dashboard", requireAuth, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
  });
});

export default router;

import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createSupabaseClient, supabase } from "../config/supabase.js";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { generateThumbnail, optimizeImage, validateImageFile } from "../utils/imageUtils.js";
import { parseIngredients } from "../utils/ingredientParser.js";
import { resolveScaling, scaleIngredients, QUICK_SCALE_FACTORS } from "../utils/ingredientScaler.js";
import { getAccountDisplayName } from "../utils/userUtils.js";
import { csrfProtection } from "../middleware/csrfMiddleware.js";
import { assignRecipeToMealPlan } from "../utils/mealPlanAssignment.js";
import { normalizeRecipeVisibility } from "../utils/recipeVisibility.js";

const router = Router();

// Rate limiter specifically for file uploads
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit to 10 uploads per 15 minutes
  message: 'Too many file uploads. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const addRecipeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many recipes added. Please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Max recipe photo upload size: 4MB. Deliberately below Vercel's 4.5MB
// request-body cap (VERCEL_MAX_REQUEST_BODY_BYTES) so an oversize photo is
// rejected by this app - with a flashed message on the form - instead of by the
// platform's opaque FUNCTION_PAYLOAD_TOO_LARGE page, which never reaches our
// code. The remaining headroom under the cap covers multipart framing, the
// other form fields, and headers, all of which count toward the platform's
// measurement of the body.
// Matches MAX_IMPORT_FILE_SIZE_BYTES so there is one number to remember.
export const MAX_RECIPE_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;

// Human-readable form of the photo cap, derived from the byte constant so a
// future limit change cannot leave stale copy behind.
export const MAX_RECIPE_IMAGE_SIZE_LABEL = `${MAX_RECIPE_IMAGE_SIZE_BYTES / (1024 * 1024)}MB`;

export const RECIPE_IMAGE_TOO_LARGE_MESSAGE = `Photo must be under ${MAX_RECIPE_IMAGE_SIZE_LABEL}`;
export const RECIPE_IMAGE_NOT_AN_IMAGE_MESSAGE =
  "Only image files are allowed. Please choose a JPEG, PNG, GIF, or WebP photo.";
export const RECIPE_IMAGE_INVALID_UPLOAD_MESSAGE =
  "Invalid upload. Please select a single photo and try again.";

// Configure multer to store files in memory
const storage = multer.memoryStorage();
export const imageUpload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_RECIPE_IMAGE_SIZE_BYTES,
  },
  fileFilter: (req, file, cb) => {
    // Only accept image files. Note this is the client-supplied mimetype and is
    // a convenience filter only - validateImageFile's magic-byte sniff in the
    // handlers below is the real gate.
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      const error = new Error(RECIPE_IMAGE_NOT_AN_IMAGE_MESSAGE);
      error.code = "UNSUPPORTED_FILE_TYPE";
      cb(error);
    }
  },
});

/**
 * Error handler for the multer stage of the two recipe photo upload routes.
 *
 * Without this, a rejection (oversize file, unexpected field, non-image
 * mimetype) falls through to the global errorHandler, which renders a generic
 * 500 "Something went wrong" page and discards everything the user typed into
 * the form. Mirrors handleImportUploadError in src/routes/importRoutes.js, but
 * HTML-shaped: these routes are ordinary form posts, so the answer is a flash
 * plus a redirect back to the form rather than JSON.
 *
 * This runs before route-level csrfProtection (which must run after multer, as
 * it needs the parsed _csrf body field). That is safe and intentional: the
 * request is already past requireAuth, and this handler performs no state
 * change - it only flashes a fixed string and redirects to a path it derives
 * itself. req.params.id is gated on UUID_PATTERN before it can shape the
 * Location header.
 */
export function handleRecipeImageUploadError(err, req, res, next) {
  const rawId = req?.params?.id;
  const redirectTo = rawId
    ? (UUID_PATTERN.test(rawId) ? `/recipes/${rawId}/edit` : "/recipes")
    : "/recipes/new";

  const flashAndRedirect = (message) => {
    if (typeof req?.flash === "function") {
      req.flash("error", message);
    }
    // Multer aborts as soon as the limit trips, but the client may still be
    // sending the rest of the body. Unpipe multer's busboy and drain the
    // remainder so the response is not written into a half-read request, which
    // on a host that does not buffer the upload surfaces to the user as a
    // connection reset instead of the flashed message below.
    if (typeof req?.unpipe === "function") req.unpipe();
    if (typeof req?.resume === "function") req.resume();
    return res.redirect(redirectTo);
  };

  if (err instanceof multer.MulterError) {
    return flashAndRedirect(
      err.code === "LIMIT_FILE_SIZE"
        ? RECIPE_IMAGE_TOO_LARGE_MESSAGE
        : RECIPE_IMAGE_INVALID_UPLOAD_MESSAGE
    );
  }

  if (err && err.code === "UNSUPPORTED_FILE_TYPE") {
    return flashAndRedirect(RECIPE_IMAGE_NOT_AN_IMAGE_MESSAGE);
  }

  return next(err);
}

/**
 * Generate a URL-friendly slug from a string
 */
function generateSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Helper to save recipe categories
 */
async function saveRecipeCategories(supabaseClient, recipeId, categoryIds) {
  if (!categoryIds || !categoryIds.length) return;

  // Ensure categoryIds is an array
  const ids = Array.isArray(categoryIds) ? categoryIds : [categoryIds];

  // Delete existing categories
  await supabaseClient
    .from("recipe_categories")
    .delete()
    .eq("recipe_id", recipeId);

  // Insert new categories
  const categoryRecords = ids.map(categoryId => ({
    recipe_id: recipeId,
    category_id: categoryId
  }));

  await supabaseClient
    .from("recipe_categories")
    .insert(categoryRecords);
}

/**
 * Helper to save recipe tags (creates new tags if needed)
 */
async function saveRecipeTags(supabaseClient, recipeId, userId, tagNames) {
  if (!tagNames || !tagNames.length) return;

  // Ensure tagNames is an array and filter empty values
  const names = (Array.isArray(tagNames) ? tagNames : [tagNames])
    .map(name => name.trim())
    .filter(name => name);

  if (!names.length) return;

  // Delete existing tags for this recipe
  await supabaseClient
    .from("recipe_tags")
    .delete()
    .eq("recipe_id", recipeId);

  // Get or create tags
  const tagIds = [];
  for (const name of names) {
    const slug = generateSlug(name);
    if (!slug) continue;

    // Try to find existing tag
    let { data: existingTag } = await supabaseClient
      .from("tags")
      .select("id")
      .eq("user_id", userId)
      .eq("slug", slug)
      .single();

    if (existingTag) {
      tagIds.push(existingTag.id);
    } else {
      // Create new tag
      const { data: newTag } = await supabaseClient
        .from("tags")
        .insert([{ name, slug, user_id: userId }])
        .select("id")
        .single();

      if (newTag) {
        tagIds.push(newTag.id);
      }
    }
  }

  // Insert recipe_tags
  if (tagIds.length) {
    const tagRecords = tagIds.map(tagId => ({
      recipe_id: recipeId,
      tag_id: tagId
    }));

    await supabaseClient
      .from("recipe_tags")
      .insert(tagRecords);
  }
}

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

/**
 * Helper to fetch the current owner's cookbooks and which of them already
 * contain the given recipe, for the "Save to Cookbook(s)" widget on the
 * recipe view page (REW-62). Only called when the viewer is the recipe's
 * owner. Batches both queries instead of doing an N+1 per-cookbook lookup,
 * mirroring the like-status batching approach elsewhere in this file.
 */
async function getOwnerCookbooksForRecipe(supabaseClient, userId, recipeId) {
  const { data: cookbooks, error: cookbooksError } = await supabaseClient
    .from("cookbooks")
    .select("id, title")
    .eq("user_id", userId)
    .order("title", { ascending: true });

  if (cookbooksError) {
    console.error("Error fetching owner cookbooks:", cookbooksError);
    return [];
  }

  if (!cookbooks || !cookbooks.length) return [];

  const { data: memberRows, error: memberError } = await supabaseClient
    .from("cookbook_recipes")
    .select("cookbook_id")
    .eq("recipe_id", recipeId);

  if (memberError) {
    console.error("Error fetching cookbook membership for recipe:", memberError);
  }

  const memberCookbookIds = new Set((memberRows || []).map((row) => row.cookbook_id));

  return cookbooks.map((cookbook) => ({
    ...cookbook,
    containsRecipe: memberCookbookIds.has(cookbook.id),
  }));
}

/**
 * Helper to fetch recipe with categories and tags
 */
async function fetchRecipeWithRelations(supabaseClient, recipeId, userId = null) {
  let query = supabaseClient
    .from("recipes")
    .select("*")
    .eq("id", recipeId);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data: recipe, error } = await query.single();

  if (error || !recipe) {
    return null;
  }

  // Fetch categories for recipe
  const { data: recipeCategories } = await supabaseClient
    .from("recipe_categories")
    .select("category_id, categories(id, name, slug, icon)")
    .eq("recipe_id", recipeId);

  recipe.categories = recipeCategories?.map(rc => rc.categories) || [];

  // Fetch tags for recipe
  const { data: recipeTags } = await supabaseClient
    .from("recipe_tags")
    .select("tag_id, tags(id, name, slug)")
    .eq("recipe_id", recipeId);

  recipe.tags = recipeTags?.map(rt => rt.tags) || [];

  return recipe;
}

// GET /recipes/new - Show new recipe form
router.get("/new", requireAuth, async (req, res) => {
  try {
    const supabaseClient = createSupabaseClient(req.accessToken);

    // Fetch all categories
    const { data: categories } = await supabaseClient
      .from("categories")
      .select("*")
      .order("display_order", { ascending: true });

    // Fetch user's tags for autocomplete
    const { data: userTags } = await supabaseClient
      .from("tags")
      .select("*")
      .eq("user_id", req.user.id)
      .order("name", { ascending: true });

    const { data: mealPlans, error: mealPlansError } = await supabaseClient
      .from("meal_plans")
      .select("id, title, start_date, end_date")
      .eq("user_id", req.user.id)
      .order("start_date", { ascending: true });

    if (mealPlansError) {
      console.error("Error fetching meal plans for recipe form:", mealPlansError);
    }

    res.render("recipes/new", {
      title: "Add New Recipe",
      categories: categories || [],
      userTags: userTags || [],
      selectedCategories: [],
      selectedTags: [],
      mealPlans: mealPlansError ? [] : (mealPlans || []),
      accountDisplayName: getAccountDisplayName(req.user),
      recipe: null,
      visibility: "private",
      isClone: false,
    });
  } catch (error) {
    console.error("Error loading new recipe form:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/recipes");
  }
});

// POST /recipes - Create a new recipe. Exported for behavior-level route tests;
// production routing supplies the normal request-scoped client factory.
export async function handleRecipeCreate(req, res, { createClient = createSupabaseClient } = {}) {
  try {
    const {
      title,
      author,
      prepTime,
      cookTime,
      servings,
      difficulty,
      ingredients,
      instructions,
      notes,
      visibility,
      categories,
      tags,
      mealPlanId,
    } = req.body;

    // Validate required fields
    if (!title || !instructions || !prepTime?.trim() || !cookTime?.trim()) {
      req.flash("error", "Title, instructions, prep time, and total time are required");
      return res.redirect("/recipes/new");
    }

    // Create Supabase client with user's access token
    const supabaseClient = createClient(req.accessToken);

    // Process uploaded image if present
    let photoUrl = null;
    let thumbnailUrl = null;
    if (req.file) {
      // Validate actual file content (magic numbers)
      const isValidImage = await validateImageFile(req.file.buffer);
      if (!isValidImage) {
        req.flash("error", "Invalid image file. Please upload a valid image (JPEG, PNG, GIF, or WebP).");
        return res.redirect("/recipes/new");
      }

      // Optimize the full-size image
      photoUrl = await optimizeImage(req.file.buffer, req.file.mimetype);
      // Generate thumbnail
      thumbnailUrl = await generateThumbnail(req.file.buffer);
    }

    // Default Author to the logged-in account's display name if the
    // submitted value is blank/missing, so the default is authoritative
    // server-side (not just a client-side prefill).
    const trimmedAuthor = author?.trim();
    const effectiveAuthor = trimmedAuthor || getAccountDisplayName(req.user);

    // Prepare recipe data
    const recipeData = {
      user_id: req.user.id,
      title: title.trim(),
      author: effectiveAuthor || null,
      prep_time: prepTime?.trim() || null,
      cook_time: cookTime?.trim() || null,
      servings: servings?.trim() || null,
      difficulty: difficulty || 'Easy',
      ingredients: ingredients?.trim() || null,
      instructions: instructions.trim(),
      notes: notes?.trim() || null,
      photo_url: photoUrl,
      thumbnail_url: thumbnailUrl,
      status: normalizeRecipeVisibility(visibility),
    };

    // Insert recipe into database
    const { data, error } = await supabaseClient
      .from("recipes")
      .insert([recipeData])
      .select()
      .single();

    if (error) {
      console.error("Error creating recipe:", error);
      req.flash("error", "Failed to save recipe. Please try again.");
      return res.redirect("/recipes/new");
    }

    // Save categories and tags
    await saveRecipeCategories(supabaseClient, data.id, categories);

    // Parse tags from comma-separated string or array
    const tagNames = tags ? (typeof tags === 'string' ? tags.split(',') : tags) : [];
    await saveRecipeTags(supabaseClient, data.id, req.user.id, tagNames);

    const assignment = await assignRecipeToMealPlan(supabaseClient, {
      mealPlanId,
      recipeId: data.id,
      userId: req.user.id,
    });

    const successMessage = recipeData.status === "published"
      ? "Recipe saved as Public!"
      : "Recipe saved as Private!";

    const fullSuccessMessage = assignment.status === "assigned"
      ? `${successMessage} Added to ${assignment.mealPlanTitle}.`
      : successMessage;

    req.flash("success", fullSuccessMessage);
    if (assignment.status === "failed") {
      console.error("Meal plan assignment failed after manual recipe creation");
      req.flash("error", "Recipe saved, but it could not be added to the selected meal plan.");
    }
    res.redirect("/recipes");
  } catch (error) {
    console.error("Error in recipe creation:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/recipes/new");
  }
}

router.post("/", requireAuth, uploadLimiter, imageUpload.single("photo"), handleRecipeImageUploadError, csrfProtection, (req, res) => handleRecipeCreate(req, res));

// POST /recipes/:id/clone - Add an independent, private copy of a public recipe.
export async function handleRecipeClone(req, res, { createClient = createSupabaseClient } = {}) {
  const sourceId = req.params.id;
  if (!UUID_PATTERN.test(sourceId)) {
    req.flash("error", "Recipe not found or unavailable to add");
    return res.redirect("/recipes");
  }

  try {
    const supabaseClient = createClient(req.accessToken);
    const { data: sourceRecipe, error: sourceError } = await supabaseClient
      .from("recipes")
      .select("id, user_id, title, author, prep_time, cook_time, servings, difficulty, ingredients, instructions, notes, source_url, status, original_author")
      .eq("id", sourceId)
      .eq("status", "published")
      .single();

    if (sourceError || !sourceRecipe || sourceRecipe.user_id === req.user.id) {
      req.flash("error", "Recipe not found or unavailable to add");
      return res.redirect("/recipes");
    }

    const { data: sourceCategories, error: categoriesError } = await supabaseClient
      .from("recipe_categories")
      .select("category_id")
      .eq("recipe_id", sourceId);

    if (categoriesError) throw categoriesError;

    const originalAuthor = sourceRecipe.original_author?.trim()
      || sourceRecipe.author?.trim()
      || "Unknown";
    const recipeData = {
      user_id: req.user.id,
      title: sourceRecipe.title,
      author: sourceRecipe.author,
      prep_time: sourceRecipe.prep_time,
      cook_time: sourceRecipe.cook_time,
      servings: sourceRecipe.servings,
      difficulty: sourceRecipe.difficulty,
      ingredients: sourceRecipe.ingredients,
      instructions: sourceRecipe.instructions,
      notes: sourceRecipe.notes,
      source_url: sourceRecipe.source_url,
      photo_url: null,
      thumbnail_url: null,
      status: "draft",
      cloned_from_recipe_id: sourceRecipe.id,
      original_author: originalAuthor,
    };

    const { data: addedRecipe, error: insertError } = await supabaseClient
      .from("recipes")
      .insert([recipeData])
      .select("id")
      .single();

    if (insertError || !addedRecipe) throw insertError || new Error("Recipe insert returned no row");

    const categoryRows = (sourceCategories || []).map(({ category_id }) => ({
      recipe_id: addedRecipe.id,
      category_id,
    }));
    if (categoryRows.length) {
      const { error: categoryInsertError } = await supabaseClient
        .from("recipe_categories")
        .insert(categoryRows);
      if (categoryInsertError) {
        const { error: cleanupError } = await supabaseClient
          .from("recipes")
          .delete()
          .eq("id", addedRecipe.id)
          .eq("user_id", req.user.id);
        if (cleanupError) console.error("Failed to clean up incomplete added recipe:", cleanupError);
        throw categoryInsertError;
      }
    }

    req.flash("success", "Recipe added as Private!");
    return res.redirect(`/recipes/${addedRecipe.id}`);
  } catch (error) {
    console.error("Error adding recipe:", error);
    req.flash("error", "The recipe could not be added. Please try again.");
    res.redirect("/recipes");
  }
}

router.post("/:id/clone", requireAuth, addRecipeLimiter, csrfProtection, (req, res) => handleRecipeClone(req, res));

// GET /recipes - List all recipes for the current user
router.get("/", requireAuth, async (req, res) => {
  try {
    const supabaseClient = createSupabaseClient(req.accessToken);
    const { category, tags: tagFilter } = req.query;

    // Fetch all categories for filter dropdown
    const { data: allCategories } = await supabaseClient
      .from("categories")
      .select("*")
      .order("display_order", { ascending: true });

    // Fetch user's tags for filter
    const { data: userTags } = await supabaseClient
      .from("tags")
      .select("*")
      .eq("user_id", req.user.id)
      .order("name", { ascending: true });

    // Build base query for recipes
    let recipesQuery = supabaseClient
      .from("recipes")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    const { data: recipes, error } = await recipesQuery;

    if (error) {
      console.error("Error fetching recipes:", error);
      req.flash("error", "Failed to load recipes");
      return res.redirect("/dashboard");
    }

    // Batch-fetch the current user's like status for these recipes to avoid
    // an N+1 query pattern (REW-55, following the batching approach documented
    // in docs/plans/REW-21-recipe-likes.md).
    const recipeIds = (recipes || []).map((recipe) => recipe.id);
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

    // Fetch categories and tags for each recipe
    const recipesWithRelations = await Promise.all(
      (recipes || []).map(async (recipe) => {
        const { data: recipeCategories } = await supabaseClient
          .from("recipe_categories")
          .select("category_id, categories(id, name, slug, icon)")
          .eq("recipe_id", recipe.id);

        const { data: recipeTags } = await supabaseClient
          .from("recipe_tags")
          .select("tag_id, tags(id, name, slug)")
          .eq("recipe_id", recipe.id);

        return {
          ...recipe,
          categories: recipeCategories?.map(rc => rc.categories) || [],
          tags: recipeTags?.map(rt => rt.tags) || [],
          isLiked: likedRecipeIds.has(recipe.id)
        };
      })
    );

    // Filter by category if specified
    let filteredRecipes = recipesWithRelations;
    if (category) {
      filteredRecipes = filteredRecipes.filter(recipe =>
        recipe.categories.some(cat => cat.slug === category)
      );
    }

    // Filter by tags if specified
    if (tagFilter) {
      const tagSlugs = tagFilter.split(',').map(t => t.trim()).filter(t => t);
      if (tagSlugs.length) {
        filteredRecipes = filteredRecipes.filter(recipe =>
          tagSlugs.every(slug =>
            recipe.tags.some(tag => tag.slug === slug)
          )
        );
      }
    }

    res.render("recipes/index", {
      title: "My Recipes",
      recipes: filteredRecipes,
      categories: allCategories || [],
      userTags: userTags || [],
      selectedCategory: category || '',
      selectedTags: tagFilter || ''
    });
  } catch (error) {
    console.error("Error in recipes list:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/dashboard");
  }
});

// GET /recipes/:id/edit - Show edit form
router.get("/:id/edit", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const supabaseClient = createSupabaseClient(req.accessToken);

    const recipe = await fetchRecipeWithRelations(supabaseClient, id, req.user.id);

    if (!recipe) {
      req.flash("error", "Recipe not found or you don't have permission to edit it");
      return res.redirect("/recipes");
    }

    // Fetch all categories
    const { data: categories } = await supabaseClient
      .from("categories")
      .select("*")
      .order("display_order", { ascending: true });

    // Fetch user's tags for autocomplete
    const { data: userTags } = await supabaseClient
      .from("tags")
      .select("*")
      .eq("user_id", req.user.id)
      .order("name", { ascending: true });

    res.render("recipes/edit", {
      title: `Edit ${recipe.title}`,
      recipe,
      categories: categories || [],
      userTags: userTags || [],
      selectedCategories: recipe.categories.map(c => c.id),
      selectedTags: recipe.tags.map(t => t.name)
    });
  } catch (error) {
    console.error("Error loading recipe for edit:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/recipes");
  }
});

// POST /recipes/:id/update - Update a recipe. Exported for ownership and
// visibility behavior tests; production uses the request-scoped client.
export async function handleRecipeUpdate(req, res, { createClient = createSupabaseClient } = {}) {
  try {
    const { id } = req.params;
    const {
      title,
      author,
      prepTime,
      cookTime,
      servings,
      difficulty,
      ingredients,
      instructions,
      notes,
      visibility,
      removePhoto,
      categories,
      tags,
    } = req.body;

    // Validate required fields
    if (!title || !instructions || !prepTime?.trim() || !cookTime?.trim()) {
      req.flash("error", "Title, instructions, prep time, and total time are required");
      return res.redirect(`/recipes/${id}/edit`);
    }

    const supabaseClient = createClient(req.accessToken);

    // Prepare update data
    const updateData = {
      title: title.trim(),
      author: author?.trim() || null,
      prep_time: prepTime?.trim() || null,
      cook_time: cookTime?.trim() || null,
      servings: servings?.trim() || null,
      difficulty: difficulty || 'Easy',
      ingredients: ingredients?.trim() || null,
      instructions: instructions.trim(),
      notes: notes?.trim() || null,
      status: normalizeRecipeVisibility(visibility),
    };

    // Handle photo update
    if (removePhoto === "true") {
      // User wants to remove the photo
      updateData.photo_url = null;
      updateData.thumbnail_url = null;
    } else if (req.file) {
      // Validate actual file content (magic numbers)
      const isValidImage = await validateImageFile(req.file.buffer);
      if (!isValidImage) {
        req.flash("error", "Invalid image file. Please upload a valid image (JPEG, PNG, GIF, or WebP).");
        return res.redirect(`/recipes/${id}/edit`);
      }

      // User uploaded a new photo - optimize and generate thumbnail
      updateData.photo_url = await optimizeImage(req.file.buffer, req.file.mimetype);
      updateData.thumbnail_url = await generateThumbnail(req.file.buffer);
    }
    // If neither removePhoto nor new file, keep existing photo (don't set photo_url in updateData)

    // Update recipe (RLS will ensure only owner can update)
    const { data, error } = await supabaseClient
      .from("recipes")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", req.user.id)
      .select()
      .single();

    if (error) {
      console.error("Error updating recipe:", error);
      req.flash("error", "Failed to update recipe. Please try again.");
      return res.redirect(`/recipes/${id}/edit`);
    }

    // Update categories and tags
    await saveRecipeCategories(supabaseClient, id, categories);

    // Parse tags from comma-separated string or array
    const tagNames = tags ? (typeof tags === 'string' ? tags.split(',') : tags) : [];
    await saveRecipeTags(supabaseClient, id, req.user.id, tagNames);

    req.flash("success", "Recipe updated successfully!");
    res.redirect(`/recipes/${id}`);
  } catch (error) {
    console.error("Error in recipe update:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/recipes");
  }
}

router.post("/:id/update", requireAuth, uploadLimiter, imageUpload.single("photo"), handleRecipeImageUploadError, csrfProtection, (req, res) => handleRecipeUpdate(req, res));

// POST /recipes/:id/delete - Delete a recipe
router.post("/:id/delete", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const supabaseClient = createSupabaseClient(req.accessToken);

    // Delete recipe (RLS will ensure only owner can delete)
    const { error } = await supabaseClient
      .from("recipes")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.id);

    if (error) {
      console.error("Error deleting recipe:", error);
      req.flash("error", "Failed to delete recipe. Please try again.");
      return res.redirect(`/recipes/${id}`);
    }

    req.flash("success", "Recipe deleted successfully!");
    res.redirect("/recipes");
  } catch (error) {
    console.error("Error in recipe deletion:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/recipes");
  }
});

// GET /recipes/:id/scale - API endpoint for instant scaling (returns JSON)
router.get("/:id/scale", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const supabaseClient = createSupabaseClient(req.accessToken);

    const { data: recipe, error } = await supabaseClient
      .from("recipes")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Convert the free-text ingredients into quantity / unit / ingredient rows
    const ingredientRows = parseIngredients(recipe.ingredients);

    // Scale them to the requested servings (?servings=8) or multiplier (?scale=2)
    const scaling = resolveScaling({
      servingsText: recipe.servings,
      requestedServings: req.query.servings,
      requestedScale: req.query.scale,
    });

    // Return JSON with scaled ingredients and scaling info
    res.json({
      ingredientRows: scaleIngredients(ingredientRows, scaling.factor),
      scaling,
    });
  } catch (error) {
    console.error("Error scaling recipe:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

// GET /recipes/:id - View a single recipe
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const supabaseClient = createSupabaseClient(req.accessToken);

    const recipe = await fetchRecipeWithRelations(supabaseClient, id);

    if (!recipe) {
      req.flash("error", "Recipe not found");
      return res.redirect("/recipes");
    }

    // Check if current user is the owner
    const isOwner = recipe.user_id === req.user.id;

    // Get like count and status
    const likeCount = await getLikeCount(id);
    const isLiked = await hasUserLiked(supabaseClient, id);

    // Owner-only: which of the viewer's cookbooks contain this recipe,
    // for the "Save to Cookbook(s)" widget (REW-62).
    const ownerCookbooks = isOwner
      ? await getOwnerCookbooksForRecipe(supabaseClient, req.user.id, id)
      : [];

    // Convert the free-text ingredients into quantity / unit / ingredient rows
    const ingredientRows = parseIngredients(recipe.ingredients);

    // Scale them to the requested servings (?servings=8) or multiplier (?scale=2)
    const scaling = resolveScaling({
      servingsText: recipe.servings,
      requestedServings: req.query.servings,
      requestedScale: req.query.scale,
    });

    res.render("recipes/view", {
      title: recipe.title,
      recipe,
      isOwner,
      likeCount,
      isLiked,
      ownerCookbooks,
      ingredientRows: scaleIngredients(ingredientRows, scaling.factor),
      scaling,
      quickScaleFactors: QUICK_SCALE_FACTORS,
    });
  } catch (error) {
    console.error("Error viewing recipe:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/recipes");
  }
});

export default router;

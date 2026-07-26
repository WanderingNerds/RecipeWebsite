import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createSupabaseClient } from "../config/supabase.js";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { generateThumbnail, optimizeImage, validateImageFile } from "../utils/imageUtils.js";

const router = Router();

// Rate limiter specifically for file uploads
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit to 10 uploads per 15 minutes
  message: 'Too many file uploads. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Configure multer to store files in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only accept image files
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// GET /recipes/new - Show new recipe form
router.get("/new", requireAuth, (req, res) => {
  res.render("recipes/new", {
    title: "Add New Recipe",
  });
});

// POST /recipes - Create a new recipe
router.post("/", requireAuth, uploadLimiter, upload.single("photo"), async (req, res) => {
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
      action, // 'draft' or 'publish'
    } = req.body;

    // Validate required fields
    if (!title || !instructions) {
      req.flash("error", "Title and instructions are required");
      return res.redirect("/recipes/new");
    }

    // Create Supabase client with user's access token
    const supabaseClient = createSupabaseClient(req.accessToken);

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

    // Prepare recipe data
    const recipeData = {
      user_id: req.user.id,
      title: title.trim(),
      author: author?.trim() || null,
      prep_time: prepTime?.trim() || null,
      cook_time: cookTime?.trim() || null,
      servings: servings?.trim() || null,
      difficulty: difficulty || 'Easy',
      ingredients: ingredients?.trim() || null,
      instructions: instructions.trim(),
      notes: notes?.trim() || null,
      photo_url: photoUrl,
      thumbnail_url: thumbnailUrl,
      status: action === 'publish' ? 'published' : 'draft',
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

    // Success message based on action
    const successMessage = action === 'publish'
      ? "Recipe published successfully!"
      : "Recipe saved as draft!";

    req.flash("success", successMessage);
    res.redirect("/recipes");
  } catch (error) {
    console.error("Error in recipe creation:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/recipes/new");
  }
});

// GET /recipes - List all recipes for the current user
router.get("/", requireAuth, async (req, res) => {
  try {
    const supabaseClient = createSupabaseClient(req.accessToken);

    // Fetch user's recipes
    const { data: recipes, error } = await supabaseClient
      .from("recipes")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching recipes:", error);
      req.flash("error", "Failed to load recipes");
      return res.redirect("/dashboard");
    }

    res.render("recipes/index", {
      title: "My Recipes",
      recipes: recipes || [],
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

    const { data: recipe, error } = await supabaseClient
      .from("recipes")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.user.id) // Only owner can edit
      .single();

    if (error || !recipe) {
      req.flash("error", "Recipe not found or you don't have permission to edit it");
      return res.redirect("/recipes");
    }

    res.render("recipes/edit", {
      title: `Edit ${recipe.title}`,
      recipe,
    });
  } catch (error) {
    console.error("Error loading recipe for edit:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/recipes");
  }
});

// POST /recipes/:id/update - Update a recipe
router.post("/:id/update", requireAuth, uploadLimiter, upload.single("photo"), async (req, res) => {
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
      action,
      removePhoto,
    } = req.body;

    // Validate required fields
    if (!title || !instructions) {
      req.flash("error", "Title and instructions are required");
      return res.redirect(`/recipes/${id}/edit`);
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

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
      status: action === 'publish' ? 'published' : 'draft',
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

    req.flash("success", "Recipe updated successfully!");
    res.redirect(`/recipes/${id}`);
  } catch (error) {
    console.error("Error in recipe update:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/recipes");
  }
});

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

// GET /recipes/:id - View a single recipe
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const supabaseClient = createSupabaseClient(req.accessToken);

    const { data: recipe, error } = await supabaseClient
      .from("recipes")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !recipe) {
      req.flash("error", "Recipe not found");
      return res.redirect("/recipes");
    }

    // Check if current user is the owner
    const isOwner = recipe.user_id === req.user.id;

    res.render("recipes/view", {
      title: recipe.title,
      recipe,
      isOwner,
    });
  } catch (error) {
    console.error("Error viewing recipe:", error);
    req.flash("error", "An unexpected error occurred");
    res.redirect("/recipes");
  }
});

export default router;

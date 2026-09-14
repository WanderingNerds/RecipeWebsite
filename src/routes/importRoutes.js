/**
 * Import routes for recipe file imports.
 *
 * Handles JSON-LD, PDF, and image imports with parsing,
 * preview, and save functionality.
 */

import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createSupabaseClient } from "../config/supabase.js";
import { importRecipe, SUPPORTED_MIME_TYPES, sanitizeUrl } from "../utils/recipeImporter.js";
import { getAccountDisplayName } from "../utils/userUtils.js";
import { csrfProtection } from "../middleware/csrfMiddleware.js";
import { assignRecipeToMealPlan } from "../utils/mealPlanAssignment.js";

const router = Router();

export function validateImportCookTime(cookTime) {
  return typeof cookTime === "string" && cookTime.trim()
    ? null
    : "Cook Time is required";
}

// Rate limiter for imports: 5 imports per 15 minutes
const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: "Too many import attempts. Please try again in 15 minutes.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Configure multer for import uploads (memory storage, 2MB limit)
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/json",
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Please upload a JSON, PDF, or image file."));
    }
  },
});

/**
 * GET /recipes/import
 * Render the import page with upload form
 */
export async function handleImportForm(req, res, { createClient = createSupabaseClient } = {}) {
  let mealPlans = [];
  try {
    const supabaseClient = createClient(req.accessToken);
    const { data, error } = await supabaseClient
      .from("meal_plans")
      .select("id, title, start_date, end_date")
      .eq("user_id", req.user.id)
      .order("start_date", { ascending: true });

    if (error) {
      console.error("Error fetching meal plans for import form:", error);
    } else {
      mealPlans = data || [];
    }
  } catch (error) {
    console.error("Error loading meal plans for import form:", { name: error?.name });
  }

  res.render("recipes/import", {
    title: "Import Recipe",
    supportedFormats: [
      { extension: ".json", description: "JSON-LD/Schema.org Recipe" },
      { extension: ".pdf", description: "PDF document" },
      { extension: ".jpg/.png/.webp", description: "Recipe image (OCR)" },
    ],
    accountDisplayName: getAccountDisplayName(req.user),
    mealPlans,
  });
}

router.get("/", requireAuth, (req, res) => handleImportForm(req, res));

/**
 * POST /recipes/import/parse
 * Parse uploaded file and return JSON preview
 */
router.post("/parse", requireAuth, importLimiter, importUpload.single("file"), csrfProtection, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "No file uploaded. Please select a file to import.",
      });
    }

    // Parse the file using recipeImporter
    const parsedRecipe = await importRecipe(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    // Return parsed data for preview
    res.json({
      success: true,
      recipe: parsedRecipe,
    });
  } catch (error) {
    console.error("Import parse error:", error);
    res.status(400).json({
      error: error.message || "Could not extract recipe from file. Try a different format.",
    });
  }
});

/**
 * POST /recipes/import/check-title
 * Check if a recipe title already exists for the user
 */
router.post("/check-title", requireAuth, async (req, res) => {
  try {
    const { title } = req.body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    const { data: existingRecipe, error } = await supabaseClient
      .from("recipes")
      .select("id")
      .eq("user_id", req.user.id)
      .ilike("title", title.trim())
      .single();

    // PGRST116 means no rows found, which is what we want
    if (error && error.code !== "PGRST116") {
      console.error("Error checking title:", error);
      return res.status(500).json({ error: "Failed to check title" });
    }

    res.json({
      exists: !!existingRecipe,
      message: existingRecipe
        ? "A recipe with this title already exists. Please choose a different title."
        : null,
    });
  } catch (error) {
    console.error("Check title error:", error);
    res.status(500).json({ error: "Failed to check title" });
  }
});

/**
 * POST /recipes/import/save
 * Save the imported recipe after user confirmation
 */
export function createSaveImportHandler({ createClient = createSupabaseClient } = {}) {
  return async (req, res) => {
    try {
      const {
export async function handleImportSave(req, res, { createClient = createSupabaseClient } = {}) {
  try {
    const {
      title,
      author,
      description,
      ingredients,
      instructions,
      prepTime,
      cookTime,
      servings,
      sourceUrl,
      action, // 'draft' or 'publish'
      } = req.body;
      mealPlanId,
    } = req.body;

    // Validate required fields
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    if (!instructions || !instructions.trim()) {
      return res.status(400).json({ error: "Instructions are required" });
    }

    const cookTimeError = validateImportCookTime(cookTime);
    if (cookTimeError) {
      return res.status(400).json({ error: cookTimeError });
    }

    const supabaseClient = createClient(req.accessToken);

    // Check for duplicate title
    const { data: existingRecipe, error: checkError } = await supabaseClient
      .from("recipes")
      .select("id")
      .eq("user_id", req.user.id)
      .ilike("title", title.trim())
      .single();

    // PGRST116 means no rows found, which is what we want
    if (checkError && checkError.code !== "PGRST116") {
      console.error("Error checking title:", checkError);
      return res.status(500).json({ error: "Failed to save recipe" });
    }

    if (existingRecipe) {
      return res.status(400).json({
        error: "A recipe with this title already exists. Please choose a different title.",
        duplicateTitle: true,
      });
    }

    // Validate and sanitize sourceUrl (only allow http/https)
    const sanitizedSourceUrl = sourceUrl ? sanitizeUrl(sourceUrl.trim()) : null;
    if (sourceUrl && sourceUrl.trim() && !sanitizedSourceUrl) {
      return res.status(400).json({
        error: "Invalid source URL. Only http and https URLs are allowed.",
      });
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
      ingredients: ingredients?.trim() || null,
      instructions: instructions.trim(),
      prep_time: prepTime?.trim() || null,
      cook_time: cookTime.trim(),
      servings: servings?.trim() || null,
      notes: description?.trim() || null, // Use description as notes
      source_url: sanitizedSourceUrl,
      status: action === "publish" ? "published" : "draft",
      difficulty: "Easy", // Default difficulty for imports
    };

    // Insert recipe
    const { data, error } = await supabaseClient
      .from("recipes")
      .insert([recipeData])
      .select()
      .single();

    if (error) {
      console.error("Error saving recipe:", error);
      return res.status(500).json({ error: "Failed to save recipe. Please try again." });
    }

    const assignment = await assignRecipeToMealPlan(supabaseClient, {
      mealPlanId,
      recipeId: data.id,
      userId: req.user.id,
    });

    const baseMessage = action === "publish" ? "Recipe imported and published!" : "Recipe imported as draft!";
    const message = assignment.status === "assigned"
      ? `${baseMessage} Added to ${assignment.mealPlanTitle}.`
      : baseMessage;

    req.flash("success", message);
    if (assignment.status === "failed") {
      console.error("Meal plan assignment failed after recipe import");
      req.flash("error", "Recipe saved, but it could not be added to the selected meal plan.");
    }

    res.json({
      success: true,
      recipeId: data.id,
      message,
      mealPlanAssignment: assignment,
    });
    } catch (error) {
      console.error("Import save error:", error);
      res.status(500).json({ error: "An unexpected error occurred" });
    }
  };
}

router.post("/save", requireAuth, createSaveImportHandler());
  } catch (error) {
    console.error("Import save error:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
}

router.post("/save", requireAuth, (req, res) => handleImportSave(req, res));

export default router;

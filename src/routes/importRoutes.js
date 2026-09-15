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
import { normalizeRecipeVisibility } from "../utils/recipeVisibility.js";

const router = Router();

export function validateImportCookTime(cookTime) {
  return typeof cookTime === "string" && cookTime.trim()
    ? null
    : "Cook Time is required";
}

// Import rate-limit window: 15 minutes (unchanged).
export const IMPORT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Import rate limit: 25 parses per window per IP. Each parse buffers the whole
// file in memory and runs PDF extraction or OCR, so the ceiling stays bounded.
export const IMPORT_RATE_LIMIT_MAX = 25;

// Max import upload size: 4MB. Deliberately below Vercel's 4.5MB request-body
// cap so oversize uploads get our JSON 413 instead of an opaque platform error.
export const MAX_IMPORT_FILE_SIZE_BYTES = 4 * 1024 * 1024;

// Human-readable form of the upload cap, derived from the byte constant so a
// future limit change cannot leave stale copy behind.
export const MAX_IMPORT_FILE_SIZE_LABEL = `${MAX_IMPORT_FILE_SIZE_BYTES / (1024 * 1024)}MB`;

export const IMPORT_RATE_LIMIT_MESSAGE =
  "Too many import attempts. Please try again in 15 minutes.";
export const IMPORT_FILE_TOO_LARGE_MESSAGE = `File must be under ${MAX_IMPORT_FILE_SIZE_LABEL}`;
export const IMPORT_UNSUPPORTED_TYPE_MESSAGE =
  "Unsupported file type. Please upload a JSON, PDF, or image file.";
export const IMPORT_INVALID_UPLOAD_MESSAGE =
  "Invalid upload. Please select a single recipe file.";

// Rate limiter for imports: 25 imports per 15 minutes per IP.
// The message is an object so the 429 body is JSON (public/js/import.js reads
// data.error) instead of plain text.
// Frozen because the object is shared live with the constructed limiter;
// mutating it after construction would desync config from behaviour.
export const importLimiterOptions = Object.freeze({
  windowMs: IMPORT_RATE_LIMIT_WINDOW_MS,
  max: IMPORT_RATE_LIMIT_MAX,
  message: { error: IMPORT_RATE_LIMIT_MESSAGE },
  standardHeaders: true,
  legacyHeaders: false,
});

export const importLimiter = rateLimit(importLimiterOptions);

// Configure multer for import uploads (memory storage, 4MB limit)
export const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_FILE_SIZE_BYTES }, // 4MB
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
      const error = new Error(IMPORT_UNSUPPORTED_TYPE_MESSAGE);
      error.code = "UNSUPPORTED_FILE_TYPE";
      cb(error);
    }
  },
});

/**
 * Error handler for the multer stage of POST /recipes/import/parse.
 *
 * Without this, multer's rejections fall through to the global errorHandler,
 * which renders an HTML page; the client then cannot JSON-parse the body and
 * shows an unrelated message. Every MulterError is answered with JSON, not just
 * LIMIT_FILE_SIZE, so codes like LIMIT_UNEXPECTED_FILE, LIMIT_PART_COUNT, and
 * LIMIT_FIELD_VALUE stay parseable by the client. Unrelated errors are
 * delegated untouched.
 */
export function handleImportUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    return err.code === "LIMIT_FILE_SIZE"
      ? res.status(413).json({ error: IMPORT_FILE_TOO_LARGE_MESSAGE })
      : res.status(400).json({ error: IMPORT_INVALID_UPLOAD_MESSAGE });
  }

  if (err && err.code === "UNSUPPORTED_FILE_TYPE") {
    return res.status(400).json({ error: IMPORT_UNSUPPORTED_TYPE_MESSAGE });
  }

  return next(err);
}

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
router.post("/parse", requireAuth, importLimiter, importUpload.single("file"), handleImportUploadError, csrfProtection, async (req, res) => {
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
      visibility,
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
      status: normalizeRecipeVisibility(visibility),
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

    const baseMessage = recipeData.status === "published"
      ? "Recipe imported as Public!"
      : "Recipe imported as Private!";
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
}

export function createSaveImportHandler({ createClient = createSupabaseClient } = {}) {
  return (req, res) => handleImportSave(req, res, { createClient });
}

router.post("/save", requireAuth, createSaveImportHandler());

export default router;

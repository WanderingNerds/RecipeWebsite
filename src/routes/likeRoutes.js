import { Router } from "express";
import { createSupabaseClient, supabase } from "../config/supabase.js";
import rateLimit from "express-rate-limit";

const router = Router();

// Rate limiter for like/unlike actions (30 per minute per user)
// Since this is only applied to authenticated routes, we use user ID as the key
const likeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 actions per minute
  message: { error: "Too many favorite actions. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
  // Use user ID for rate limiting (auth middleware runs before this)
  keyGenerator: (req) => req.user?.id || "anonymous",
  // Skip IP-based validation since we use user ID
  validate: { xForwardedForHeader: false },
});

/**
 * API-specific auth middleware that returns JSON errors instead of redirecting
 */
async function requireApiAuth(req, res, next) {
  try {
    const accessToken = req.cookies["sb-access-token"];

    if (!accessToken) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    req.user = user;
    req.accessToken = accessToken;
    next();
  } catch (error) {
    console.error("API auth error:", error);
    res.status(500).json({ error: "Authentication error" });
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Helper to get like count for a recipe using the public client
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
 * Helper to verify recipe exists and is published
 */
async function recipeExists(recipeId) {
  const { data, error } = await supabase
    .from("recipes")
    .select("id")
    .eq("id", recipeId)
    .eq("status", "published")
    .maybeSingle();

  if (error) {
    console.error("Error checking recipe:", error);
    return false;
  }

  return !!data;
}

// GET /api/likes/:recipeId - Get like status and count for a recipe
router.get("/:recipeId", async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate UUID format
    if (!UUID_PATTERN.test(recipeId)) {
      return res.status(400).json({ error: "Invalid recipe ID" });
    }

    // Get like count (public)
    const count = await getLikeCount(recipeId);

    // Check if user has liked (if authenticated)
    let liked = false;
    if (req.user && req.cookies["sb-access-token"]) {
      const supabaseClient = createSupabaseClient(req.cookies["sb-access-token"]);
      liked = await hasUserLiked(supabaseClient, recipeId);
    }

    res.json({
      liked,
      count,
      recipeId,
    });
  } catch (error) {
    console.error("Error getting like status:", error);
    res.status(500).json({ error: "Failed to get favorite status" });
  }
});

// POST /api/likes/:recipeId - Like a recipe
router.post("/:recipeId", requireApiAuth, likeLimiter, async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate UUID format
    if (!UUID_PATTERN.test(recipeId)) {
      return res.status(400).json({ error: "Invalid recipe ID" });
    }

    // Verify recipe exists and is published
    const exists = await recipeExists(recipeId);
    if (!exists) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    // Check if already liked
    const alreadyLiked = await hasUserLiked(supabaseClient, recipeId);
    if (alreadyLiked) {
      // Return current state without error
      const count = await getLikeCount(recipeId);
      return res.json({
        liked: true,
        count,
        recipeId,
      });
    }

    // Insert like
    const { error } = await supabaseClient.from("recipe_likes").insert({
      user_id: req.user.id,
      recipe_id: recipeId,
    });

    if (error) {
      console.error("Error liking recipe:", error);
      return res.status(500).json({ error: "Failed to favorite recipe" });
    }

    // Get updated count
    const count = await getLikeCount(recipeId);

    res.json({
      liked: true,
      count,
      recipeId,
    });
  } catch (error) {
    console.error("Error liking recipe:", error);
    res.status(500).json({ error: "Failed to favorite recipe" });
  }
});

// DELETE /api/likes/:recipeId - Unlike a recipe
router.delete("/:recipeId", requireApiAuth, likeLimiter, async (req, res) => {
  try {
    const { recipeId } = req.params;

    // Validate UUID format
    if (!UUID_PATTERN.test(recipeId)) {
      return res.status(400).json({ error: "Invalid recipe ID" });
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    // Check if currently liked
    const isLiked = await hasUserLiked(supabaseClient, recipeId);
    if (!isLiked) {
      // Return current state without error
      const count = await getLikeCount(recipeId);
      return res.json({
        liked: false,
        count,
        recipeId,
      });
    }

    // Delete like
    const { error } = await supabaseClient
      .from("recipe_likes")
      .delete()
      .eq("user_id", req.user.id)
      .eq("recipe_id", recipeId);

    if (error) {
      console.error("Error unliking recipe:", error);
      return res.status(500).json({ error: "Failed to remove recipe from favorites" });
    }

    // Get updated count
    const count = await getLikeCount(recipeId);

    res.json({
      liked: false,
      count,
      recipeId,
    });
  } catch (error) {
    console.error("Error unliking recipe:", error);
    res.status(500).json({ error: "Failed to remove recipe from favorites" });
  }
});

export default router;

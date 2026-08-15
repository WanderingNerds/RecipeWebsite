import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createSupabaseClient } from "../config/supabase.js";

const router = Router();

/**
 * Generate a URL-friendly slug from a string
 */
function generateSlug(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars (except spaces and hyphens)
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

// GET /api/tags - List user's tags
router.get("/", requireAuth, async (req, res) => {
  try {
    const supabaseClient = createSupabaseClient(req.accessToken);

    const { data: tags, error } = await supabaseClient
      .from("tags")
      .select("*")
      .eq("user_id", req.user.id)
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching tags:", error);
      return res.status(500).json({ error: "Failed to fetch tags" });
    }

    res.json(tags || []);
  } catch (error) {
    console.error("Error in tags list:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

// POST /api/tags - Create new tag
router.post("/", requireAuth, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Tag name is required" });
    }

    const tagName = name.trim();
    const slug = generateSlug(tagName);

    if (!slug) {
      return res.status(400).json({ error: "Invalid tag name" });
    }

    const supabaseClient = createSupabaseClient(req.accessToken);

    // Check if tag with same slug already exists for this user
    const { data: existingTag } = await supabaseClient
      .from("tags")
      .select("*")
      .eq("user_id", req.user.id)
      .eq("slug", slug)
      .single();

    if (existingTag) {
      // Return existing tag instead of creating duplicate
      return res.json(existingTag);
    }

    // Create new tag
    const { data: newTag, error } = await supabaseClient
      .from("tags")
      .insert([{
        name: tagName,
        slug: slug,
        user_id: req.user.id
      }])
      .select()
      .single();

    if (error) {
      console.error("Error creating tag:", error);
      return res.status(500).json({ error: "Failed to create tag" });
    }

    res.status(201).json(newTag);
  } catch (error) {
    console.error("Error in tag creation:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

// DELETE /api/tags/:id - Delete a tag
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const supabaseClient = createSupabaseClient(req.accessToken);

    // Delete tag (RLS will ensure only owner can delete)
    const { error } = await supabaseClient
      .from("tags")
      .delete()
      .eq("id", id)
      .eq("user_id", req.user.id);

    if (error) {
      console.error("Error deleting tag:", error);
      return res.status(500).json({ error: "Failed to delete tag" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error in tag deletion:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

export default router;

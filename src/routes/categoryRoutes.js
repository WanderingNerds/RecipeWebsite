import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { createSupabaseClient } from "../config/supabase.js";

const router = Router();

// GET /api/categories - List all categories ordered by display_order
router.get("/", requireAuth, async (req, res) => {
  try {
    const supabaseClient = createSupabaseClient(req.accessToken);

    const { data: categories, error } = await supabaseClient
      .from("categories")
      .select("*")
      .order("display_order", { ascending: true });

    if (error) {
      console.error("Error fetching categories:", error);
      return res.status(500).json({ error: "Failed to fetch categories" });
    }

    res.json(categories || []);
  } catch (error) {
    console.error("Error in categories list:", error);
    res.status(500).json({ error: "An unexpected error occurred" });
  }
});

export default router;

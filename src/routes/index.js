import { Router } from "express";
import authRoutes from "./authRoutes.js";
import recipeRoutes from "./recipeRoutes.js";
import categoryRoutes from "./categoryRoutes.js";
import tagRoutes from "./tagRoutes.js";
import publicRoutes from "./publicRoutes.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

// Home page
router.get("/", (req, res) => {
  res.render("home", {
    title: "Recipe Website",
  });
});

// Auth routes
router.use("/auth", authRoutes);

// Recipe routes
router.use("/recipes", recipeRoutes);

// API routes for categories and tags
router.use("/api/categories", categoryRoutes);
router.use("/api/tags", tagRoutes);

// Protected dashboard (example)
router.get("/dashboard", requireAuth, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
  });
});

export default router;

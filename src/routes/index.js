import { Router } from "express";
import authRoutes from "./authRoutes.js";
import recipeRoutes from "./recipeRoutes.js";
import publicRoutes from "./publicRoutes.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

// Home page
router.get("/", (req, res) => {
  res.render("home", {
    title: "Recipe Website",
  });
});

// Public search and browse (no login required)
router.use("/", publicRoutes);

// Auth routes
router.use("/auth", authRoutes);

// Recipe routes
router.use("/recipes", recipeRoutes);

// Protected dashboard (example)
router.get("/dashboard", requireAuth, (req, res) => {
  res.render("dashboard", {
    title: "Dashboard",
  });
});

export default router;

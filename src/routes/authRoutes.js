import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { redirectIfAuthenticated } from "../middleware/authMiddleware.js";

const router = Router();

// Login page
router.get("/login", redirectIfAuthenticated, (req, res) => {
  res.render("auth/login", {
    title: "Login",
  });
});

// Login POST handler
router.post("/login", redirectIfAuthenticated, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      req.flash("error", "Email and password are required");
      return res.redirect("/auth/login");
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      req.flash("error", error.message);
      return res.redirect("/auth/login");
    }

    // Set auth cookies
    res.cookie("sb-access-token", data.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000, // 1 hour
      sameSite: "lax",
    });
    res.cookie("sb-refresh-token", data.session.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    });

    req.flash("success", "Welcome back!");
    res.redirect("/dashboard");
  } catch (error) {
    console.error("Login error:", error);
    req.flash("error", "An error occurred during login");
    res.redirect("/auth/login");
  }
});

// Register page
router.get("/register", redirectIfAuthenticated, (req, res) => {
  res.render("auth/register", {
    title: "Register",
  });
});

// Register POST handler
router.post("/register", redirectIfAuthenticated, async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password) {
      req.flash("error", "All fields are required");
      return res.redirect("/auth/register");
    }

    if (password !== confirmPassword) {
      req.flash("error", "Passwords do not match");
      return res.redirect("/auth/register");
    }

    if (password.length < 8) {
      req.flash("error", "Password must be at least 8 characters");
      return res.redirect("/auth/register");
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
        },
      },
    });

    if (error) {
      req.flash("error", error.message);
      return res.redirect("/auth/register");
    }

    // If email confirmation is required
    if (!data.session) {
      req.flash("success", "Please check your email to confirm your account");
      return res.redirect("/auth/login");
    }

    // Set auth cookies
    res.cookie("sb-access-token", data.session.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000, // 1 hour
      sameSite: "lax",
    });
    res.cookie("sb-refresh-token", data.session.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: "lax",
    });

    req.flash("success", "Account created successfully!");
    res.redirect("/dashboard");
  } catch (error) {
    console.error("Register error:", error);
    req.flash("error", "An error occurred during registration");
    res.redirect("/auth/register");
  }
});

// Logout
router.get("/logout", async (req, res) => {
  try {
    const accessToken = req.cookies["sb-access-token"];

    if (accessToken) {
      await supabase.auth.signOut();
    }

    // Clear cookies
    res.clearCookie("sb-access-token");
    res.clearCookie("sb-refresh-token");

    req.flash("success", "You have been logged out");
    res.redirect("/");
  } catch (error) {
    console.error("Logout error:", error);
    res.clearCookie("sb-access-token");
    res.clearCookie("sb-refresh-token");
    res.redirect("/");
  }
});

export default router;

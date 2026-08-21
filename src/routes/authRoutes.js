import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { redirectIfAuthenticated } from "../middleware/authMiddleware.js";
import { setAuthCookies, clearAuthCookies, ALLOWED_OTP_TYPES } from "../utils/authUtils.js";

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
      // Check if error is due to unconfirmed email
      if (error.message.toLowerCase().includes("email not confirmed")) {
        req.flash("error", "Please confirm your email before signing in.");
        return res.redirect(`/auth/resend-confirmation?email=${encodeURIComponent(email)}`);
      }
      req.flash("error", error.message);
      return res.redirect("/auth/login");
    }

    // Set auth cookies
    setAuthCookies(res, data.session);

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

    // Build the email confirmation redirect URL
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const emailRedirectTo = `${appUrl}/auth/callback`;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
        },
        emailRedirectTo,
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
    setAuthCookies(res, data.session);

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
    clearAuthCookies(res);

    req.flash("success", "You have been logged out");
    res.redirect("/");
  } catch (error) {
    console.error("Logout error:", error);
    clearAuthCookies(res);
    res.redirect("/");
  }
});

// Email confirmation callback handler
// Supabase redirects here after user clicks the confirmation link in their email
router.get("/callback", async (req, res) => {
  try {
    // Supabase sends tokens as URL hash fragments, but for server-side we check query params
    // The token_hash and type are sent as query parameters for email confirmation
    const { token_hash, type } = req.query;

    // Validate type parameter - only allow email confirmation types
    if (!token_hash || !type || !ALLOWED_OTP_TYPES.includes(type)) {
      req.flash("error", "Invalid confirmation link. Please request a new confirmation email.");
      return res.redirect("/auth/login");
    }

    // Verify the OTP token from email confirmation
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type,
    });

    if (error) {
      console.error("Email confirmation error:", error);
      req.flash("error", "Email confirmation failed. The link may have expired.");
      return res.redirect("/auth/login");
    }

    if (data.session) {
      // Set auth cookies
      setAuthCookies(res, data.session);

      req.flash("success", "Email confirmed successfully!");
      return res.redirect("/dashboard");
    } else {
      // Email confirmed but no session returned - user should log in manually
      req.flash("success", "Email confirmed! Please log in to continue.");
      return res.redirect("/auth/login");
    }
  } catch (error) {
    console.error("Auth callback error:", error);
    req.flash("error", "An error occurred during email confirmation. Please try again.");
    return res.redirect("/auth/login");
  }
});

// Resend confirmation email page
router.get("/resend-confirmation", redirectIfAuthenticated, (req, res) => {
  const email = req.query.email || "";
  res.render("auth/resend-confirmation", {
    title: "Resend Confirmation",
    email,
  });
});

// Resend confirmation email POST handler
router.post("/resend-confirmation", redirectIfAuthenticated, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      req.flash("error", "Email is required");
      return res.redirect("/auth/resend-confirmation");
    }

    // Build the email confirmation redirect URL
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const emailRedirectTo = `${appUrl}/auth/callback`;

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo,
      },
    });

    if (error) {
      console.error("Resend confirmation error:", error);
      // Don't reveal if email exists or not for security
      req.flash("success", "If an account exists with this email, a confirmation link has been sent.");
      return res.redirect("/auth/login");
    }

    req.flash("success", "Confirmation email sent! Please check your inbox.");
    res.redirect("/auth/login");
  } catch (error) {
    console.error("Resend confirmation error:", error);
    req.flash("error", "An error occurred. Please try again.");
    res.redirect("/auth/resend-confirmation");
  }
});

export default router;

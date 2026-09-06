import { Router } from "express";
import { supabase, createSupabaseClient } from "../config/supabase.js";
import { redirectIfAuthenticated, requireAuth } from "../middleware/authMiddleware.js";
import { setAuthCookies, clearAuthCookies, ALLOWED_OTP_TYPES, RECOVERY_OTP_TYPE } from "../utils/authUtils.js";

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
        return res.redirect(`/auth/forgot-password?email=${encodeURIComponent(email)}`);
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

// Forgot password / account recovery page
// Centralized recovery page offering both "send password reset email" and
// "resend confirmation email" actions from a single email field.
router.get("/forgot-password", redirectIfAuthenticated, (req, res) => {
  const email = req.query.email || "";
  res.render("auth/forgot-password", {
    title: "Forgot Password",
    email,
  });
});

// Forgot password POST handler - sends a Supabase password reset email
router.post("/forgot-password", redirectIfAuthenticated, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      req.flash("error", "Email is required");
      return res.redirect("/auth/forgot-password");
    }

    // Build the password reset redirect URL
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const emailRedirectTo = `${appUrl}/auth/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: emailRedirectTo,
    });

    if (error) {
      console.error("Forgot password error:", error);
    }

    // Don't reveal if an account exists for this email or not for security -
    // always show the same generic message regardless of the outcome above.
    req.flash("success", "If an account exists with this email, a password reset link has been sent.");
    res.redirect("/auth/login");
  } catch (error) {
    console.error("Forgot password error:", error);
    // Enumeration-safe: same generic message even on unexpected errors.
    req.flash("success", "If an account exists with this email, a password reset link has been sent.");
    res.redirect("/auth/login");
  }
});

// Resend confirmation email page - superseded by the centralized
// /auth/forgot-password page; redirect old links there (preserving ?email=)
// instead of 404ing.
router.get("/resend-confirmation", redirectIfAuthenticated, (req, res) => {
  const { email } = req.query;
  const redirectUrl = email
    ? `/auth/forgot-password?email=${encodeURIComponent(email)}`
    : "/auth/forgot-password";
  res.redirect(302, redirectUrl);
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

// Reset password link handler
// Supabase redirects here after the user clicks the password reset link in
// their email. This is intentionally separate from /auth/callback and only
// ever accepts RECOVERY_OTP_TYPE tokens, so a recovery link can never log a
// user straight into the dashboard - it always lands on the "set a new
// password" form.
router.get("/reset-password", async (req, res) => {
  try {
    const { token_hash, type } = req.query;

    if (!token_hash || type !== RECOVERY_OTP_TYPE) {
      req.flash("error", "This password reset link is invalid or has expired. Please request a new one.");
      return res.redirect("/auth/forgot-password");
    }

    // Verify the OTP token from the password reset email
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type,
    });

    if (error || !data.session) {
      console.error("Reset password verification error:", error);
      req.flash("error", "This password reset link is invalid or has expired. Please request a new one.");
      return res.redirect("/auth/forgot-password");
    }

    // Set auth cookies so the "set a new password" form can be submitted
    setAuthCookies(res, data.session);

    // Short-lived marker cookie proving this session came from a recovery
    // link (verified above), not just any logged-in session. Checked and
    // cleared by POST /auth/reset-password so an already-logged-in user
    // can't hit that endpoint to change their password without going
    // through the recovery-email flow.
    res.cookie("recovery-session", "true", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000, // matches access token lifetime
      sameSite: "lax",
    });

    res.render("auth/reset-password", {
      title: "Reset Password",
      error: null,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    req.flash("error", "This password reset link is invalid or has expired. Please request a new one.");
    res.redirect("/auth/forgot-password");
  }
});

// Reset password POST handler - sets the new password on the
// recovery-granted session, then signs the user out so they sign back in
// fresh with the new password.
router.post("/reset-password", requireAuth, async (req, res) => {
  try {
    // Require the marker cookie set by GET /auth/reset-password so this
    // endpoint can only be reached via a valid recovery link, not by any
    // already-logged-in user with a normal session.
    if (!req.cookies["recovery-session"]) {
      req.flash("error", "This password reset link is invalid or has expired. Please request a new one.");
      return res.redirect("/auth/forgot-password");
    }

    const { password, confirmPassword } = req.body;

    if (!password || !confirmPassword) {
      return res.render("auth/reset-password", {
        title: "Reset Password",
        error: "Both password fields are required",
      });
    }

    if (password !== confirmPassword) {
      return res.render("auth/reset-password", {
        title: "Reset Password",
        error: "Passwords do not match",
      });
    }

    if (password.length < 8) {
      return res.render("auth/reset-password", {
        title: "Reset Password",
        error: "Password must be at least 8 characters",
      });
    }

    // Use a freshly-instantiated Supabase client scoped to this request
    // (not the shared module-level `supabase` singleton) so this
    // session-mutating call can't bleed into other concurrent requests on
    // the shared client.
    const requestClient = createSupabaseClient(req.accessToken);
    const refreshToken = req.refreshToken;

    const { error: sessionError } = await requestClient.auth.setSession({
      access_token: req.accessToken,
      refresh_token: refreshToken,
    });

    if (sessionError) {
      console.error("Reset password session error:", sessionError);
      return res.render("auth/reset-password", {
        title: "Reset Password",
        error: "Your session has expired. Please request a new password reset link.",
      });
    }

    const { error: updateError } = await requestClient.auth.updateUser({ password });

    if (updateError) {
      console.error("Reset password update error:", updateError);
      return res.render("auth/reset-password", {
        title: "Reset Password",
        error: updateError.message,
      });
    }

    // Clear the recovery-granted session; user signs in fresh with the new password
    clearAuthCookies(res);
    res.clearCookie("recovery-session");

    req.flash("success", "Password updated successfully! Please sign in with your new password.");
    res.redirect("/auth/login");
  } catch (error) {
    console.error("Reset password error:", error);
    res.render("auth/reset-password", {
      title: "Reset Password",
      error: "An error occurred while updating your password. Please try again.",
    });
  }
});

export default router;

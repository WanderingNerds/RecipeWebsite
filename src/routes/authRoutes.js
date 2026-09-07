import { Router } from "express";
import { supabase, createSupabaseClient } from "../config/supabase.js";
import { redirectIfAuthenticated } from "../middleware/authMiddleware.js";
import {
  setAuthCookies,
  clearAuthCookies,
  ALLOWED_OTP_TYPES,
  RECOVERY_OTP_TYPE,
  getAppUrl,
  getRecoveryErrorMessage,
  isSameOriginRequest,
  hasRecoveryAmrClaim,
} from "../utils/authUtils.js";

const router = Router();

// Short-lived (1h) httpOnly marker cookie proving the current session came
// from a verified recovery link (verifyOtp or the fragment bridge), not
// just any logged-in session. Checked and cleared by POST
// /auth/reset-password so an already-logged-in user can't hit that
// endpoint to change their password without going through the
// recovery-email flow.
function setRecoverySessionCookie(res) {
  res.cookie("recovery-session", "true", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 1000, // matches access token lifetime
    sameSite: "lax",
  });
}

function clearRecoverySessionState(res) {
  clearAuthCookies(res);
  res.clearCookie("recovery-session");
}

function renderResetPassword(res, { state, error = null, message = null }) {
  return res.render("auth/reset-password", {
    title: "Reset Password",
    state,
    error,
    message,
  });
}

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
    const emailRedirectTo = `${getAppUrl()}/auth/callback`;

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
    const emailRedirectTo = `${getAppUrl()}/auth/reset-password`;

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
    const emailRedirectTo = `${getAppUrl()}/auth/callback`;

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
//
// Handles every arrival shape so this route never dead-ends on Home (REW-57):
//   (a) token_hash + type=recovery -- the Task 2 email template's direct link.
//   (b) error / error_code query params -- Supabase (or the fragment-bridge
//       script) reporting a failure via query string instead of a fragment.
//   (c) no query params, but a still-valid recovery session already exists --
//       how the browser returns from the fragment bridge, and how a page
//       refresh on the form keeps working.
//   (d) no query params, no recovery session -- render a "checking" state
//       that gives public/js/auth-recovery.js a chance to read a URL hash
//       fragment (implicit-flow tokens) before giving up.
router.get("/reset-password", async (req, res) => {
  const { token_hash: tokenHash, type, error: errorParam, error_code: errorCode } = req.query;

  const renderInvalidLink = (code) => {
    // Never leave stale recovery/auth cookies behind on a failure path --
    // closes the "abandoned recovery attempt bounces to Home later" bug.
    clearRecoverySessionState(res);
    return renderResetPassword(res, {
      state: "error",
      message: getRecoveryErrorMessage(code),
    });
  };

  try {
    // (a) Direct token_hash link (Task 2 template path).
    if (tokenHash) {
      if (typeof tokenHash !== "string" || type !== RECOVERY_OTP_TYPE) {
        return renderInvalidLink();
      }

      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });

      if (error || !data.session) {
        console.error("Reset password verification error:", error);
        return renderInvalidLink();
      }

      // Set auth cookies so the "set a new password" form can be submitted
      setAuthCookies(res, data.session);
      setRecoverySessionCookie(res);

      return renderResetPassword(res, { state: "form" });
    }

    // (b) Forwarded/Supabase-reported error (query-string form).
    if (errorParam || errorCode) {
      return renderInvalidLink(typeof errorCode === "string" ? errorCode : undefined);
    }

    // (c) No query params -- check for an already-established, still-valid
    // recovery session (fragment bridge already ran, or a plain refresh).
    const accessToken = req.cookies["sb-access-token"];
    const hasRecoveryMarker = req.cookies["recovery-session"];

    if (hasRecoveryMarker && accessToken) {
      const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

      if (!userError && userData?.user) {
        return renderResetPassword(res, { state: "form" });
      }

      // Marker cookie present but the session it refers to is gone/invalid
      // (e.g. expired) -- treat as an expired link rather than silently
      // falling through, so the user gets an actionable error instead of a
      // "checking" state that will never resolve.
      return renderInvalidLink();
    }

    // (d) Nothing to go on yet -- give the client-side fragment reader a
    // chance to run. Real users never stay on this state: the script either
    // forwards fragment tokens to the bridge or redirects to ?error_code=...
    // `message` is only used by the <noscript> fallback in this state.
    return renderResetPassword(res, { state: "checking", message: getRecoveryErrorMessage() });
  } catch (err) {
    console.error("Reset password error:", err);
    return renderInvalidLink();
  }
});

// Fragment-to-cookie bridge for implicit-flow recovery links (REW-57).
//
// When the "Reset Password" email still uses Supabase's default
// {{ .ConfirmationURL }} (or a redirect_to isn't allow-listed), the browser
// ends up on this app with the session delivered as a URL *hash fragment*
// (#access_token=...&refresh_token=...&type=recovery) instead of a query
// string. Fragments are never sent to the server, so
// public/js/auth-recovery.js reads the fragment client-side and POSTs the
// tokens here so they can be turned into httpOnly cookies.
//
// This is the highest-risk new surface added by REW-57 (it turns
// browser-supplied tokens into session cookies), so every check below is
// mandatory -- do not relax or reorder them:
//   1. type must be exactly "recovery".
//   2. Origin (falling back to Referer) must match this app's own origin --
//      request-level defence against session injection while global CSRF
//      protection is disabled elsewhere in the app.
//   3. access_token must be accepted by supabase.auth.getUser() before any
//      cookie is set.
//   4. (recommended) the token's `amr` claim must include "recovery" so an
//      ordinary login token can't be laundered into a recovery session.
// Token values are never logged.
router.post("/reset-password/session", async (req, res) => {
  const INVALID_LINK_RESPONSE = { redirect: "/auth/reset-password?error_code=invalid_link" };

  try {
    const body = req.body || {};
    const accessToken = body.access_token;
    const refreshToken = body.refresh_token;
    const { type } = body;

    if (type !== RECOVERY_OTP_TYPE) {
      return res.status(401).json(INVALID_LINK_RESPONSE);
    }

    if (typeof accessToken !== "string" || !accessToken || typeof refreshToken !== "string" || !refreshToken) {
      return res.status(401).json(INVALID_LINK_RESPONSE);
    }

    const requestOrigin = { origin: req.get("origin"), referer: req.get("referer") };
    if (!isSameOriginRequest(requestOrigin, getAppUrl())) {
      return res.status(401).json(INVALID_LINK_RESPONSE);
    }

    // Validate the token with Supabase before trusting it for anything.
    // Uses the shared client for a stateless getUser() call only -- does
    // not call setSession() on it, so this can't bleed a session into other
    // concurrent requests.
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user) {
      return res.status(401).json(INVALID_LINK_RESPONSE);
    }

    if (!hasRecoveryAmrClaim(accessToken)) {
      return res.status(401).json(INVALID_LINK_RESPONSE);
    }

    setAuthCookies(res, { access_token: accessToken, refresh_token: refreshToken });
    setRecoverySessionCookie(res);

    return res.json({ redirect: "/auth/reset-password" });
  } catch (err) {
    // Never log token values -- log only the error message so a real
    // production failure (e.g. Supabase outage) is diagnosable from logs.
    console.error("Reset password session bridge error:", err?.message);
    return res.status(401).json(INVALID_LINK_RESPONSE);
  }
});

// Reset password POST handler - sets the new password on the
// recovery-granted session, then signs the user out so they sign back in
// fresh with the new password.
//
// Deliberately does NOT use the shared `requireAuth` middleware. On a
// failed/expired session, `requireAuth` redirects straight to
// /auth/login without clearing sb-access-token/sb-refresh-token/
// recovery-session, which would leave those cookies stale (every other
// failure branch in this route clears them via clearRecoverySessionState).
// This inline check mirrors requireAuth's cookie/getUser/refresh logic
// exactly, just with recovery-cookie cleanup added on the failure paths.
router.post("/reset-password", async (req, res) => {
  try {
    const accessToken = req.cookies["sb-access-token"];
    const refreshToken = req.cookies["sb-refresh-token"];

    if (!accessToken) {
      clearRecoverySessionState(res);
      req.flash("error", "Please log in to access this page");
      return res.redirect("/auth/login");
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(accessToken);

    if (userError || !user) {
      let refreshed = false;

      if (refreshToken) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: refreshToken,
        });

        if (!refreshError && refreshData.session) {
          setAuthCookies(res, refreshData.session);
          req.user = refreshData.user;
          req.accessToken = refreshData.session.access_token;
          req.refreshToken = refreshData.session.refresh_token;
          refreshed = true;
        }
      }

      if (!refreshed) {
        // Access token invalid/expired AND the refresh retry also failed
        // (or there was no refresh token) -- clear all recovery-specific
        // cookies before bouncing to login, same as every other failure
        // branch in this route.
        clearRecoverySessionState(res);
        req.flash("error", "Session expired. Please log in again");
        return res.redirect("/auth/login");
      }
    } else {
      req.user = user;
      req.accessToken = accessToken;
      req.refreshToken = refreshToken;
    }

    // Require the marker cookie set by GET /auth/reset-password (or the
    // fragment bridge) so this endpoint can only be reached via a valid
    // recovery link, not by any already-logged-in user with a normal
    // session. Renders the dead-end error state inline instead of
    // redirecting to /auth/forgot-password, which -- combined with
    // redirectIfAuthenticated -- used to bounce a still-logged-in user to
    // Home (REW-57 root cause 4).
    if (!req.cookies["recovery-session"]) {
      return renderResetPassword(res, {
        state: "error",
        message: getRecoveryErrorMessage(),
      });
    }

    const { password, confirmPassword } = req.body;

    if (!password || !confirmPassword) {
      return renderResetPassword(res, {
        state: "form",
        error: "Both password fields are required",
      });
    }

    if (password !== confirmPassword) {
      return renderResetPassword(res, {
        state: "form",
        error: "Passwords do not match",
      });
    }

    if (password.length < 8) {
      return renderResetPassword(res, {
        state: "form",
        error: "Password must be at least 8 characters",
      });
    }

    // Use a freshly-instantiated Supabase client scoped to this request
    // (not the shared module-level `supabase` singleton) so this
    // session-mutating call can't bleed into other concurrent requests on
    // the shared client.
    const requestClient = createSupabaseClient(req.accessToken);

    const { error: sessionError } = await requestClient.auth.setSession({
      access_token: req.accessToken,
      refresh_token: req.refreshToken,
    });

    if (sessionError) {
      console.error("Reset password session error:", sessionError);
      // Session is unusable -- clear cookies + marker before rendering the
      // expired message so an abandoned/expired attempt can't linger.
      clearRecoverySessionState(res);
      return renderResetPassword(res, {
        state: "error",
        message: "Your session has expired. Please request a new password reset link.",
      });
    }

    const { error: updateError } = await requestClient.auth.updateUser({ password });

    if (updateError) {
      console.error("Reset password update error:", updateError);
      return renderResetPassword(res, {
        state: "form",
        error: updateError.message,
      });
    }

    // Clear the recovery-granted session; user signs in fresh with the new password
    clearRecoverySessionState(res);

    req.flash("success", "Password updated successfully! Please sign in with your new password.");
    res.redirect("/auth/login");
  } catch (error) {
    console.error("Reset password error:", error);
    renderResetPassword(res, {
      state: "form",
      error: "An error occurred while updating your password. Please try again.",
    });
  }
});

export default router;

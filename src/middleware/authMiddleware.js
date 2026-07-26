import { supabase } from "../config/supabase.js";

/**
 * Middleware that requires authentication
 * Redirects to login page if not authenticated
 */
export async function requireAuth(req, res, next) {
  try {
    const accessToken = req.cookies["sb-access-token"];
    const refreshToken = req.cookies["sb-refresh-token"];

    if (!accessToken) {
      req.flash("error", "Please log in to access this page");
      return res.redirect("/auth/login");
    }

    // Set the session and get user
    const { data: { user }, error } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      // Try to refresh the session
      if (refreshToken) {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
          refresh_token: refreshToken,
        });

        if (!refreshError && refreshData.session) {
          // Set new cookies
          res.cookie("sb-access-token", refreshData.session.access_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: 60 * 60 * 1000, // 1 hour
            sameSite: "lax",
          });
          res.cookie("sb-refresh-token", refreshData.session.refresh_token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            sameSite: "lax",
          });

          req.user = refreshData.user;
          res.locals.user = refreshData.user;
          return next();
        }
      }

      req.flash("error", "Session expired. Please log in again");
      return res.redirect("/auth/login");
    }

    req.user = user;
    res.locals.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    req.flash("error", "Authentication error");
    return res.redirect("/auth/login");
  }
}

/**
 * Middleware that optionally attaches user if logged in
 * Does not redirect - allows both authenticated and unauthenticated access
 */
export async function optionalAuth(req, res, next) {
  try {
    const accessToken = req.cookies["sb-access-token"];

    if (accessToken) {
      const { data: { user }, error } = await supabase.auth.getUser(accessToken);

      if (!error && user) {
        req.user = user;
        res.locals.user = user;
        return next();
      }
    }

    req.user = null;
    res.locals.user = null;
    next();
  } catch (error) {
    req.user = null;
    res.locals.user = null;
    next();
  }
}

/**
 * Middleware that redirects authenticated users away
 * Useful for login/register pages
 */
export async function redirectIfAuthenticated(req, res, next) {
  try {
    const accessToken = req.cookies["sb-access-token"];

    if (accessToken) {
      const { data: { user }, error } = await supabase.auth.getUser(accessToken);

      if (!error && user) {
        return res.redirect("/");
      }
    }

    next();
  } catch (error) {
    next();
  }
}

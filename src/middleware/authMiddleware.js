import { supabase, createServerAuthClient } from "../config/supabase.js";
import { setAuthCookies } from "../utils/authUtils.js";
import { isAdminUser } from "../utils/adminUtils.js";

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
          setAuthCookies(res, refreshData.session);

          req.user = refreshData.user;
          req.accessToken = refreshData.session.access_token; // Attach access token for Supabase client
          req.refreshToken = refreshData.session.refresh_token; // Attach rotated refresh token for Supabase client
          res.locals.user = refreshData.user;
          return next();
        }
      }

      req.flash("error", "Session expired. Please log in again");
      return res.redirect("/auth/login");
    }

    req.user = user;
    req.accessToken = accessToken; // Attach access token for Supabase client
    req.refreshToken = refreshToken; // Attach refresh token for Supabase client
    res.locals.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    req.flash("error", "Authentication error");
    return res.redirect("/auth/login");
  }
}

export function createRequireAdmin({ createAuthClient = createServerAuthClient } = {}) {
  return async (req, res, next) => {
    try {
      const access = req.cookies["sb-access-token"];
      const refresh = req.cookies["sb-refresh-token"];
      if (!access) { req.flash("error", "Administrator sign-in is required"); return res.redirect("/admin/login"); }
      const client = createAuthClient(access);
      let token = access; let rotated = refresh;
      let { data: { user }, error } = await client.auth.getUser(access);
      if ((error || !user) && refresh) {
        const result = await client.auth.refreshSession({ refresh_token: refresh });
        if (!result.error && result.data.session) {
          user = result.data.user; token = result.data.session.access_token; rotated = result.data.session.refresh_token;
          setAuthCookies(res, result.data.session);
        }
      }
      if (!user) { req.flash("error", "Administrator sign-in is required"); return res.redirect("/admin/login"); }
      if (!isAdminUser(user)) { req.flash("error", "Administrator access is required"); return res.status(403).redirect("/admin/login"); }
      req.user = user; req.accessToken = token; req.refreshToken = rotated; res.locals.user = user; res.locals.isAdmin = true;
      return next();
    } catch (error) {
      console.error("Admin authentication failed", { name: error?.name });
      req.flash("error", "Administrator sign-in is required"); return res.redirect("/admin/login");
    }
  };
}
export const requireAdmin = createRequireAdmin();

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
        res.locals.isAdmin = isAdminUser(user);
        return next();
      }
    }

    req.user = null;
    res.locals.user = null;
    res.locals.isAdmin = false;
    next();
  } catch (error) {
    req.user = null;
    res.locals.user = null;
    res.locals.isAdmin = false;
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

/**
 * Build an API-specific auth middleware that returns JSON errors instead of
 * redirecting to the login page.
 *
 * REW-86: extracted from likeRoutes.js / mealPlanApiRoutes.js /
 * cookbookApiRoutes.js, which each carried a verbatim copy. The 401 bodies
 * are unchanged ({ error: "Authentication required" } with no token,
 * { error: "Invalid or expired session" } for a rejected one) because
 * client code branches on them.
 *
 * The auth client is injectable for the same reason createRequireAdmin's is:
 * so the token paths can be unit tested without a live Supabase.
 *
 * @param {object} [options]
 * @param {string} [options.logLabel] - prefix for the unexpected-error log,
 *   so each mount point stays distinguishable in production logs.
 * @param {object} [options.authClient] - Supabase client used to verify the
 *   access token.
 * @returns {Function} an Express middleware named `requireApiAuth`
 */
export function createRequireApiAuth({
  logLabel = "API auth error:",
  authClient = supabase,
} = {}) {
  return async function requireApiAuth(req, res, next) {
    try {
      const accessToken = req.cookies["sb-access-token"];

      if (!accessToken) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const { data: { user }, error } = await authClient.auth.getUser(accessToken);

      if (error || !user) {
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      req.user = user;
      req.accessToken = accessToken;
      next();
    } catch (error) {
      console.error(logLabel, error);
      res.status(500).json({ error: "Authentication error" });
    }
  };
}

/**
 * Default API auth middleware. Route files that want a distinct log label
 * build their own instance with createRequireApiAuth.
 */
export const requireApiAuth = createRequireApiAuth();

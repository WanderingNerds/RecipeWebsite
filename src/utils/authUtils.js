/**
 * Authentication utility functions
 */

/**
 * Set authentication cookies for a Supabase session
 * @param {Object} res - Express response object
 * @param {Object} session - Supabase session object with access_token and refresh_token
 */
export function setAuthCookies(res, session) {
  res.cookie("sb-access-token", session.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 1000, // 1 hour
    sameSite: "lax",
  });
  res.cookie("sb-refresh-token", session.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: "lax",
  });
}

/**
 * Clear authentication cookies
 * @param {Object} res - Express response object
 */
export function clearAuthCookies(res) {
  res.clearCookie("sb-access-token");
  res.clearCookie("sb-refresh-token");
}

/**
 * Valid OTP types for email confirmation
 * Only allow types that are safe for email confirmation flow
 */
export const ALLOWED_OTP_TYPES = ["signup", "email"];

/**
 * OTP type used for password recovery links.
 * Kept separate from ALLOWED_OTP_TYPES so /auth/callback never accepts a
 * recovery-type token and logs someone straight into the dashboard --
 * recovery tokens must only ever be handled by /auth/reset-password.
 */
export const RECOVERY_OTP_TYPE = "recovery";

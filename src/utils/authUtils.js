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

// Ensures the production APP_URL-missing warning below is only logged once
// per process, not once per request.
let hasWarnedMissingAppUrl = false;

/**
 * Resolve the application's own public base URL (scheme + host, no path,
 * no trailing slash) for building links that get emailed to users
 * (password reset, email confirmation, resend confirmation).
 *
 * IMPORTANT: this must never be derived from the incoming request's
 * `Host`/`X-Forwarded-Host` headers. Those are attacker-controllable, and
 * using them here would let a header-injection attack redirect password
 * reset / confirmation links to an attacker-controlled origin. Only
 * server-configured environment variables are used.
 *
 * Resolution order:
 *   1. `APP_URL` env var, trailing slash(es) stripped.
 *   2. When running on Vercel (`VERCEL` is set), `https://` +
 *      `VERCEL_PROJECT_PRODUCTION_URL` (Vercel's system env var for the
 *      project's production domain).
 *   3. `http://localhost:3000` (local dev default).
 *
 * When NODE_ENV is "production" and APP_URL is not set, a one-time
 * console.warn names which fallback was used, so a misconfigured
 * production deploy is visible in logs instead of silently emitting
 * localhost links.
 *
 * @param {NodeJS.ProcessEnv} [env] - defaults to process.env; injectable for tests
 * @returns {string} the resolved base URL, no trailing slash
 */
export function getAppUrl(env = process.env) {
  const stripTrailingSlashes = (url) => url.replace(/\/+$/, "");

  if (env.APP_URL) {
    return stripTrailingSlashes(env.APP_URL);
  }

  let fallbackUrl;
  let fallbackDescription;

  if (env.VERCEL && env.VERCEL_PROJECT_PRODUCTION_URL) {
    fallbackUrl = `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
    fallbackDescription = `VERCEL_PROJECT_PRODUCTION_URL (${fallbackUrl})`;
  } else {
    fallbackUrl = "http://localhost:3000";
    fallbackDescription = "http://localhost:3000";
  }

  if (env.NODE_ENV === "production" && !hasWarnedMissingAppUrl) {
    hasWarnedMissingAppUrl = true;
    console.warn(
      `[authUtils] APP_URL is not set in production. Falling back to ${fallbackDescription}. ` +
        "Set APP_URL to the canonical production origin so emailed links never point at the wrong host."
    );
  }

  return stripTrailingSlashes(fallbackUrl);
}

/**
 * Fixed, non-sensitive copy shown for a failed/expired recovery link.
 * Never derived from Supabase's `error_description` query param -- that
 * text is attacker/Supabase controlled and must never be echoed to the
 * page verbatim.
 */
// Object.create(null) so a malicious `error_code` like "constructor" or
// "toString" can't resolve to an inherited Object.prototype value instead
// of falling through to the generic default below.
const RECOVERY_ERROR_MESSAGES = Object.assign(Object.create(null), {
  otp_expired: "This password reset link has expired. Please request a new one.",
});

const DEFAULT_RECOVERY_ERROR_MESSAGE =
  "This password reset link is invalid or has expired. Please request a new one.";

/**
 * Map a Supabase/forwarded `error_code` query value to fixed, safe copy.
 * Unknown or missing codes fall back to a generic invalid/expired message.
 * @param {string|undefined|null} code
 * @returns {string}
 */
export function getRecoveryErrorMessage(code) {
  if (typeof code !== "string" || !code) {
    return DEFAULT_RECOVERY_ERROR_MESSAGE;
  }
  return RECOVERY_ERROR_MESSAGES[code] || DEFAULT_RECOVERY_ERROR_MESSAGE;
}

/**
 * Decide whether an email link that landed on the Home page (`?token_hash=
 * ...&type=...`, e.g. because `redirect_to` fell back to the Site URL)
 * should be forwarded to the recovery or email-confirmation handler.
 *
 * Returns a FIXED internal path (`/auth/reset-password` or `/auth/callback`)
 * carrying only the whitelisted `token_hash`/`type` params, or `null` when
 * nothing should be forwarded. This can never become an open redirect: the
 * base path is never taken from the request, and no other query params are
 * forwarded.
 *
 * @param {Object} query - req.query
 * @returns {string|null}
 */
export function getEmailLinkForwardPath(query = {}) {
  const { token_hash: tokenHash, type } = query;

  if (typeof tokenHash !== "string" || !tokenHash || typeof type !== "string" || !type) {
    return null;
  }

  const params = `token_hash=${encodeURIComponent(tokenHash)}&type=${encodeURIComponent(type)}`;

  if (type === RECOVERY_OTP_TYPE) {
    return `/auth/reset-password?${params}`;
  }

  if (ALLOWED_OTP_TYPES.includes(type)) {
    return `/auth/callback?${params}`;
  }

  return null;
}

/**
 * Check whether a request's Origin (preferred) or Referer header matches
 * the app's own origin. Used by the fragment-bridge endpoint as a
 * request-level defence against cross-origin session injection while
 * global CSRF protection is disabled.
 *
 * @param {Object} headers - { origin, referer } (already lower-cased header names)
 * @param {string} appUrl - result of getAppUrl()
 * @returns {boolean}
 */
export function isSameOriginRequest({ origin, referer } = {}, appUrl) {
  const candidate = origin || referer;
  if (!candidate || !appUrl) return false;

  try {
    const candidateOrigin = new URL(candidate).origin;
    const appOrigin = new URL(appUrl).origin;
    return candidateOrigin === appOrigin;
  } catch {
    return false;
  }
}

/**
 * Best-effort check that a validated Supabase access token's `amr`
 * (Authentication Methods Reference) claim includes a "recovery" entry,
 * so a normal login token cannot be laundered into a recovery session via
 * the fragment bridge. Must only be called on a token that has ALREADY
 * been validated via supabase.auth.getUser() -- this function does not
 * verify the JWT signature, it only inspects claims.
 *
 * @param {string} accessToken
 * @returns {boolean}
 */
export function hasRecoveryAmrClaim(accessToken) {
  if (typeof accessToken !== "string") return false;

  const parts = accessToken.split(".");
  if (parts.length !== 3) return false;

  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson);
    return Array.isArray(payload.amr) && payload.amr.some((entry) => entry && entry.method === "recovery");
  } catch {
    return false;
  }
}

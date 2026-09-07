import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_OTP_TYPES,
  RECOVERY_OTP_TYPE,
  getAppUrl,
  getRecoveryErrorMessage,
  getEmailLinkForwardPath,
  isSameOriginRequest,
  hasRecoveryAmrClaim,
} from "./authUtils.js";

test("RECOVERY_OTP_TYPE is not included in ALLOWED_OTP_TYPES", () => {
  assert.equal(ALLOWED_OTP_TYPES.includes(RECOVERY_OTP_TYPE), false);
});

// ---------------------------------------------------------------------------
// getAppUrl
// ---------------------------------------------------------------------------

test("getAppUrl returns APP_URL when set", () => {
  assert.equal(getAppUrl({ APP_URL: "https://potluck.cooking" }), "https://potluck.cooking");
});

test("getAppUrl strips a trailing slash from APP_URL", () => {
  assert.equal(getAppUrl({ APP_URL: "https://potluck.cooking/" }), "https://potluck.cooking");
});

test("getAppUrl strips multiple trailing slashes from APP_URL", () => {
  assert.equal(getAppUrl({ APP_URL: "https://potluck.cooking///" }), "https://potluck.cooking");
});

test("getAppUrl falls back to the Vercel production URL when APP_URL is unset and VERCEL is set", () => {
  const env = { VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "recipe-website.vercel.app" };
  assert.equal(getAppUrl(env), "https://recipe-website.vercel.app");
});

test("getAppUrl defaults to localhost:3000 when nothing else is set", () => {
  assert.equal(getAppUrl({}), "http://localhost:3000");
});

test("getAppUrl ignores VERCEL_PROJECT_PRODUCTION_URL when VERCEL is not set", () => {
  assert.equal(getAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: "recipe-website.vercel.app" }), "http://localhost:3000");
});

test("getAppUrl never derives the URL from request-style Host headers", () => {
  // getAppUrl only accepts an env object; passing header-shaped keys must
  // not influence the result (guards against accidentally wiring req.headers in).
  const env = { host: "evil.example.com", "x-forwarded-host": "evil.example.com" };
  assert.equal(getAppUrl(env), "http://localhost:3000");
});

// ---------------------------------------------------------------------------
// getRecoveryErrorMessage
// ---------------------------------------------------------------------------

test("getRecoveryErrorMessage maps otp_expired to an expired-link message", () => {
  assert.match(getRecoveryErrorMessage("otp_expired"), /expired/i);
});

test("getRecoveryErrorMessage maps unknown codes to the generic invalid/expired message", () => {
  assert.match(getRecoveryErrorMessage("some_unknown_code"), /invalid or has expired/i);
});

test("getRecoveryErrorMessage maps a missing code to the generic message", () => {
  assert.match(getRecoveryErrorMessage(undefined), /invalid or has expired/i);
});

// ---------------------------------------------------------------------------
// getEmailLinkForwardPath
// ---------------------------------------------------------------------------

test("getEmailLinkForwardPath forwards a recovery token_hash to /auth/reset-password", () => {
  assert.equal(
    getEmailLinkForwardPath({ token_hash: "abc", type: "recovery" }),
    "/auth/reset-password?token_hash=abc&type=recovery"
  );
});

test("getEmailLinkForwardPath forwards a signup token_hash to /auth/callback", () => {
  assert.equal(
    getEmailLinkForwardPath({ token_hash: "abc", type: "signup" }),
    "/auth/callback?token_hash=abc&type=signup"
  );
});

test("getEmailLinkForwardPath forwards an email token_hash to /auth/callback", () => {
  assert.equal(
    getEmailLinkForwardPath({ token_hash: "abc", type: "email" }),
    "/auth/callback?token_hash=abc&type=email"
  );
});

test("getEmailLinkForwardPath returns null for an unknown type", () => {
  assert.equal(getEmailLinkForwardPath({ token_hash: "abc", type: "other" }), null);
});

test("getEmailLinkForwardPath returns null when token_hash is missing", () => {
  assert.equal(getEmailLinkForwardPath({ type: "recovery" }), null);
});

test("getEmailLinkForwardPath returns null when type is missing", () => {
  assert.equal(getEmailLinkForwardPath({ token_hash: "abc" }), null);
});

test("getEmailLinkForwardPath returns null for an empty query", () => {
  assert.equal(getEmailLinkForwardPath({}), null);
});

test("getEmailLinkForwardPath drops extra query params (never forwards more than token_hash/type)", () => {
  const result = getEmailLinkForwardPath({
    token_hash: "abc",
    type: "recovery",
    redirect: "https://evil.example.com",
  });
  assert.equal(result, "/auth/reset-password?token_hash=abc&type=recovery");
  assert.ok(!result.includes("evil.example.com"));
});

test("getEmailLinkForwardPath URL-encodes the token_hash value", () => {
  const result = getEmailLinkForwardPath({ token_hash: "a b&c", type: "recovery" });
  assert.equal(result, "/auth/reset-password?token_hash=a%20b%26c&type=recovery");
});

test("getEmailLinkForwardPath rejects non-string query values (array params)", () => {
  assert.equal(getEmailLinkForwardPath({ token_hash: ["abc"], type: "recovery" }), null);
  assert.equal(getEmailLinkForwardPath({ token_hash: "abc", type: ["recovery"] }), null);
});

// ---------------------------------------------------------------------------
// isSameOriginRequest
// ---------------------------------------------------------------------------

test("isSameOriginRequest accepts a matching Origin header", () => {
  assert.equal(isSameOriginRequest({ origin: "https://potluck.cooking" }, "https://potluck.cooking"), true);
});

test("isSameOriginRequest accepts a matching Referer header when Origin is absent", () => {
  assert.equal(
    isSameOriginRequest({ referer: "https://potluck.cooking/auth/reset-password" }, "https://potluck.cooking"),
    true
  );
});

test("isSameOriginRequest rejects a cross-origin Origin header", () => {
  assert.equal(isSameOriginRequest({ origin: "https://evil.example.com" }, "https://potluck.cooking"), false);
});

test("isSameOriginRequest rejects when both headers are missing", () => {
  assert.equal(isSameOriginRequest({}, "https://potluck.cooking"), false);
});

test("isSameOriginRequest rejects a malformed Origin header", () => {
  assert.equal(isSameOriginRequest({ origin: "not-a-url" }, "https://potluck.cooking"), false);
});

// ---------------------------------------------------------------------------
// hasRecoveryAmrClaim
// ---------------------------------------------------------------------------

function makeFakeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

test("hasRecoveryAmrClaim returns true when amr contains a recovery entry", () => {
  const token = makeFakeJwt({ amr: [{ method: "recovery", timestamp: 1 }] });
  assert.equal(hasRecoveryAmrClaim(token), true);
});

test("hasRecoveryAmrClaim returns false when amr only contains password login", () => {
  const token = makeFakeJwt({ amr: [{ method: "password", timestamp: 1 }] });
  assert.equal(hasRecoveryAmrClaim(token), false);
});

test("hasRecoveryAmrClaim returns false when amr is missing", () => {
  const token = makeFakeJwt({ sub: "user-1" });
  assert.equal(hasRecoveryAmrClaim(token), false);
});

test("hasRecoveryAmrClaim returns false for a malformed token", () => {
  assert.equal(hasRecoveryAmrClaim("not-a-jwt"), false);
  assert.equal(hasRecoveryAmrClaim(""), false);
  assert.equal(hasRecoveryAmrClaim(undefined), false);
});

import test from "node:test";
import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test";
const { logoutUser } = await import("./authRoutes.js");

const response = () => ({ cleared: [], clearCookie(name) { this.cleared.push(name); return this; }, redirect(...args) { this.redirected = args; return this; } });
test("regular logout binds and revokes only the caller token pair", async () => {
  const calls = [];
  const req = { cookies: { "sb-access-token": "caller-a", "sb-refresh-token": "caller-r" }, flash: (...args) => calls.push(["flash", ...args]) };
  const res = response();
  await logoutUser(req, res, { createAuthClient: (token) => ({ auth: {
    setSession: async (session) => calls.push(["session", token, session]),
    signOut: async () => calls.push(["signout", token]),
  } }) });
  assert.deepEqual(calls.slice(0, 2), [["session", "caller-a", { access_token: "caller-a", refresh_token: "caller-r" }], ["signout", "caller-a"]]);
  assert.deepEqual(res.cleared, ["sb-access-token", "sb-refresh-token"]);
  assert.deepEqual(res.redirected, [303, "/"]);
});
test("regular logout without a complete caller session performs no implicit signout", async () => {
  let created = false; const res = response();
  await logoutUser({ cookies: { "sb-access-token": "a" }, flash() {} }, res, { createAuthClient: () => { created = true; } });
  assert.equal(created, false); assert.equal(res.cleared.length, 2);
});

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { unlink } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test";
const { default: app } = await import("./app.js");
const { csrfProtection, csrfProtectionExceptMultipart, generateCsrfToken } = await import("./middleware/csrfMiddleware.js");

const socketPath = (name) => `/tmp/rew71-${process.pid}-${name}.sock`;
const request = (socket, { path, method = "GET", headers = {}, body = "" }) => new Promise((resolve, reject) => {
  const req = http.request({ socketPath: socket, path, method, headers }, (res) => { const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); });
  req.on("error", reject); if (body) req.write(body); req.end();
});
async function withServer(serverApp, name, run, testContext) {
  const socket = socketPath(name); const server = serverApp.listen(socket);
  try { await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); }); }
  catch (error) { if (error.code === "EPERM" && testContext) { testContext.skip("sandbox forbids local HTTP listeners"); return; } throw error; }
  try { await run(socket); } finally { await new Promise((resolve) => server.close(resolve)); await unlink(socket).catch(() => {}); }
}
const csrfSession = async (socket, path = "/admin/login") => {
  const get = await request(socket, { path });
  return { token: get.body.match(/name="_csrf" value="([^"]+)/)?.[1], cookie: get.headers["set-cookie"].map((v) => v.split(";")[0]).join("; ") };
};

test("global CSRF rejects invalid urlencoded/JSON and accepts paired tokens through router chains", async (t) => withServer(app, "global", async (socket) => {
  const invalidForm = await request(socket, { path: "/help-feedback", method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "subject=x" });
  const invalidJson = await request(socket, { path: "/recipes/import/check-title", method: "POST", headers: { "content-type": "application/json" }, body: '{"title":"x"}' });
  assert.equal(invalidForm.status, 403); assert.equal(invalidJson.status, 403);
  const { token, cookie } = await csrfSession(socket); assert.ok(token);
  const validFormBody = new URLSearchParams({ _csrf: token, subject: "x" }).toString();
  const validForm = await request(socket, { path: "/help-feedback", method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(validFormBody), cookie }, body: validFormBody });
  const validJson = await request(socket, { path: "/recipes/import/check-title", method: "POST", headers: { "content-type": "application/json", "x-csrf-token": token, cookie }, body: '{"title":"x"}' });
  assert.equal(validForm.status, 302); assert.equal(validJson.status, 302);
  const logoutGet = await request(socket, { path: "/auth/logout" }); assert.equal(logoutGet.status, 404);
  const logoutPost = await request(socket, { path: "/auth/logout", method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie }, body: `_csrf=${encodeURIComponent(token)}` }); assert.equal(logoutPost.status, 303);
}, t));

test("multipart CSRF validation runs after Multer exposes the token", async (t) => {
  const multipartApp = express(); multipartApp.use(cookieParser()); multipartApp.use(csrfProtectionExceptMultipart);
  multipartApp.get("/", (req, res) => res.send(generateCsrfToken(req, res)));
  multipartApp.post("/upload", multer().none(), csrfProtection, (_req, res) => res.sendStatus(204));
  multipartApp.use((error, _req, res, _next) => res.sendStatus(error.code === "EBADCSRFTOKEN" ? 403 : 500));
  await withServer(multipartApp, "multipart", async (socket) => {
    const get = await request(socket, { path: "/" }); const cookie = get.headers["set-cookie"].map((v) => v.split(";")[0]).join("; ");
    const boundary = "rew71boundary";
    const invalid = `--${boundary}--\r\n`;
    assert.equal((await request(socket, { path: "/upload", method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie }, body: invalid })).status, 403);
    const valid = `--${boundary}\r\nContent-Disposition: form-data; name="_csrf"\r\n\r\n${get.body}\r\n--${boundary}--\r\n`;
    assert.equal((await request(socket, { path: "/upload", method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie }, body: valid })).status, 204);
  }, t);
});

test("fetch wrapper resolves Request methods and lets init override them", async () => {
  const source = await readFile(new URL("../public/js/main.js", import.meta.url), "utf8"); const calls = [];
  const context = { URL, Headers, Request, document: { querySelector: () => ({ content: "token-1" }), addEventListener() {} }, window: { location: { href: "https://potluck.test/page", origin: "https://potluck.test" }, fetch: async (input, init) => { calls.push([input, init]); } }, console };
  vm.runInNewContext(source, context);
  await context.window.fetch(new Request("https://potluck.test/api/x", { method: "POST" }));
  await context.window.fetch(new Request("https://potluck.test/api/x", { method: "POST" }), { method: "GET" });
  await context.window.fetch("https://other.test/x", { method: "POST" });
  assert.equal(calls[0][1].headers.get("x-csrf-token"), "token-1", "Request POST receives a token without init.method");
  assert.equal(calls[1][1].headers, undefined, "safe init.method overrides Request.method");
  assert.equal(calls[2][1].headers, undefined, "cross-origin unsafe request receives no token");
});

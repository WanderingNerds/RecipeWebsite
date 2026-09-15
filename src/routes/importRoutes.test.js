import test from "node:test";
import assert from "node:assert/strict";
import multer from "multer";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const importRoutes = await import("./importRoutes.js");
const {
  createSaveImportHandler,
  validateImportCookTime,
  importLimiter,
  importLimiterOptions,
  importUpload,
  handleImportUploadError,
  IMPORT_RATE_LIMIT_MAX,
  IMPORT_RATE_LIMIT_WINDOW_MS,
  MAX_IMPORT_FILE_SIZE_BYTES,
  IMPORT_RATE_LIMIT_MESSAGE,
  IMPORT_FILE_TOO_LARGE_MESSAGE,
  IMPORT_UNSUPPORTED_TYPE_MESSAGE,
  IMPORT_INVALID_UPLOAD_MESSAGE,
} = importRoutes;
const importRouter = importRoutes.default;
const { requireAuth } = await import("../middleware/authMiddleware.js");
const { csrfProtection } = await import("../middleware/csrfMiddleware.js");

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    headersSent: false,
    writableEnded: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
    // Mirrors Express: res.send(object) delegates to res.json(object), which is
    // why the limiter's object `message` reaches the client as a JSON body.
    send(body) {
      if (body !== null && typeof body === "object") return this.json(body);
      this.body = body;
      this.writableEnded = true;
      return this;
    },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
    getHeader(name) { return this.headers[String(name).toLowerCase()]; },
  };
}

// Minimal request shape express-rate-limit needs: `ip` for the default key
// generator, plus `headers`/`app` for its proxy-misconfiguration validations.
function limiterRequest(ip) {
  return {
    ip,
    headers: {},
    app: { get: () => false },
    method: "POST",
    url: "/recipes/import/parse",
  };
}

test("import Cook Time validation rejects missing and blank values", () => {
  for (const value of [undefined, null, "", "   \t\n"]) {
    assert.equal(validateImportCookTime(value), "Cook Time is required");
  }
});

test("import Cook Time validation accepts values containing non-whitespace", () => {
  assert.equal(validateImportCookTime(" 40 min "), null);
});

test("save handler rejects omitted, empty, and whitespace Cook Time before Supabase access", async () => {
  for (const cookTime of [undefined, "", " \t "]) {
    let clientCalls = 0;
    const handler = createSaveImportHandler({ createClient() { clientCalls += 1; } });
    const req = {
      body: { title: "Soup", instructions: "Simmer", cookTime },
      user: { id: "user-1" },
      accessToken: "token",
    };
    const res = responseRecorder();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "Cook Time is required" });
    assert.equal(clientCalls, 0);
  }
});

test("save handler trims Cook Time and maps Private/Public visibility", async () => {
  for (const [visibility, expectedStatus] of [["private", "draft"], ["public", "published"]]) {
    const inserted = [];
    const query = {
      select() { return this; },
      eq() { return this; },
      ilike() { return this; },
      insert(rows) { inserted.push(...rows); return this; },
      async single() {
        return inserted.length
          ? { data: { id: "recipe-1" }, error: null }
          : { data: null, error: { code: "PGRST116" } };
      },
    };
    const handler = createSaveImportHandler({ createClient: () => ({ from: () => query }) });
    const req = {
      body: {
        title: " Soup ", instructions: " Simmer ", cookTime: " 40 min ", visibility,
      },
      user: { id: "user-1", email: "cook@example.com" },
      accessToken: "token",
      flash: () => {},
    };
    const res = responseRecorder();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].cook_time, "40 min");
    assert.equal(inserted[0].status, expectedStatus);
  }
});

test("save handler fails closed to Private for tampered visibility", async () => {
  for (const visibility of [undefined, "publish", ["public"]]) {
    const inserted = [];
    const query = {
      select() { return this; }, eq() { return this; }, ilike() { return this; },
      insert(rows) { inserted.push(...rows); return this; },
      async single() { return inserted.length ? { data: { id: "recipe-1" }, error: null } : { data: null, error: { code: "PGRST116" } }; },
    };
    const handler = createSaveImportHandler({ createClient: () => ({ from: () => query }) });
    await handler({ body: { title: "Soup", instructions: "Simmer", cookTime: "40 min", visibility }, user: { id: "user-1" }, flash() {} }, responseRecorder());
    assert.equal(inserted[0].status, "draft");
  }
});

// --- REW-43: import limit values, JSON error responses, middleware-chain guard ---

test("REW-43 import limit constants have the intended values", () => {
  assert.equal(IMPORT_RATE_LIMIT_MAX, 25);
  assert.equal(IMPORT_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
  assert.equal(MAX_IMPORT_FILE_SIZE_BYTES, 4 * 1024 * 1024);
});

test("max import file size stays below Vercel's 4.5MB request-body cap", () => {
  assert.ok(
    MAX_IMPORT_FILE_SIZE_BYTES < 4.5 * 1024 * 1024,
    "import file size must stay under Vercel's FUNCTION_PAYLOAD_TOO_LARGE threshold"
  );
});

test("import limiter is configured with the literal 25-per-15-minutes policy", () => {
  assert.equal(importLimiterOptions.max, 25);
  assert.equal(importLimiterOptions.windowMs, 15 * 60 * 1000);
  assert.equal(importLimiterOptions.standardHeaders, true);
  assert.equal(importLimiterOptions.legacyHeaders, false);
  // Shared live with the constructed limiter, so it must not be mutable.
  assert.ok(Object.isFrozen(importLimiterOptions));
});

test("import limiter allows 25 requests per IP and rejects the 26th with a JSON 429", async () => {
  // Unique IP so the module-level MemoryStore is not polluted by other tests.
  const ip = "1.2.3.4";
  const outcomes = [];

  for (let attempt = 1; attempt <= 26; attempt += 1) {
    const res = responseRecorder();
    let nextCalls = 0;

    await importLimiter(limiterRequest(ip), res, () => { nextCalls += 1; });

    outcomes.push({ attempt, nextCalls, statusCode: res.statusCode, body: res.body });
  }

  const allowed = outcomes.slice(0, 25);
  const blocked = outcomes[25];

  for (const outcome of allowed) {
    assert.equal(outcome.nextCalls, 1, `request ${outcome.attempt} should reach the route handler`);
    assert.equal(outcome.body, null, `request ${outcome.attempt} should not be answered by the limiter`);
  }

  assert.equal(blocked.nextCalls, 0, "the 26th request must not reach the route handler");
  assert.equal(blocked.statusCode, 429);
  assert.deepEqual(blocked.body, { error: IMPORT_RATE_LIMIT_MESSAGE });
  assert.equal(blocked.body.error, "Too many import attempts. Please try again in 15 minutes.");
});

test("import limiter counts per IP, so one exhausted client does not block another", async () => {
  const exhausted = "5.6.7.8";
  for (let attempt = 0; attempt < IMPORT_RATE_LIMIT_MAX; attempt += 1) {
    await importLimiter(limiterRequest(exhausted), responseRecorder(), () => {});
  }

  const blockedRes = responseRecorder();
  await importLimiter(limiterRequest(exhausted), blockedRes, () => {});
  assert.equal(blockedRes.statusCode, 429);

  const otherRes = responseRecorder();
  let otherNextCalls = 0;
  await importLimiter(limiterRequest("9.9.9.9"), otherRes, () => { otherNextCalls += 1; });

  assert.equal(otherNextCalls, 1);
  assert.equal(otherRes.statusCode, 200);
});

test("import upload enforces the 4MB file size limit on the multer instance", () => {
  assert.equal(importUpload.limits.fileSize, MAX_IMPORT_FILE_SIZE_BYTES);
  assert.equal(importUpload.limits.fileSize, 4 * 1024 * 1024);
  assert.ok(
    importUpload.limits.fileSize < 4.5 * 1024 * 1024,
    "the multer limit must stay under Vercel's 4.5MB request-body cap"
  );
});

test("upload error handler converts an oversize file into a JSON 413", () => {
  const res = responseRecorder();
  let nextCalls = 0;

  handleImportUploadError(
    new multer.MulterError("LIMIT_FILE_SIZE", "file"),
    {},
    res,
    () => { nextCalls += 1; }
  );

  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, { error: "File must be under 4MB" });
  assert.equal(res.body.error, IMPORT_FILE_TOO_LARGE_MESSAGE);
  assert.equal(nextCalls, 0);
});

test("upload error handler converts other multer errors into a JSON 400", () => {
  for (const code of ["LIMIT_UNEXPECTED_FILE", "LIMIT_PART_COUNT", "LIMIT_FIELD_VALUE"]) {
    const res = responseRecorder();
    let nextCalls = 0;

    handleImportUploadError(
      new multer.MulterError(code, "file"),
      {},
      res,
      () => { nextCalls += 1; }
    );

    assert.equal(res.statusCode, 400, `${code} must be answered, not delegated`);
    assert.deepEqual(res.body, { error: IMPORT_INVALID_UPLOAD_MESSAGE });
    assert.equal(res.body.error, "Invalid upload. Please select a single recipe file.");
    assert.equal(nextCalls, 0, `${code} must not fall through to the HTML error handler`);
  }
});

test("upload error handler converts an unsupported file type into a JSON 400", () => {
  const res = responseRecorder();
  let nextCalls = 0;
  const error = new Error(IMPORT_UNSUPPORTED_TYPE_MESSAGE);
  error.code = "UNSUPPORTED_FILE_TYPE";

  handleImportUploadError(error, {}, res, () => { nextCalls += 1; });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: IMPORT_UNSUPPORTED_TYPE_MESSAGE });
  assert.equal(nextCalls, 0);
});

test("upload error handler delegates unrelated errors to the global error handler", () => {
  const res = responseRecorder();
  const passed = [];
  const unrelated = new Error("database unavailable");

  handleImportUploadError(unrelated, {}, res, (err) => { passed.push(err); });

  assert.deepEqual(passed, [unrelated]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test("POST /recipes/import/parse keeps auth, rate limiting, upload, and CSRF in order", () => {
  const layer = importRouter.stack.find(
    (entry) => entry.route && entry.route.path === "/parse" && entry.route.methods.post
  );
  assert.ok(layer, "POST /parse route must exist");

  const handles = layer.route.stack.map((entry) => entry.handle);
  const names = layer.route.stack.map((entry) => entry.name);

  const authIndex = handles.indexOf(requireAuth);
  const limiterIndex = handles.indexOf(importLimiter);
  const uploadIndex = names.indexOf("multerMiddleware");
  const uploadErrorIndex = handles.indexOf(handleImportUploadError);
  const csrfIndex = handles.indexOf(csrfProtection);

  assert.ok(authIndex >= 0, "requireAuth must stay on POST /parse");
  assert.ok(limiterIndex >= 0, "the import rate limiter must stay on POST /parse");
  assert.ok(uploadIndex >= 0, "the multer single-file middleware must stay on POST /parse");
  assert.ok(uploadErrorIndex >= 0, "the multer error handler must stay on POST /parse");
  assert.ok(csrfIndex >= 0, "csrfProtection must stay on POST /parse");

  assert.ok(
    authIndex < limiterIndex
      && limiterIndex < uploadIndex
      && uploadIndex < uploadErrorIndex
      && uploadErrorIndex < csrfIndex,
    "middleware order must remain requireAuth -> limiter -> upload -> upload error handler -> csrf"
  );
});

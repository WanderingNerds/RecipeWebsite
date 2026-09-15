import test from "node:test";
import assert from "node:assert/strict";
import multer from "multer";
import { readFile } from "node:fs/promises";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const recipeRoutes = await import("./recipeRoutes.js");
const {
  imageUpload,
  uploadLimiter,
  handleRecipeImageUploadError,
  MAX_RECIPE_IMAGE_SIZE_BYTES,
  MAX_RECIPE_IMAGE_SIZE_LABEL,
  RECIPE_IMAGE_TOO_LARGE_MESSAGE,
  RECIPE_IMAGE_NOT_AN_IMAGE_MESSAGE,
  RECIPE_IMAGE_INVALID_UPLOAD_MESSAGE,
} = recipeRoutes;
const recipeRouter = recipeRoutes.default;
const { requireAuth } = await import("../middleware/authMiddleware.js");
const { csrfProtection } = await import("../middleware/csrfMiddleware.js");
const { VERCEL_MAX_REQUEST_BODY_BYTES } = await import("../config/functionLimits.js");

const VALID_UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    redirectedTo: null,
    writableEnded: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; this.writableEnded = true; return this; },
    send(body) { this.body = body; this.writableEnded = true; return this; },
    render(view) { this.body = view; this.writableEnded = true; return this; },
    redirect(location) { this.redirectedTo = location; this.writableEnded = true; return this; },
  };
}

function flashRecorder() {
  const flashes = [];
  const streamCalls = [];
  return {
    flashes,
    streamCalls,
    req(params) {
      return {
        params: params || {},
        flash: (type, message) => { flashes.push([type, message]); },
        unpipe: () => { streamCalls.push("unpipe"); },
        resume: () => { streamCalls.push("resume"); },
      };
    },
  };
}

function multerError(code) {
  return new multer.MulterError(code, "photo");
}

// --- REW-94: the limit itself ---

test("recipe photo limit is 4MB and its label is derived from the byte value", () => {
  assert.equal(MAX_RECIPE_IMAGE_SIZE_BYTES, 4 * 1024 * 1024);
  assert.equal(MAX_RECIPE_IMAGE_SIZE_BYTES, 4194304);
  assert.equal(MAX_RECIPE_IMAGE_SIZE_LABEL, "4MB");
  assert.equal(RECIPE_IMAGE_TOO_LARGE_MESSAGE, "Photo must be under 4MB");
});

test("the live multer instance actually enforces the exported limit", () => {
  // Read off the real object the router uses, not a re-declared copy: the point
  // is that the constant and the configured limit cannot drift apart.
  assert.equal(imageUpload.limits.fileSize, MAX_RECIPE_IMAGE_SIZE_BYTES);
});

test("recipe photo limit stays strictly below Vercel's request-body cap", () => {
  assert.ok(
    MAX_RECIPE_IMAGE_SIZE_BYTES < VERCEL_MAX_REQUEST_BODY_BYTES,
    "a photo limit at or above VERCEL_MAX_REQUEST_BODY_BYTES (4.5MB) is "
      + "unreachable in production: Vercel answers FUNCTION_PAYLOAD_TOO_LARGE "
      + "before this app runs, so the user sees an opaque platform page instead "
      + "of our flashed message (REW-94)"
  );
  assert.ok(
    imageUpload.limits.fileSize < VERCEL_MAX_REQUEST_BODY_BYTES,
    "the configured multer limit must also stay below the FUNCTION_PAYLOAD_TOO_LARGE cap"
  );
});

// --- REW-94: the multer error handler ---

test("oversize upload with no :id flashes the size message and returns to /recipes/new", () => {
  const recorder = flashRecorder();
  const res = responseRecorder();
  let nextCalls = 0;

  handleRecipeImageUploadError(
    multerError("LIMIT_FILE_SIZE"),
    recorder.req(),
    res,
    () => { nextCalls += 1; }
  );

  assert.deepEqual(recorder.flashes, [["error", RECIPE_IMAGE_TOO_LARGE_MESSAGE]]);
  assert.equal(res.redirectedTo, "/recipes/new");
  assert.equal(nextCalls, 0);
});

test("oversize upload with a valid UUID :id returns to that recipe's edit page", () => {
  const recorder = flashRecorder();
  const res = responseRecorder();

  handleRecipeImageUploadError(
    multerError("LIMIT_FILE_SIZE"),
    recorder.req({ id: VALID_UUID }),
    res,
    () => { assert.fail("must not delegate a multer error"); }
  );

  assert.deepEqual(recorder.flashes, [["error", RECIPE_IMAGE_TOO_LARGE_MESSAGE]]);
  assert.equal(res.redirectedTo, `/recipes/${VALID_UUID}/edit`);
});

test("a non-UUID :id never reaches the Location header", () => {
  const hostileIds = [
    "../../evil",
    "%0d%0aSet-Cookie:+x",
    "\r\nSet-Cookie: session=stolen",
    "//evil.example.com",
    "https://evil.example.com",
    "not-a-uuid",
    "3f2504e0-4f89-41d3-9a0c-0305e82c3301extra",
  ];

  for (const id of hostileIds) {
    const recorder = flashRecorder();
    const res = responseRecorder();

    handleRecipeImageUploadError(
      multerError("LIMIT_FILE_SIZE"),
      recorder.req({ id }),
      res,
      () => { assert.fail("must not delegate a multer error"); }
    );

    assert.equal(
      res.redirectedTo,
      "/recipes",
      `a non-UUID :id (${JSON.stringify(id)}) must fall back to a fixed safe path`
    );
    assert.ok(
      !String(res.redirectedTo).includes(id),
      "the raw :id must never be reflected into the redirect target"
    );
  }
});

test("every other MulterError is answered here, not delegated", () => {
  for (const code of ["LIMIT_UNEXPECTED_FILE", "LIMIT_PART_COUNT", "LIMIT_FIELD_VALUE"]) {
    const recorder = flashRecorder();
    const res = responseRecorder();
    let nextCalls = 0;

    handleRecipeImageUploadError(
      multerError(code),
      recorder.req(),
      res,
      () => { nextCalls += 1; }
    );

    assert.deepEqual(
      recorder.flashes,
      [["error", RECIPE_IMAGE_INVALID_UPLOAD_MESSAGE]],
      `${code} must produce our own copy rather than the generic 500 page`
    );
    assert.equal(res.redirectedTo, "/recipes/new");
    assert.equal(nextCalls, 0);
  }
});

test("the fileFilter rejection flashes the not-an-image message and redirects", () => {
  const recorder = flashRecorder();
  const res = responseRecorder();
  let nextCalls = 0;
  const error = new Error(RECIPE_IMAGE_NOT_AN_IMAGE_MESSAGE);
  error.code = "UNSUPPORTED_FILE_TYPE";

  handleRecipeImageUploadError(error, recorder.req(), res, () => { nextCalls += 1; });

  assert.deepEqual(recorder.flashes, [["error", RECIPE_IMAGE_NOT_AN_IMAGE_MESSAGE]]);
  assert.equal(res.redirectedTo, "/recipes/new");
  assert.equal(nextCalls, 0);
});

test("the fileFilter still rejects non-image mimetypes and accepts image ones", () => {
  const rejections = [];
  for (const mimetype of ["application/pdf", "text/html", "application/json"]) {
    imageUpload.fileFilter({}, { mimetype }, (err, accepted) => {
      rejections.push([err && err.code, accepted]);
    });
  }
  assert.deepEqual(rejections, [
    ["UNSUPPORTED_FILE_TYPE", undefined],
    ["UNSUPPORTED_FILE_TYPE", undefined],
    ["UNSUPPORTED_FILE_TYPE", undefined],
  ]);

  const accepted = [];
  for (const mimetype of ["image/jpeg", "image/png", "image/gif", "image/webp"]) {
    imageUpload.fileFilter({}, { mimetype }, (err, ok) => { accepted.push([err, ok]); });
  }
  assert.deepEqual(accepted, [[null, true], [null, true], [null, true], [null, true]]);
});

test("the rest of the upload body is drained before the redirect is written", () => {
  // Multer aborts at the limit while the client may still be sending. Writing
  // the response into a half-read request shows up on a non-buffering host as a
  // connection reset - i.e. exactly the opaque failure REW-94 exists to remove.
  for (const error of [multerError("LIMIT_FILE_SIZE"), Object.assign(new Error("x"), { code: "UNSUPPORTED_FILE_TYPE" })]) {
    const recorder = flashRecorder();
    const res = responseRecorder();

    handleRecipeImageUploadError(error, recorder.req(), res, () => {
      assert.fail("must not delegate a rejection it answers itself");
    });

    assert.deepEqual(
      recorder.streamCalls,
      ["unpipe", "resume"],
      "the request must be unpiped and drained before res.redirect"
    );
    assert.equal(res.redirectedTo, "/recipes/new");
  }
});

test("a delegated error is left attached to the stream for the global handler", () => {
  const recorder = flashRecorder();
  const res = responseRecorder();

  handleRecipeImageUploadError(new Error("database unavailable"), recorder.req(), res, () => {});

  assert.deepEqual(
    recorder.streamCalls,
    [],
    "errors this handler does not answer must not have their request drained here"
  );
});

test("unrelated errors are delegated untouched and get no response here", () => {
  const recorder = flashRecorder();
  const res = responseRecorder();
  const passed = [];
  const unrelated = new Error("database unavailable");

  handleRecipeImageUploadError(unrelated, recorder.req(), res, (err) => { passed.push(err); });

  assert.deepEqual(passed, [unrelated]);
  assert.deepEqual(recorder.flashes, []);
  assert.equal(res.redirectedTo, null);
  assert.equal(res.writableEnded, false);
});

// --- REW-94: middleware order is a hard boundary ---

function photoRouteLayer(path) {
  return recipeRouter.stack.find(
    (entry) => entry.route && entry.route.path === path && entry.route.methods.post
  );
}

for (const path of ["/", "/:id/update"]) {
  test(`POST ${path} keeps auth, rate limiting, upload, upload error handling, and CSRF in order`, () => {
    const layer = photoRouteLayer(path);
    assert.ok(layer, `POST ${path} route must exist`);

    const handles = layer.route.stack.map((entry) => entry.handle);
    const names = layer.route.stack.map((entry) => entry.name);

    const authIndex = handles.indexOf(requireAuth);
    const limiterIndex = handles.indexOf(uploadLimiter);
    const uploadIndex = names.indexOf("multerMiddleware");
    const uploadErrorIndex = handles.indexOf(handleRecipeImageUploadError);
    const csrfIndex = handles.indexOf(csrfProtection);

    assert.ok(authIndex >= 0, `requireAuth must stay on POST ${path}`);
    assert.ok(limiterIndex >= 0, `the upload rate limiter must stay on POST ${path}`);
    assert.ok(uploadIndex >= 0, `the multer single-file middleware must stay on POST ${path}`);
    assert.ok(uploadErrorIndex >= 0, `the multer error handler must stay on POST ${path}`);
    assert.ok(csrfIndex >= 0, `csrfProtection must stay on POST ${path}`);

    assert.ok(
      authIndex < limiterIndex
        && limiterIndex < uploadIndex
        && uploadIndex < uploadErrorIndex
        && uploadErrorIndex < csrfIndex,
      "middleware order must remain requireAuth -> limiter -> upload -> upload error handler "
        + "-> csrf; csrfProtection runs after multer because it needs the parsed _csrf body field"
    );
  });
}

test("the upload rate limiter is still 10 requests per 15-minute window", async () => {
  // REW-94 explicitly leaves this policy alone; this pins it so the photo-limit
  // change cannot quietly come with a limiter change. Asserted against the
  // source because express-rate-limit does not expose its options on the
  // constructed middleware, and REW-94 is not licence to refactor the limiter
  // into an exported options object just to make it readable from a test.
  const source = await readFile(new URL("./recipeRoutes.js", import.meta.url), "utf8");
  const config = source.match(/export const uploadLimiter = rateLimit\(\{([\s\S]*?)\}\);/);

  assert.ok(config, "uploadLimiter must still be constructed in recipeRoutes.js");
  assert.match(config[1], /windowMs:\s*15 \* 60 \* 1000/);
  assert.match(config[1], /max:\s*10\b/);
});

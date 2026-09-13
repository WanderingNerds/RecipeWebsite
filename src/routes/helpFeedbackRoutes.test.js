import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { createHelpFeedbackRouter } = await import("./helpFeedbackRoutes.js");

const validBody = {
  category: "Feedback",
  subject: "  Great recipe tools  ",
  message: "  Please add pantry tracking.  ",
  contactName: "  Test Cook  ",
  contactEmail: "  cook@example.com  ",
};

const handlers = (router, method) => router.stack.find((layer) => layer.route?.path === "/" && layer.route.methods[method]).route.stack.map((layer) => layer.handle);

const response = () => {
  const output = {};
  return {
    output,
    status(code) { output.status = code; return this; },
    render(view, data) { output.view = view; output.data = data; return this; },
    redirect(...args) { output.redirect = args; return this; },
  };
};

test("GET and POST are both protected by authentication middleware", () => {
  const auth = () => {};
  const router = createHelpFeedbackRouter({ auth, createClient: () => assert.fail("unused") });
  assert.equal(handlers(router, "get")[0], auth);
  assert.equal(handlers(router, "post")[0], auth);
});

test("authentication rejects unauthenticated GET and POST before their handlers run", async () => {
  const router = createHelpFeedbackRouter();
  for (const method of ["get", "post"]) {
    const [auth] = handlers(router, method);
    const res = response();
    const flashes = [];
    let continued = false;
    await auth({ cookies: {}, flash: (...args) => flashes.push(args) }, res, () => { continued = true; });
    assert.equal(continued, false);
    assert.deepEqual(res.output.redirect, ["/auth/login"]);
    assert.deepEqual(flashes[0], ["error", "Please log in to access this page"]);
  }
});

test("GET defaults editable contact values from the authenticated user", () => {
  const router = createHelpFeedbackRouter({ auth: (_req, _res, next) => next() });
  const get = handlers(router, "get")[1];
  const res = response();
  get({ user: { email: "cook@example.com", user_metadata: { name: "Test Cook" } } }, res);
  assert.equal(res.output.view, "help-feedback");
  assert.equal(res.output.status, 200);
  assert.equal(res.output.data.values.contactName, "Test Cook");
  assert.equal(res.output.data.values.contactEmail, "cook@example.com");
});

test("invalid POST preserves normalized values and never creates a client or insert", async () => {
  let clientCreated = false;
  const router = createHelpFeedbackRouter({ auth: (_req, _res, next) => next(), createClient: () => { clientCreated = true; } });
  const post = handlers(router, "post")[1];
  const res = response();
  await post({ body: { ...validBody, category: "Not allowed", subject: "  " }, user: { id: "user-1" } }, res);
  assert.equal(clientCreated, false);
  assert.equal(res.output.status, 400);
  assert.equal(res.output.data.values.contactName, "Test Cook");
  assert.ok(res.output.data.validationErrors.category);
  assert.ok(res.output.data.validationErrors.subject);
});

test("valid POST inserts the user-owned normalized record and uses PRG with confirmation", async () => {
  const calls = [];
  const router = createHelpFeedbackRouter({
    auth: (_req, _res, next) => next(),
    createClient: (token) => ({ from: (table) => ({ insert: async (record) => { calls.push({ token, table, record }); return { error: null }; } }) }),
  });
  const post = handlers(router, "post")[1];
  const res = response();
  const flashes = [];
  await post({ body: validBody, user: { id: "user-1" }, accessToken: "access-1", flash: (...args) => flashes.push(args) }, res);
  assert.deepEqual(calls, [{ token: "access-1", table: "help_feedback_submissions", record: {
    user_id: "user-1", contact_name: "Test Cook", contact_email: "cook@example.com", category: "Feedback",
    subject: "Great recipe tools", message: "Please add pantry tracking.", status: "new",
  } }]);
  assert.deepEqual(res.output.redirect, [303, "/help-feedback"]);
  assert.equal(flashes[0][0], "success");
  assert.match(flashes[0][1], /administrator review/i);
});

test("database failures preserve values and expose only a generic message", async () => {
  const router = createHelpFeedbackRouter({ auth: (_req, _res, next) => next(), createClient: () => ({
    from: () => ({ insert: async () => ({ error: { code: "42501", message: "private database detail" } }) }),
  }) });
  const post = handlers(router, "post")[1];
  const res = response();
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    await post({ body: validBody, user: { id: "user-1" }, accessToken: "access-1" }, res);
  } finally {
    console.error = originalError;
  }
  assert.equal(res.output.status, 500);
  assert.match(res.output.data.submissionError, /try again/i);
  assert.doesNotMatch(JSON.stringify(res.output), /private database detail/);
  assert.doesNotMatch(JSON.stringify(logs), /private database detail|cook@example|pantry tracking/i);
});

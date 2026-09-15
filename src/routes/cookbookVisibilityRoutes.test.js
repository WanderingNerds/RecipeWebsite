import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { handleCookbookVisibilityUpdate } = await import("./cookbookRoutes.js");

const COOKBOOK_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function responseRecorder() {
  return {
    redirectPath: null,
    redirect(path) { this.redirectPath = path; },
  };
}

/**
 * Fake PostgREST query builder that records every call made against it, so a
 * test can assert both the value written and the filters applied without a
 * live Supabase.
 */
function fakeClient({ data = { id: COOKBOOK_ID }, error = null } = {}) {
  const calls = [];
  const tables = [];
  const query = {
    update(value) { calls.push(["update", value]); return this; },
    eq(...args) { calls.push(["eq", ...args]); return this; },
    select() { calls.push(["select"]); return this; },
    async maybeSingle() { return { data, error }; },
  };
  return {
    calls,
    tables,
    createClient: () => ({ from(table) { tables.push(table); return query; } }),
  };
}

function request(overrides = {}) {
  return {
    params: { id: COOKBOOK_ID },
    body: {},
    user: { id: "owner-1" },
    accessToken: "token",
    flash() {},
    ...overrides,
  };
}

test("visibility flips both directions from the private|public form convention", async () => {
  for (const [visibility, expected] of [["public", true], ["private", false]]) {
    const client = fakeClient();
    const res = responseRecorder();
    await handleCookbookVisibilityUpdate(request({ body: { visibility } }), res, client);

    assert.deepEqual(client.tables, ["cookbooks"]);
    assert.deepEqual(client.calls[0], ["update", { is_public: expected }]);
    assert.equal(res.redirectPath, `/cookbooks/${COOKBOOK_ID}`);
  }
});

test("every update is scoped by both id and user_id, not by RLS alone", async () => {
  for (const visibility of ["public", "private"]) {
    const client = fakeClient();
    await handleCookbookVisibilityUpdate(
      request({ body: { visibility } }),
      responseRecorder(),
      client
    );

    assert.deepEqual(
      client.calls.filter(([method]) => method === "eq"),
      [["eq", "id", COOKBOOK_ID], ["eq", "user_id", "owner-1"]]
    );
  }
});

test("an unrecognized or absent visibility value fails closed to Private", async () => {
  for (const visibility of [
    undefined,
    null,
    "",
    "PUBLIC",
    "true",
    "published",
    ["public"],
    { visibility: "public" },
    42,
  ]) {
    const client = fakeClient();
    await handleCookbookVisibilityUpdate(
      request({ body: { visibility } }),
      responseRecorder(),
      client
    );

    assert.deepEqual(
      client.calls[0],
      ["update", { is_public: false }],
      `${String(visibility)} must not make a cookbook Public`
    );
  }
});

test("a malformed cookbook id never reaches the database", async () => {
  for (const id of ["not-a-uuid", "", "../../etc/passwd", `${COOKBOOK_ID}'; DROP TABLE cookbooks;--`]) {
    const client = fakeClient();
    const res = responseRecorder();
    const flashes = [];
    await handleCookbookVisibilityUpdate(
      request({ params: { id }, body: { visibility: "public" }, flash: (...args) => flashes.push(args) }),
      res,
      client
    );

    assert.deepEqual(client.tables, [], `${id} must not open a query`);
    assert.deepEqual(client.calls, []);
    assert.equal(res.redirectPath, "/cookbooks");
    assert.equal(flashes[0][0], "error");
  }
});

test("a missing or non-owned row is reported identically and never claims success", async () => {
  for (const result of [{ data: null, error: null }, { data: null, error: { code: "PGRST116" } }]) {
    const client = fakeClient(result);
    const res = responseRecorder();
    const flashes = [];
    await handleCookbookVisibilityUpdate(
      request({ body: { visibility: "public" }, flash: (...args) => flashes.push(args) }),
      res,
      client
    );

    assert.equal(flashes.length, 1);
    assert.equal(flashes[0][0], "error");
    assert.equal(res.redirectPath, `/cookbooks/${COOKBOOK_ID}`);
  }
});

test("a not-found row is not logged as a database failure, but still reads identically", async () => {
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args);

  const flashes = [];
  try {
    // Not found / not owned: maybeSingle returns data: null with NO error
    const notFound = fakeClient({ data: null, error: null });
    const notFoundRes = responseRecorder();
    await handleCookbookVisibilityUpdate(
      request({ body: { visibility: "public" }, flash: (...args) => flashes.push(args) }),
      notFoundRes,
      notFound
    );
    assert.equal(logged.length, 0, "a legitimate not-found must not log null as a DB error");

    // A genuine database failure still gets logged
    const failure = fakeClient({ data: null, error: { message: "connection reset" } });
    await handleCookbookVisibilityUpdate(
      request({ body: { visibility: "public" }, flash: (...args) => flashes.push(args) }),
      responseRecorder(),
      failure
    );
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0][1], { message: "connection reset" });
  } finally {
    console.error = originalError;
  }

  // Both paths must be indistinguishable to the user, so a non-owner cannot
  // tell a cookbook they don't own from one that doesn't exist.
  assert.deepEqual(flashes[0], flashes[1]);
});

test("the confirming flash uses Private/Public wording, never draft/published", async () => {
  for (const [visibility, expected] of [["public", /Public/], ["private", /Private/]]) {
    const flashes = [];
    await handleCookbookVisibilityUpdate(
      request({ body: { visibility }, flash: (...args) => flashes.push(args) }),
      responseRecorder(),
      fakeClient()
    );

    assert.equal(flashes[0][0], "success");
    assert.match(flashes[0][1], expected);
    assert.doesNotMatch(flashes[0][1], /draft|published/i);
  }
});

test("the route is mounted behind requireAuth and the shared cookbook rate limiter", async () => {
  const { default: router } = await import("./cookbookRoutes.js");
  const layer = router.stack.find(
    (entry) => entry.route?.path === "/:id/visibility" && entry.route?.methods?.post
  );

  assert.ok(layer, "POST /cookbooks/:id/visibility should be registered");
  const middlewareNames = layer.route.stack.map((entry) => entry.handle.name);
  assert.ok(middlewareNames.includes("requireAuth"), "requireAuth must be in the chain");
  // express-rate-limit exposes its middleware with the internal name below;
  // asserting on count keeps this resilient if that name changes.
  assert.equal(
    layer.route.stack.length,
    3,
    "chain should be requireAuth + cookbookLimiter + handler"
  );
});

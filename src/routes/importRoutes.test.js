import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";

const { createSaveImportHandler, validateImportCookTime } = await import("./importRoutes.js");

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
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

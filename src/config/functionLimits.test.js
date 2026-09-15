import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  VERCEL_MAX_DURATION_SECONDS,
  VERCEL_MAX_DURATION_MS,
  FUNCTION_RESERVE_MS,
  OCR_TIMEOUT_MS,
} from "./functionLimits.js";

const vercelConfigUrl = new URL("../../vercel.json", import.meta.url);

async function readVercelConfig() {
  return JSON.parse(await readFile(vercelConfigUrl, "utf8"));
}

test("vercel.json still declares a maxDuration for server.js", async () => {
  const config = await readVercelConfig();

  assert.ok(config.functions, "vercel.json must declare a functions map");
  assert.ok(
    Object.prototype.hasOwnProperty.call(config.functions, "server.js"),
    'vercel.json functions map must contain a "server.js" entry - if the entry is '
      + "renamed, the maxDuration pin below would pass vacuously"
  );
  assert.equal(typeof config.functions["server.js"].maxDuration, "number");
});

test("vercel.json maxDuration matches the mirrored VERCEL_MAX_DURATION_SECONDS", async () => {
  const config = await readVercelConfig();

  assert.equal(
    config.functions["server.js"].maxDuration,
    VERCEL_MAX_DURATION_SECONDS,
    "vercel.json and src/config/functionLimits.js must be changed together"
  );
});

test("VERCEL_MAX_DURATION_MS and OCR_TIMEOUT_MS are derived, not hardcoded", () => {
  assert.equal(VERCEL_MAX_DURATION_MS, VERCEL_MAX_DURATION_SECONDS * 1000);
  assert.equal(OCR_TIMEOUT_MS, VERCEL_MAX_DURATION_MS - FUNCTION_RESERVE_MS);
});

test("OCR budget is a positive integer that leaves room under the platform deadline", () => {
  assert.ok(Number.isInteger(OCR_TIMEOUT_MS), "OCR_TIMEOUT_MS must be an integer");
  assert.ok(OCR_TIMEOUT_MS > 0, "OCR_TIMEOUT_MS must be positive");
  assert.ok(
    OCR_TIMEOUT_MS < VERCEL_MAX_DURATION_MS,
    "our timeout must fire before the platform kills the invocation"
  );
  assert.ok(
    FUNCTION_RESERVE_MS >= 1500,
    "the non-OCR reserve must stay large enough for parsing, normalization, and the response"
  );
});

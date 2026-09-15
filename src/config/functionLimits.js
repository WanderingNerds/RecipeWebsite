/**
 * Serverless invocation budget.
 *
 * Single source of truth for how long one request may spend inside the
 * deployed function, and how much of that budget the OCR step is allowed to
 * consume. Constants only: no imports, no side effects, so this module stays
 * safe to import from anywhere (including tests that do not stub Supabase
 * environment variables).
 *
 * Why the maxDuration value is mirrored here instead of read from vercel.json
 * at runtime: vercel.json is build configuration and is not guaranteed to be
 * traced into the deployed function bundle, so a runtime readFileSync or JSON
 * import could work locally and throw in production. The JS constant below is
 * the runtime source of truth and vercel.json is the platform-side mirror;
 * src/config/functionLimits.test.js reads the real vercel.json from disk (where
 * the repo root always exists) and fails if the two drift apart. Please do not
 * "improve" this into a runtime read.
 */

/**
 * Mirrors vercel.json -> functions["server.js"].maxDuration.
 *
 * Kept at 10 because 10 seconds is valid on every Vercel tier; a higher value
 * is plan-dependent and would either fail the deploy or be silently clamped,
 * reintroducing exactly the invisible mismatch this module exists to prevent.
 * Changing it means changing vercel.json in the same commit - the pinning test
 * enforces that.
 *
 * @type {number}
 */
export const VERCEL_MAX_DURATION_SECONDS = 10;

/**
 * The platform's hard kill deadline in milliseconds. Derived, never a literal.
 * @type {number}
 */
export const VERCEL_MAX_DURATION_MS = VERCEL_MAX_DURATION_SECONDS * 1000;

/**
 * Everything in the invocation that is not OCR: multipart parsing, the
 * magic-byte sniff, image normalization, unstructured-text parsing, JSON
 * serialization, and cold-start slack.
 *
 * 2000 ms is an estimate rather than a measurement; it is a named constant so
 * it can be re-tuned with a single edit. The test asserts a floor, not this
 * exact number.
 *
 * @type {number}
 */
export const FUNCTION_RESERVE_MS = 2000;

/**
 * The OCR budget: what is left of the platform deadline after the reserve.
 *
 * This is the only OCR timeout value in the codebase - src/utils/recipeImporter.js
 * imports and re-exports it. It must stay strictly below VERCEL_MAX_DURATION_MS
 * so our controlled JSON error wins the race against the platform, which would
 * otherwise return an opaque timeout page the client cannot parse.
 *
 * @type {number}
 */
export const OCR_TIMEOUT_MS = VERCEL_MAX_DURATION_MS - FUNCTION_RESERVE_MS;

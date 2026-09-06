import test from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_OTP_TYPES, RECOVERY_OTP_TYPE } from "./authUtils.js";

test("RECOVERY_OTP_TYPE is not included in ALLOWED_OTP_TYPES", () => {
  assert.equal(ALLOWED_OTP_TYPES.includes(RECOVERY_OTP_TYPE), false);
});

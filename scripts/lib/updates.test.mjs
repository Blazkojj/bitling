// Needs Node 22.18+ (imports TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewer } from "../../src/updates.ts";

test("version comparison is numeric and ignores the v prefix", () => {
  assert.equal(isNewer("v0.3.0", "0.2.0"), true);
  assert.equal(isNewer("v0.2.10", "0.2.9"), true);
  assert.equal(isNewer("v1.0.0", "1.0.0"), false);
  assert.equal(isNewer("0.1.9", "0.2.0"), false);
});

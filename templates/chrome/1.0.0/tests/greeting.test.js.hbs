import assert from "node:assert/strict";
import test from "node:test";

import { createGreeting, normalizeName } from "../src/greeting.js";

test("creates a deterministic greeting", () => {
  assert.equal(createGreeting("Ada"), "Hello, Ada!");
});

test("normalizes whitespace and uses a safe fallback", () => {
  assert.equal(normalizeName("  Grace   Hopper  "), "Grace Hopper");
  assert.equal(normalizeName("   "), "friend");
  assert.equal(normalizeName(undefined), "friend");
});

test("limits unusually long input", () => {
  const longName = "x".repeat(200);
  assert.equal(normalizeName(longName), "x".repeat(80));
});

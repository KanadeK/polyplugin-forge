import { describe, expect, it } from "vitest";

import { VERSION } from "../../src/version.js";

describe("VERSION", () => {
  it("matches the initial public release", () => {
    expect(VERSION).toBe("0.1.0");
  });
});

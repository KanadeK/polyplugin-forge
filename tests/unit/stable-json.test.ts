import { describe, expect, it } from "vitest";

import { stableJson } from "../../src/core/stable-json.js";

describe("stableJson", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const output = stableJson({
      z: [{ b: 2, a: 1 }, "last"],
      a: true,
      omitted: undefined
    });

    expect(output).toBe(
      '{\n  "a": true,\n  "z": [\n    {\n      "a": 1,\n      "b": 2\n    },\n    "last"\n  ]\n}\n'
    );
  });

  it("rejects cyclic structures instead of producing partial output", () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expect(() => stableJson(value)).toThrow("cyclic object");
  });

  it("rejects a cyclic array", () => {
    const value: unknown[] = [];
    value.push(value);

    expect(() => stableJson(value)).toThrow("cyclic array");
  });
});

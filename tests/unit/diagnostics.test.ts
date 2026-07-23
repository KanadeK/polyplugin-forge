import { describe, expect, it } from "vitest";

import {
  diagnostic,
  hasErrors,
  sortDiagnostics
} from "../../src/core/diagnostics.js";

describe("diagnostics", () => {
  it("omits absent optional fields and detects error severity", () => {
    const error = diagnostic("PPF_ERROR", "Broken");
    const warning = diagnostic(
      "PPF_WARNING",
      "Review",
      "warning",
      "plugin.yaml",
      "Use a narrower permission"
    );

    expect(error).toEqual({
      code: "PPF_ERROR",
      message: "Broken",
      severity: "error"
    });
    expect(warning.path).toBe("plugin.yaml");
    expect(warning.hint).toBe("Use a narrower permission");
    expect(hasErrors([warning])).toBe(false);
    expect(hasErrors([warning, error])).toBe(true);
  });

  it("sorts by severity, path, and code without mutating input", () => {
    const input = [
      diagnostic("B", "second", "warning", "z"),
      diagnostic("A", "first", "warning", "a"),
      diagnostic("E", "error", "error")
    ];
    const output = sortDiagnostics(input);

    expect(output.map(({ code }) => code)).toEqual(["E", "A", "B"]);
    expect(input.map(({ code }) => code)).toEqual(["B", "A", "E"]);
  });
});

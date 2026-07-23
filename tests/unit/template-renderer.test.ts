import { describe, expect, it } from "vitest";

import {
  renderTemplate,
  validateTemplateAnswers,
  validateTemplatePath
} from "../../src/core/template-renderer.js";

const answers = {
  pluginId: "hello.chrome",
  displayName: 'Hello "Chrome"',
  description: "Greets <local> users.",
  packageName: "@example/hello-chrome"
};

describe("renderTemplate", () => {
  it("renders sorted paths and JSON-safe values without HTML escaping", () => {
    const result = renderTemplate(
      "chrome",
      [
        {
          path: "z.txt.hbs",
          template: "{{displayName}}"
        },
        {
          path: "manifest.json.hbs",
          template:
            '{"name":{{json displayName}},"description":{{json description}} }\n'
        }
      ],
      answers
    );

    expect(result.files.map(({ path }) => path)).toEqual([
      "manifest.json",
      "z.txt"
    ]);
    expect(JSON.parse(result.files[0]?.content ?? "")).toEqual({
      name: 'Hello "Chrome"',
      description: "Greets <local> users."
    });
    expect(result.files[1]?.content).toBe('Hello "Chrome"');
  });

  it("rejects duplicate output paths and missing variables", () => {
    expect(() =>
      renderTemplate(
        "chrome",
        [
          { path: "same.hbs", template: "first" },
          { path: "same.hbs", template: "second" }
        ],
        answers
      )
    ).toThrow("Duplicate rendered path");
    expect(() =>
      renderTemplate(
        "chrome",
        [{ path: "missing.hbs", template: "{{unknown}}" }],
        answers
      )
    ).toThrow();
  });
});

describe("template validation", () => {
  it("rejects unsafe answers", () => {
    expect(() => {
      validateTemplateAnswers({ ...answers, pluginId: "../escape" });
    }).toThrow("pluginId");
    expect(() => {
      validateTemplateAnswers({ ...answers, packageName: "Bad Package" });
    }).toThrow("packageName");
    expect(() => {
      validateTemplateAnswers({ ...answers, description: "\u0000" });
    }).toThrow("description");
  });

  it("rejects paths that can escape or bypass rendering", () => {
    for (const path of [
      "../escape.hbs",
      "/absolute.hbs",
      "C:/drive.hbs",
      "nested\\windows.hbs",
      "plain.txt"
    ]) {
      expect(() => {
        validateTemplatePath(path);
      }).toThrow();
    }
  });
});

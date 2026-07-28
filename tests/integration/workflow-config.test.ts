import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseDocument } from "yaml";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");

const workflows = [
  {
    name: "ci.yml",
    evidence: [
      "pnpm install --frozen-lockfile --ignore-scripts",
      "npm ci",
      "npm run verify",
      "windows-latest",
      "macos-latest"
    ]
  },
  {
    name: "security.yml",
    evidence: ["npm run security:audit", "npm run security:scan"]
  },
  {
    name: "pages.yml",
    evidence: [
      "pages: write",
      "id-token: write",
      "npm run demo",
      "actions/deploy-pages@v4"
    ]
  },
  {
    name: "release.yml",
    evidence: [
      'tags:\n      - "v*"',
      "npm run package",
      "npm run release-check",
      "gh release create",
      "--verify-tag"
    ]
  }
] as const;

describe("GitHub workflow configuration", () => {
  it.each(workflows)(
    "parses $name and retains required release evidence",
    async ({ name, evidence }) => {
      const source = await readFile(
        resolve(projectRoot, ".github", "workflows", name),
        "utf8"
      );
      const normalizedSource = source.replaceAll("\r\n", "\n");
      const document = parseDocument(source, {
        schema: "core",
        strict: true,
        uniqueKeys: true
      });

      expect(document.errors).toEqual([]);
      const value = document.toJS() as unknown;
      expect(value).toBeTypeOf("object");
      expect(value).not.toBeNull();
      if (value === null || typeof value !== "object") {
        throw new Error(`${name} did not parse to an object`);
      }
      expect("jobs" in value).toBe(true);
      expect(normalizedSource).toContain("permissions:");
      expect(normalizedSource).toContain("node-version: 22");
      for (const requiredText of evidence) {
        expect(normalizedSource).toContain(requiredText);
      }
    }
  );
});

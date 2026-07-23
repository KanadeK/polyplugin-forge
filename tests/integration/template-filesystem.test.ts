import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldProject } from "../../src/adapters/template-filesystem.js";

import type { ScaffoldOptions } from "../../src/adapters/template-filesystem.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "polyplugin-template-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function options(): Promise<ScaffoldOptions> {
  const root = await temporaryDirectory();
  const templateDirectory = join(root, "template");
  const destination = join(root, "output");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(templateDirectory);
  await writeFile(
    join(templateDirectory, "package.json.hbs"),
    '{"name":{{json packageName}} }\n',
    "utf8"
  );
  return {
    templateDirectory,
    destination,
    kind: "mcp",
    version: "1.0.0",
    answers: {
      pluginId: "hello.mcp",
      displayName: "Hello MCP",
      description: "A deterministic greeting.",
      packageName: "hello-mcp"
    }
  };
}

describe("scaffoldProject", () => {
  it("writes rendered files, baseline content, answers, and hashed state", async () => {
    const scaffoldOptions = await options();
    await scaffoldProject(scaffoldOptions);

    const rendered = await readFile(
      join(scaffoldOptions.destination, "package.json"),
      "utf8"
    );
    const baseline = await readFile(
      join(
        scaffoldOptions.destination,
        ".polyplugin",
        "baseline",
        "package.json"
      ),
      "utf8"
    );
    const state = JSON.parse(
      await readFile(
        join(scaffoldOptions.destination, ".polyplugin", "state.json"),
        "utf8"
      )
    ) as { files: Record<string, string> };

    expect(JSON.parse(rendered)).toEqual({ name: "hello-mcp" });
    expect(baseline).toBe(rendered);
    expect(state.files["package.json"]).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("refuses a non-empty destination without changing its files", async () => {
    const scaffoldOptions = await options();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(scaffoldOptions.destination);
    const existing = join(scaffoldOptions.destination, "keep.txt");
    await writeFile(existing, "user content", "utf8");

    await expect(scaffoldProject(scaffoldOptions)).rejects.toThrow(
      "must be empty"
    );
    await expect(readFile(existing, "utf8")).resolves.toBe("user content");
  });
});

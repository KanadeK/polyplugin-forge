import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createProgram } from "../../src/cli.js";
import {
  CliFailure,
  collectProjectTextFiles,
  createCliContext,
  loadPluginProject,
  parseOutputFormat,
  printDiagnostics,
  readJsonObject,
  type CliContextOptions,
  resolveProcessInvocation,
  resolveProjectPath,
  validateProjectFiles
} from "../../src/commands/shared.js";

const projectRoot = resolve(import.meta.dirname, "../..");
const templatesRoot = resolve(projectRoot, "templates");
const temporaryRoots: string[] = [];

interface Invocation {
  readonly stdout: string;
  readonly stderr: string;
  readonly error: unknown;
}

interface InvokeOptions {
  readonly cwd: string;
  readonly runProcess?: NonNullable<CliContextOptions["runProcess"]>;
}

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `polyplugin-${label}-`));
  temporaryRoots.push(directory);
  return directory;
}

async function invoke(
  arguments_: readonly string[],
  options: InvokeOptions
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  let error: unknown;
  const program = createProgram({
    cwd: options.cwd,
    templatesRoot,
    now: () => new Date("2026-07-28T01:02:03.000Z"),
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
    ...(options.runProcess === undefined
      ? {}
      : { runProcess: options.runProcess }),
    exitOverride: true
  });

  try {
    await program.parseAsync(["node", "polyplugin", ...arguments_]);
  } catch (caught) {
    error = caught;
  }
  return { stdout, stderr, error };
}

async function createMcp(root: string, name = "plugin"): Promise<string> {
  const result = await invoke(
    [
      "create",
      name,
      "--template",
      "mcp",
      "--plugin-id",
      `example.${name}`,
      "--name",
      "Example MCP",
      "--description",
      "A deterministic integration fixture.",
      "--package-name",
      `example-${name}`
    ],
    { cwd: root }
  );
  expect(result.error).toBeUndefined();
  return resolve(root, name);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    })
  );
});

describe("CLI project workflows", () => {
  it("creates a real project, lints it, and rejects unsafe create requests", async () => {
    const root = await temporaryDirectory("create");
    const plugin = await createMcp(root);

    expect(await readFile(join(plugin, "plugin.yaml"), "utf8")).toContain(
      'id: "example.plugin"'
    );
    expect(
      JSON.parse(await readFile(join(plugin, ".polyplugin/state.json"), "utf8"))
    ).toMatchObject({
      template: "mcp",
      templateVersion: "1.0.0"
    });

    const lint = await invoke(["lint", "plugin", "--json"], { cwd: root });
    expect(lint.error).toBeUndefined();
    expect(JSON.parse(lint.stdout)).toMatchObject({
      command: "lint",
      ok: true,
      diagnostics: []
    });

    const occupied = await invoke(
      [
        "create",
        "plugin",
        "--template",
        "mcp",
        "--plugin-id",
        "example.occupied",
        "--name",
        "Occupied",
        "--description",
        "Must fail closed.",
        "--package-name",
        "occupied"
      ],
      { cwd: root }
    );
    expect(occupied.error).toBeInstanceOf(CliFailure);
    expect((occupied.error as Error).message).toContain(
      "Destination directory must be empty"
    );

    const invalidTarget = await invoke(
      [
        "create",
        "other",
        "--template",
        "unknown",
        "--plugin-id",
        "example.other",
        "--name",
        "Other",
        "--description",
        "Must fail closed.",
        "--package-name",
        "other"
      ],
      { cwd: root }
    );
    expect(invalidTarget.error).toMatchObject({ exitCode: 2 });
  });

  it("generates, checks, and validates a native manifest with drift failures", async () => {
    const root = await temporaryDirectory("manifest");
    const plugin = await createMcp(root);

    const generated = await invoke(
      ["manifest", "generate", "plugin", "--json"],
      { cwd: root }
    );
    expect(generated.error).toBeUndefined();
    expect(JSON.parse(generated.stdout)).toMatchObject({
      command: "manifest generate",
      ok: true,
      checked: false
    });
    expect(
      JSON.parse(await readFile(join(plugin, "server.json"), "utf8"))
    ).toMatchObject({
      name: "example.plugin"
    });

    const current = await invoke(
      ["manifest", "generate", "plugin", "--check"],
      { cwd: root }
    );
    expect(current.error).toBeUndefined();
    expect(current.stdout).toContain("Manifest is current");

    await writeFile(join(plugin, "server.json"), "{}\n", "utf8");
    const drift = await invoke(
      ["manifest", "generate", "plugin", "--check", "--json"],
      { cwd: root }
    );
    expect(drift.error).toBeInstanceOf(CliFailure);
    expect(drift.stdout).toContain("NATIVE_MANIFEST_DRIFT");

    const invalidNative = await invoke(
      ["manifest", "lint", "plugin", "--json"],
      { cwd: root }
    );
    expect(invalidNative.error).toBeInstanceOf(CliFailure);
    expect(invalidNative.stdout).toContain("PPF_NATIVE_MCP_REQUIRED");

    expect(
      (
        await invoke(["manifest", "generate", "plugin"], {
          cwd: root
        })
      ).error
    ).toBeUndefined();
    const validNative = await invoke(["manifest", "lint", "plugin"], {
      cwd: root
    });
    expect(validNative.error).toBeUndefined();
    expect(validNative.stdout).toContain("Native manifest passed");

    const missing = await invoke(["lint", "missing"], { cwd: root });
    expect(missing.error).toBeInstanceOf(CliFailure);
    expect(missing.stdout).toContain("PROJECT_MANIFEST_MISSING");
  });

  it("runs preflight commands, checks the built entry, and reports process failure", async () => {
    const root = await temporaryDirectory("preflight");
    const plugin = await createMcp(root);
    expect(
      (
        await invoke(["manifest", "generate", "plugin"], {
          cwd: root
        })
      ).error
    ).toBeUndefined();

    const calls: string[] = [];
    const successfulRunner: NonNullable<
      CliContextOptions["runProcess"]
    > = async (command, arguments_, cwd) => {
      calls.push([command, ...arguments_].join(" "));
      if (arguments_.includes("build")) {
        await mkdir(join(cwd, "dist"), { recursive: true });
        await writeFile(
          join(cwd, "dist/server.js"),
          "export const built = true;\n",
          "utf8"
        );
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const passed = await invoke(["preflight", "plugin", "--json"], {
      cwd: root,
      runProcess: successfulRunner
    });
    expect(passed.error).toBeUndefined();
    expect(JSON.parse(passed.stdout)).toMatchObject({
      command: "preflight",
      ok: true,
      capabilities: 1
    });
    expect(calls).toEqual(["npm run build", "npm test"]);
    expect(await readFile(join(plugin, "dist/server.js"), "utf8")).toContain(
      "built = true"
    );

    const failed = await invoke(["preflight", "plugin", "--json"], {
      cwd: root,
      runProcess: () =>
        Promise.resolve({
          exitCode: 17,
          stdout: "internal token must not be reported",
          stderr: "fixture failure"
        })
    });
    expect(failed.error).toBeInstanceOf(CliFailure);
    expect(failed.stdout).toContain("PREFLIGHT_BUILD_FAILED");
    expect(failed.stdout).not.toContain("internal token");
  });

  it("writes deterministic HTML, JSON, and Markdown compatibility matrices", async () => {
    const root = await temporaryDirectory("matrix");
    const catalog = resolve(
      projectRoot,
      "fixtures/compatibility-environments.yaml"
    );
    const inputs = [
      resolve(projectRoot, "examples/mcp-hello"),
      resolve(projectRoot, "examples/chrome-hello")
    ];

    const htmlPath = join(root, "matrix.html");
    const html = await invoke(
      ["matrix", ...inputs, "--catalog", catalog, "--out", htmlPath],
      { cwd: root }
    );
    expect(html.error).toBeUndefined();
    const htmlSource = await readFile(htmlPath, "utf8");
    expect(htmlSource).toContain("2026-07-28T01:02:03.000Z");
    expect(htmlSource).toContain("hello.mcp");
    expect(htmlSource).toContain("hello.chrome");

    const jsonPath = join(root, "matrix.json");
    expect(
      (
        await invoke(
          [
            "matrix",
            inputs[0] ?? "",
            "--catalog",
            catalog,
            "--out",
            jsonPath,
            "--format",
            "json"
          ],
          { cwd: root }
        )
      ).error
    ).toBeUndefined();
    expect(JSON.parse(await readFile(jsonPath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-07-28T01:02:03.000Z"
    });

    const markdownPath = join(root, "matrix.md");
    expect(
      (
        await invoke(
          [
            "matrix",
            inputs[1] ?? "",
            "--catalog",
            catalog,
            "--out",
            markdownPath
          ],
          { cwd: root }
        )
      ).error
    ).toBeUndefined();
    expect(await readFile(markdownPath, "utf8")).toContain(
      "| Plugin | Environment | Status |"
    );

    const badCatalog = join(root, "bad.yaml");
    await writeFile(badCatalog, "not: a catalog\n", "utf8");
    const invalid = await invoke(
      [
        "matrix",
        inputs[0] ?? "",
        "--catalog",
        badCatalog,
        "--out",
        join(root, "invalid.txt"),
        "--format",
        "xml"
      ],
      { cwd: root }
    );
    expect(invalid.error).toBeInstanceOf(CliFailure);
    expect((invalid.error as Error).message).toContain(
      "Invalid compatibility catalog"
    );
  });

  it("applies a clean template upgrade and preserves user-only files", async () => {
    const root = await temporaryDirectory("upgrade-clean");
    const plugin = await createMcp(root);
    await writeFile(join(plugin, "LOCAL_NOTES.md"), "keep me\n", "utf8");

    const dryRun = await invoke(
      ["upgrade", "plugin", "--to", "1.1.0", "--dry-run", "--json"],
      { cwd: root }
    );
    expect(dryRun.error).toBeUndefined();
    expect(JSON.parse(dryRun.stdout)).toMatchObject({
      command: "upgrade",
      dryRun: true,
      plan: { canApplyAtomically: true }
    });
    expect(await readFile(join(plugin, "README.md"), "utf8")).not.toContain(
      "mcp@1.1.0"
    );

    const applied = await invoke(["upgrade", "plugin", "--to", "1.1.0"], {
      cwd: root
    });
    expect(applied.error).toBeUndefined();
    expect(await readFile(join(plugin, "README.md"), "utf8")).toContain(
      "mcp@1.1.0"
    );
    expect(
      await readFile(join(plugin, "docs/TEMPLATE_UPGRADE.md"), "utf8")
    ).toContain("three-way comparison");
    expect(await readFile(join(plugin, "LOCAL_NOTES.md"), "utf8")).toBe(
      "keep me\n"
    );
    expect(
      JSON.parse(await readFile(join(plugin, ".polyplugin/state.json"), "utf8"))
    ).toMatchObject({ templateVersion: "1.1.0" });
  });

  it("never overwrites a user edit and emits three-way conflict materials", async () => {
    const root = await temporaryDirectory("upgrade-conflict");
    const plugin = await createMcp(root);
    const readmePath = join(plugin, "README.md");
    const userContent = `${await readFile(readmePath, "utf8")}\nprivate-user-edit\n`;
    await writeFile(readmePath, userContent, "utf8");

    const conflict = await invoke(
      ["upgrade", "plugin", "--to", "1.1.0", "--json"],
      { cwd: root }
    );
    expect(conflict.error).toMatchObject({ exitCode: 4 });
    expect(conflict.stdout).not.toContain("private-user-edit");
    expect(await readFile(readmePath, "utf8")).toBe(userContent);

    const conflictRoot = join(plugin, ".polyplugin/conflicts");
    expect(
      await readFile(join(conflictRoot, "README.md.current"), "utf8")
    ).toBe(userContent);
    const incoming = await readFile(
      join(conflictRoot, "README.md.incoming"),
      "utf8"
    );
    expect(incoming).toContain("mcp@1.1.0");
    expect(
      JSON.parse(await readFile(join(conflictRoot, "conflicts.json"), "utf8"))
    ).toMatchObject({
      conflicts: [{ path: "README.md", reason: "both-modified" }]
    });

    await writeFile(readmePath, incoming, "utf8");
    const continued = await invoke(
      ["upgrade", "plugin", "--to", "1.1.0", "--continue"],
      { cwd: root }
    );
    expect(continued.error).toBeUndefined();
    await expect(
      readFile(join(plugin, ".polyplugin/upgrade-pending.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(conflictRoot, "conflicts.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("handles upgrade option errors and absent-side conflict material", async () => {
    const root = await temporaryDirectory("upgrade-branches");
    const plugin = await createMcp(root);

    const incompatibleOptions = await invoke(
      ["upgrade", "plugin", "--to", "1.1.0", "--dry-run", "--continue"],
      { cwd: root }
    );
    expect(incompatibleOptions.error).toMatchObject({ exitCode: 2 });

    const humanDryRun = await invoke(
      ["upgrade", "plugin", "--to", "1.1.0", "--dry-run"],
      { cwd: root }
    );
    expect(humanDryRun.error).toBeUndefined();
    expect(humanDryRun.stdout).toContain("Upgrade dry run");

    await writeFile(
      join(plugin, "docs/TEMPLATE_UPGRADE.md"),
      "user-created upgrade notes\n",
      "utf8"
    );
    const conflict = await invoke(["upgrade", "plugin", "--to", "1.1.0"], {
      cwd: root
    });
    expect(conflict.error).toMatchObject({ exitCode: 4 });
    expect(conflict.stdout).toContain("Three-way materials were written");
    expect(
      await readFile(
        join(plugin, ".polyplugin/conflicts/docs/TEMPLATE_UPGRADE.md.base"),
        "utf8"
      )
    ).toContain("file is absent");

    const pendingPath = join(plugin, ".polyplugin/upgrade-pending.json");
    const pending = JSON.parse(await readFile(pendingPath, "utf8")) as {
      schemaVersion: 1;
      targetVersion: string;
      conflictPaths: string[];
    };
    await writeFile(
      pendingPath,
      `${JSON.stringify({ ...pending, targetVersion: "9.9.9" }, null, 2)}\n`,
      "utf8"
    );
    const mismatched = await invoke(
      ["upgrade", "plugin", "--to", "1.1.0", "--continue"],
      { cwd: root }
    );
    expect(mismatched.error).toBeInstanceOf(CliFailure);
    expect((mismatched.error as Error).message).toContain(
      "Pending upgrade targets 9.9.9"
    );

    await writeFile(
      pendingPath,
      `${JSON.stringify({ ...pending, conflictPaths: [] }, null, 2)}\n`,
      "utf8"
    );
    const unexpected = await invoke(
      ["upgrade", "plugin", "--to", "1.1.0", "--continue"],
      { cwd: root }
    );
    expect(unexpected.error).toBeInstanceOf(CliFailure);
    expect((unexpected.error as Error).message).toContain(
      "New conflicts appeared"
    );
  });
});

describe("CLI path boundary", () => {
  it("accepts contained paths and rejects traversal or absolute paths", () => {
    const root = resolve("safe-root");
    expect(resolveProjectPath(root, "nested/file.txt")).toBe(
      resolve(root, "nested/file.txt")
    );
    expect(resolveProjectPath(root, "same/../inside.txt")).toBe(
      resolve(root, "inside.txt")
    );
    for (const path of ["", "/absolute", "C:\\escape", "nested\\escape"]) {
      expect(() => resolveProjectPath(root, path)).toThrow(
        "Unsafe project-relative path"
      );
    }
    expect(() => resolveProjectPath(root, "../escape")).toThrow(
      "Path escapes project root"
    );
  });

  it("covers default context, output formatting, and invalid JSON values", async () => {
    const context = createCliContext();
    expect(context.cwd).toBe(resolve(process.cwd()));
    expect(context.templatesRoot).toBe(templatesRoot);
    expect(context.now()).toBeInstanceOf(Date);
    expect(
      resolveProcessInvocation("npm", ["test"], "win32", "C:\\npm\\npm-cli.js")
    ).toEqual({
      executable: process.execPath,
      arguments: ["C:\\npm\\npm-cli.js", "test"]
    });
    expect(
      resolveProcessInvocation("node", ["--version"], "linux", undefined)
    ).toEqual({
      executable: "node",
      arguments: ["--version"]
    });
    expect(() =>
      resolveProcessInvocation("npm", ["test"], "win32", undefined)
    ).toThrow("npm_execpath is required");

    expect(parseOutputFormat(undefined, undefined)).toBe("human");
    expect(parseOutputFormat("invalid", true)).toBe("json");
    expect(() => parseOutputFormat("xml", false)).toThrow(
      'Output format must be "human" or "json"'
    );

    let output = "";
    printDiagnostics(
      createCliContext({
        stdout: (value) => {
          output += value;
        }
      }),
      "fixture",
      [
        {
          code: "FIXTURE",
          message: "A diagnostic without a path.",
          severity: "warning",
          hint: "Use the documented value."
        }
      ],
      "human"
    );
    expect(output).toContain("WARNING FIXTURE:");
    expect(output).toContain("hint: Use the documented value.");

    const root = await temporaryDirectory("json-object");
    const arrayPath = join(root, "array.json");
    await writeFile(arrayPath, "[]\n", "utf8");
    await expect(readJsonObject(arrayPath)).rejects.toThrow(
      "must contain a JSON object"
    );
  });

  it("reports empty, malformed, oversized, and binary project files", async () => {
    const root = await temporaryDirectory("project-files");
    const pluginRoot = await createMcp(root);
    const parsed = await loadPluginProject(pluginRoot);
    expect(parsed.value).toBeDefined();
    if (parsed.value === undefined) {
      throw new Error("Generated fixture did not parse");
    }

    await writeFile(join(pluginRoot, "docs/PRIVACY.md"), " \n", "utf8");
    await writeFile(
      join(pluginRoot, "schemas/hello.input.json"),
      "{broken",
      "utf8"
    );
    await rm(join(pluginRoot, "tests/server.test.js"));
    await mkdir(join(pluginRoot, "tests/server.test.js"));
    const diagnostics = await validateProjectFiles(pluginRoot, parsed.value);
    expect(diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "PRIVACY_NOTICE_MISSING_EMPTY",
        "INPUT_SCHEMA_MISSING_JSON",
        "CAPABILITY_TEST_MISSING"
      ])
    );

    await writeFile(
      join(pluginRoot, "large.txt"),
      "x".repeat(1024 * 1024 + 1),
      "utf8"
    );
    await writeFile(join(pluginRoot, "binary.txt"), "before\0after", "utf8");
    const collected = await collectProjectTextFiles(pluginRoot);
    expect(collected.sources.map(({ path }) => path)).not.toContain(
      "large.txt"
    );
    expect(collected.sources.map(({ path }) => path)).not.toContain(
      "binary.txt"
    );
  });

  it("fails preflight before process execution when package metadata is incomplete", async () => {
    const root = await temporaryDirectory("preflight-static");
    const pluginRoot = await createMcp(root);
    expect(
      (
        await invoke(["manifest", "generate", "plugin"], {
          cwd: root
        })
      ).error
    ).toBeUndefined();

    await writeFile(
      join(pluginRoot, "package.json"),
      '{"name":"missing-build"}\n',
      "utf8"
    );
    let calls = 0;
    const missingBuild = await invoke(["preflight", "plugin", "--json"], {
      cwd: root,
      runProcess: () => {
        calls += 1;
        return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
      }
    });
    expect(missingBuild.error).toBeInstanceOf(CliFailure);
    expect(missingBuild.stdout).toContain("BUILD_COMMAND_MISSING");
    expect(calls).toBe(0);

    await writeFile(join(pluginRoot, "package.json"), "[]\n", "utf8");
    const invalidPackage = await invoke(["preflight", "plugin", "--json"], {
      cwd: root
    });
    expect(invalidPackage.error).toBeInstanceOf(CliFailure);
    expect(invalidPackage.stdout).toContain("PACKAGE_JSON_INVALID");
  });

  it("rejects matrix formats after a valid catalog and defaults unknown extensions to HTML", async () => {
    const root = await temporaryDirectory("matrix-format");
    const input = resolve(projectRoot, "examples/mcp-hello");
    const catalog = resolve(
      projectRoot,
      "fixtures/compatibility-environments.yaml"
    );
    const invalid = await invoke(
      [
        "matrix",
        input,
        "--catalog",
        catalog,
        "--out",
        join(root, "matrix.xml"),
        "--format",
        "xml"
      ],
      { cwd: root }
    );
    expect(invalid.error).toMatchObject({ exitCode: 2 });

    const defaultedPath = join(root, "matrix.output");
    const defaulted = await invoke(
      ["matrix", input, "--catalog", catalog, "--out", defaultedPath],
      { cwd: root }
    );
    expect(defaulted.error).toBeUndefined();
    expect(await readFile(defaultedPath, "utf8")).toContain("<!doctype html>");
  });
});

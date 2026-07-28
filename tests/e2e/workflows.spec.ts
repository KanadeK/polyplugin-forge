import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";

const projectRoot = resolve(import.meta.dirname, "../..");
const builtCli = resolve(projectRoot, "dist/cli.js");

interface ProcessResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function runProcess(
  executable: string,
  arguments_: readonly string[],
  cwd = projectRoot
): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      env: {
        ...process.env,
        NO_UPDATE_NOTIFIER: "1",
        npm_config_audit: "false",
        npm_config_fund: "false"
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

async function runBuiltCli(
  arguments_: readonly string[],
  cwd = projectRoot
): Promise<ProcessResult> {
  const moduleUrl = pathToFileURL(builtCli).href;
  const programArguments = JSON.stringify(arguments_);
  const source = `import { createProgram } from ${JSON.stringify(
    moduleUrl
  )}; await createProgram().parseAsync(["node", "polyplugin", ...${programArguments}]);`;
  return await runProcess(
    process.execPath,
    ["--input-type=module", "--eval", source],
    cwd
  );
}

test("built CLI exposes help and fails closed for an unknown command", async () => {
  await access(builtCli);

  const help = await runBuiltCli(["--help"]);
  expect(help.code).toBe(0);
  expect(help.stdout).toContain("Usage: polyplugin");
  expect(help.stdout).toContain("Scaffold, validate, and compare plugins");

  const invalid = await runBuiltCli(["not-a-real-command"]);
  expect(invalid.code).not.toBe(0);
  expect(invalid.stderr).toContain("unknown command");
});

test("built CLI creates, installs, manifests, tests, and builds a Chrome project", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyplugin-e2e-create-"));
  const destination = join(root, "chrome-plugin");
  try {
    const created = await runBuiltCli(
      [
        "create",
        destination,
        "--template",
        "chrome",
        "--plugin-id",
        "e2e.chrome",
        "--name",
        "E2E Chrome",
        "--description",
        "Exercises the complete generated Chrome popup flow.",
        "--package-name",
        "e2e-chrome"
      ],
      root
    );
    expect(created.code, created.stderr).toBe(0);
    expect(created.stdout).toContain("Created chrome plugin");

    const generated = await runBuiltCli(
      ["manifest", "generate", destination],
      root
    );
    expect(generated.code, generated.stderr).toBe(0);

    const npmCli = process.env["npm_execpath"];
    if (npmCli === undefined || npmCli.trim().length === 0) {
      throw new Error("npm_execpath is required for the clean install test");
    }
    const installed = await runProcess(
      process.execPath,
      [
        npmCli,
        "ci",
        "--ignore-scripts",
        "--offline",
        "--no-audit",
        "--no-fund"
      ],
      destination
    );
    expect(installed.code, installed.stderr).toBe(0);

    const preflight = await runBuiltCli(
      ["preflight", destination, "--json"],
      root
    );
    expect(preflight.code, preflight.stderr).toBe(0);
    expect(JSON.parse(preflight.stdout)).toMatchObject({
      command: "preflight",
      ok: true,
      capabilities: 2
    });

    await access(join(destination, "dist/index.js"));
    expect(
      JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"))
    ).toMatchObject({
      manifest_version: 3,
      background: {
        service_worker: "dist/index.js",
        type: "module"
      },
      action: {
        default_popup: "popup.html"
      }
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("built preflight rejects and redacts a secret before project commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "polyplugin-e2e-secret-"));
  const destination = join(root, "mcp-plugin");
  const token = `ghp_${"s".repeat(36)}`;
  try {
    const created = await runBuiltCli(
      [
        "create",
        destination,
        "--template",
        "mcp",
        "--plugin-id",
        "e2e.secret",
        "--name",
        "Secret fixture",
        "--description",
        "Proves preflight redaction.",
        "--package-name",
        "e2e-secret"
      ],
      root
    );
    expect(created.code, created.stderr).toBe(0);
    const generated = await runBuiltCli(
      ["manifest", "generate", destination],
      root
    );
    expect(generated.code, generated.stderr).toBe(0);
    await writeFile(
      join(destination, ".env"),
      `access_token="${token}"\n`,
      "utf8"
    );

    const rejected = await runBuiltCli(
      ["preflight", destination, "--json"],
      root
    );
    expect(rejected.code).not.toBe(0);
    expect(rejected.stdout).toContain("secret.github-token");
    expect(`${rejected.stdout}${rejected.stderr}`).not.toContain(token);
    await expect(
      access(join(destination, "dist/server.js"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("built matrix command exposes evidence, semantics, and responsive layout", async ({
  page
}) => {
  const root = await mkdtemp(join(tmpdir(), "polyplugin-e2e-matrix-"));
  try {
    const output = join(root, "matrix.html");
    const result = await runBuiltCli(
      [
        "matrix",
        resolve(projectRoot, "examples/chrome-hello"),
        resolve(projectRoot, "examples/webhook-hello"),
        "--catalog",
        resolve(projectRoot, "fixtures/compatibility-environments.yaml"),
        "--out",
        output
      ],
      root
    );
    expect(result.code, result.stderr).toBe(0);
    const html = await readFile(output, "utf8");
    expect(html).toContain("hello.chrome");
    expect(html).toContain("hello.webhook");

    await page.setViewportSize({ width: 680, height: 720 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "PolyPlugin compatibility matrix"
      })
    ).toBeVisible();
    await expect(page.getByRole("table")).toContainText(
      "linux-node22-chrome-126"
    );
    await expect(page.getByRole("table")).toContainText("Incompatible");
    await expect(
      page.getByRole("columnheader", { name: "Evidence" })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Plugin compatibility by deterministic environment fixture"
      )
    ).toBeVisible();

    const summaryColumns = await page
      .locator(".summary")
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length
      );
    expect(summaryColumns).toBe(2);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

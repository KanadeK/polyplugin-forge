import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { zipSync, type Zippable } from "fflate";

import { scaffoldProject } from "../src/adapters/template-filesystem.js";
import {
  generateAndValidateManifest,
  stringifyManifest
} from "../src/core/manifest-generator.js";
import { parsePluginManifest } from "../src/core/plugin-schema.js";
import { scanFilesForSecrets } from "../src/core/secret-scanner.js";
import { INITIAL_TEMPLATE_VERSION } from "../src/core/template-renderer.js";
import { renderTemplateCompatibilityMatrix } from "./demo.js";
import { TEMPLATE_CASES } from "./template-cases.js";

import type { PluginDefinition, PluginTarget } from "../src/core/model.js";

const ZIP_TIMESTAMP = new Date(1980, 0, 1, 0, 0, 0, 0);
const FILE_MODE = 0o100644 * 65_536;
const TEXT_ARCHIVE_FILE = /\.(?:css|html|js|json|md|mjs|ts|txt|yaml|yml)$/iu;

interface PackageMetadata {
  readonly name: string;
  readonly version: string;
}

export interface ArchiveEntry {
  readonly path: string;
  readonly content: Uint8Array;
}

export interface ReleaseArtifactNames {
  readonly tarball: string;
  readonly templates: Readonly<Record<PluginTarget, string>>;
  readonly matrix: string;
  readonly checksums: "SHA256SUMS.txt";
}

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

function parsePackageMetadata(value: unknown): PackageMetadata {
  if (value === null || typeof value !== "object") {
    throw new TypeError("package.json must contain an object");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["name"] !== "string" ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(record["name"]) ||
    typeof record["version"] !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(record["version"])
  ) {
    throw new TypeError("package.json name or version is invalid");
  }
  return {
    name: record["name"],
    version: record["version"]
  };
}

async function readPackageMetadata(
  projectRoot: string
): Promise<PackageMetadata> {
  return parsePackageMetadata(
    JSON.parse(
      await readFile(join(projectRoot, "package.json"), "utf8")
    ) as unknown
  );
}

export function releaseArtifactNames(
  slug: string,
  version: string
): ReleaseArtifactNames {
  const prefix = `${slug}-${version}`;
  return {
    tarball: `${prefix}-npm.tgz`,
    templates: {
      mcp: `${prefix}-template-mcp.zip`,
      vscode: `${prefix}-template-vscode.zip`,
      chrome: `${prefix}-template-chrome.zip`,
      webhook: `${prefix}-template-webhook.zip`
    },
    matrix: `${prefix}-compatibility-matrix.html`,
    checksums: "SHA256SUMS.txt"
  };
}

function validateArchivePath(path: string): void {
  if (
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path
      .split("/")
      .some(
        (segment) =>
          segment === "" ||
          segment === "." ||
          segment === ".." ||
          segment.includes(":")
      )
  ) {
    throw new TypeError(`Unsafe archive path: ${path}`);
  }
}

export function createDeterministicZip(
  entries: readonly ArchiveEntry[]
): Uint8Array {
  const archive: Zippable = {};
  const paths = new Set<string>();

  for (const entry of [...entries].sort((left, right) =>
    left.path.localeCompare(right.path)
  )) {
    validateArchivePath(entry.path);
    if (paths.has(entry.path)) {
      throw new TypeError(`Duplicate archive path: ${entry.path}`);
    }
    paths.add(entry.path);
    archive[entry.path] = [
      entry.content,
      {
        attrs: FILE_MODE,
        level: 9,
        mtime: ZIP_TIMESTAMP,
        os: 3
      }
    ];
  }

  return zipSync(archive, {
    level: 9,
    mtime: ZIP_TIMESTAMP,
    os: 3
  });
}

function npmCli(): string {
  const value = process.env["npm_execpath"];
  if (value === undefined || value.trim().length === 0) {
    throw new Error("npm_execpath is required; run packaging through npm");
  }
  return value;
}

async function run(
  executable: string,
  arguments_: readonly string[],
  cwd: string
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      env: {
        ...process.env,
        NO_UPDATE_NOTIFIER: "1",
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_update_notifier: "false"
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
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
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${executable} ${arguments_.join(" ")} failed with ${
            signal ?? `exit code ${String(code)}`
          }\n${stderr || stdout}`
        )
      );
    });
  });
}

async function runNpm(
  arguments_: readonly string[],
  cwd: string
): Promise<CommandResult> {
  return await run(process.execPath, [npmCli(), ...arguments_], cwd);
}

async function collectArchiveEntries(
  root: string,
  prefix: string
): Promise<readonly ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  const resolvedRoot = resolve(root);

  async function visit(directory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));

    for (const child of children) {
      if (child.name === "node_modules" || child.name === "npm-debug.log") {
        continue;
      }
      const absolute = resolve(directory, child.name);
      if (!absolute.startsWith(`${resolvedRoot}${sep}`)) {
        throw new Error("Archive traversal escaped the project root");
      }
      if (child.isSymbolicLink()) {
        throw new Error(`Template output contains a symlink: ${child.name}`);
      }
      if (child.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!child.isFile()) {
        throw new Error(`Unsupported template output: ${child.name}`);
      }
      const path = `${prefix}/${relative(resolvedRoot, absolute)
        .split(sep)
        .join("/")}`;
      entries.push({
        path,
        content: await readFile(absolute)
      });
    }
  }

  await visit(resolvedRoot);
  return entries;
}

function assertArchiveHasNoSecrets(
  entries: readonly ArchiveEntry[],
  kind: PluginTarget
): void {
  const diagnostics = scanFilesForSecrets(
    entries
      .filter(({ path }) => TEXT_ARCHIVE_FILE.test(path))
      .map(({ path, content }) => ({
        path,
        content: Buffer.from(content).toString("utf8")
      }))
  );
  if (diagnostics.length > 0) {
    const summary = diagnostics
      .map(({ code, path }) => `${path ?? kind}: ${code}`)
      .join("\n");
    throw new Error(
      `Potential secret in ${kind} release template:\n${summary}`
    );
  }
}

async function assertBuildOutput(project: string): Promise<void> {
  const output = join(project, "dist");
  const stats = await lstat(output);
  if (!stats.isDirectory() || (await readdir(output)).length === 0) {
    throw new Error(`Template build produced no files: ${project}`);
  }
}

async function prepareTemplate(
  projectRoot: string,
  temporaryRoot: string,
  kind: PluginTarget
): Promise<{
  readonly plugin: PluginDefinition;
  readonly project: string;
}> {
  const templateCase = TEMPLATE_CASES.find((item) => item.kind === kind);
  if (templateCase === undefined) {
    throw new Error(`Template case is missing: ${kind}`);
  }
  const project = join(temporaryRoot, kind);
  await scaffoldProject({
    templateDirectory: join(
      projectRoot,
      "templates",
      kind,
      INITIAL_TEMPLATE_VERSION
    ),
    destination: project,
    kind,
    version: INITIAL_TEMPLATE_VERSION,
    answers: templateCase.answers
  });

  const parsed = parsePluginManifest(
    await readFile(join(project, "plugin.yaml"), "utf8")
  );
  if (!parsed.ok || parsed.value === undefined) {
    throw new Error(
      `${kind} template manifest is invalid: ${parsed.diagnostics
        .map(({ code }) => code)
        .join(", ")}`
    );
  }

  let existing: Readonly<Record<string, unknown>> | undefined;
  if (kind === "vscode") {
    existing = JSON.parse(
      await readFile(join(project, "package.json"), "utf8")
    ) as Readonly<Record<string, unknown>>;
  }
  const nativeManifest = generateAndValidateManifest(parsed.value, existing);
  if (!nativeManifest.ok || nativeManifest.value === undefined) {
    throw new Error(
      `${kind} native manifest is invalid: ${nativeManifest.diagnostics
        .map(({ code }) => code)
        .join(", ")}`
    );
  }
  await writeFile(
    join(project, nativeManifest.value.fileName),
    stringifyManifest(nativeManifest.value),
    "utf8"
  );

  await runNpm(
    ["ci", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"],
    project
  );
  await runNpm(["test"], project);
  await runNpm(["run", "build"], project);
  await access(join(project, parsed.value.runtime.entry));
  await assertBuildOutput(project);

  return {
    plugin: parsed.value,
    project
  };
}

async function createNpmTarball(
  projectRoot: string,
  releaseRoot: string,
  targetName: string
): Promise<string> {
  await runNpm(
    ["pack", "--json", "--ignore-scripts", "--pack-destination", releaseRoot],
    projectRoot
  );
  const packed = (await readdir(releaseRoot)).filter((name) =>
    name.endsWith(".tgz")
  );
  if (packed.length !== 1 || packed[0] === undefined) {
    throw new Error("npm pack did not produce exactly one tarball");
  }
  const target = join(releaseRoot, targetName);
  await rename(join(releaseRoot, packed[0]), target);
  return target;
}

async function verifyInstalledTarball(
  tarball: string,
  packageName: string,
  version: string,
  temporaryRoot: string
): Promise<void> {
  const consumer = join(temporaryRoot, "tarball-consumer");
  await mkdir(consumer, { recursive: true });
  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify(
      {
        name: "polyplugin-release-smoke",
        version: "1.0.0",
        private: true
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await runNpm(
    [
      "install",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      tarball
    ],
    consumer
  );

  const packageSegments = packageName.split("/");
  const cli = join(
    consumer,
    "node_modules",
    ...packageSegments,
    "dist",
    "cli.js"
  );
  const result = await run(process.execPath, [cli, "--version"], consumer);
  if (result.stdout.trim() !== version) {
    throw new Error("Installed CLI reported an unexpected version");
  }
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function writeChecksums(
  releaseRoot: string,
  artifactNames: readonly string[]
): Promise<string> {
  const lines: string[] = [];
  for (const name of [...artifactNames].sort((left, right) =>
    left.localeCompare(right)
  )) {
    if (basename(name) !== name) {
      throw new TypeError(`Checksum entry must be a file name: ${name}`);
    }
    lines.push(`${sha256(await readFile(join(releaseRoot, name)))}  ${name}`);
  }
  const content = `${lines.join("\n")}\n`;
  await writeFile(join(releaseRoot, "SHA256SUMS.txt"), content, "utf8");
  return content;
}

export async function packageRelease(projectRoot: string): Promise<{
  readonly releaseRoot: string;
  readonly artifacts: readonly string[];
}> {
  const root = resolve(projectRoot);
  const releaseRoot = join(root, "dist-release");
  if (dirname(releaseRoot) !== root) {
    throw new Error("Refusing to replace an unexpected release directory");
  }

  const metadata = await readPackageMetadata(root);
  const names = releaseArtifactNames(metadata.name, metadata.version);
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "polyplugin-release-package-")
  );
  const artifacts: string[] = [];

  await rm(releaseRoot, { force: true, recursive: true });
  await mkdir(releaseRoot, { recursive: true });

  try {
    await runNpm(["run", "build"], root);

    const plugins: PluginDefinition[] = [];
    const testedTargets = new Set<PluginTarget>();
    for (const templateCase of TEMPLATE_CASES) {
      process.stderr.write(`Packaging ${templateCase.kind} template...\n`);
      const prepared = await prepareTemplate(
        root,
        temporaryRoot,
        templateCase.kind
      );
      plugins.push(prepared.plugin);
      testedTargets.add(templateCase.kind);

      const zipName = names.templates[templateCase.kind];
      const entries = await collectArchiveEntries(
        prepared.project,
        `${metadata.name}-${templateCase.kind}-template`
      );
      assertArchiveHasNoSecrets(entries, templateCase.kind);
      await writeFile(
        join(releaseRoot, zipName),
        createDeterministicZip(entries)
      );
      artifacts.push(zipName);
    }

    await writeFile(
      join(releaseRoot, names.matrix),
      renderTemplateCompatibilityMatrix(plugins, testedTargets),
      "utf8"
    );
    artifacts.push(names.matrix);

    const tarball = await createNpmTarball(root, releaseRoot, names.tarball);
    artifacts.push(names.tarball);
    await verifyInstalledTarball(
      tarball,
      metadata.name,
      metadata.version,
      temporaryRoot
    );

    await writeChecksums(releaseRoot, artifacts);
    artifacts.push(names.checksums);

    return {
      releaseRoot,
      artifacts: [...artifacts].sort((left, right) => left.localeCompare(right))
    };
  } finally {
    if (process.env["KEEP_RELEASE_TEMP"] !== "1") {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  const result = await packageRelease(resolve(import.meta.dirname, ".."));
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { diagnostic, hasErrors, sortDiagnostics } from "../core/diagnostics.js";
import { parsePluginManifest } from "../core/plugin-schema.js";
import { stableJson } from "../core/stable-json.js";

import type {
  Diagnostic,
  PluginDefinition,
  ValidationResult
} from "../core/model.js";
import type { SecretScanSource } from "../core/secret-scanner.js";

const MAX_SCANNED_FILE_BYTES = 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".polyplugin",
  "coverage",
  "demo-output",
  "dist",
  "dist-release",
  "node_modules"
]);

export type OutputFormat = "human" | "json";

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CliContext {
  readonly cwd: string;
  readonly templatesRoot: string;
  readonly now: () => Date;
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
  readonly runProcess: (
    command: string,
    args: readonly string[],
    cwd: string
  ) => Promise<ProcessResult>;
}

export interface CliContextOptions {
  readonly cwd?: string;
  readonly templatesRoot?: string;
  readonly now?: () => Date;
  readonly stdout?: (value: string) => void;
  readonly stderr?: (value: string) => void;
  readonly runProcess?: CliContext["runProcess"];
}

export class CliFailure extends Error {
  public readonly exitCode: number;
  public readonly reported: boolean;

  public constructor(message: string, exitCode = 1, reported = false) {
    super(message);
    this.name = "CliFailure";
    this.exitCode = exitCode;
    this.reported = reported;
  }
}

export interface ProcessInvocation {
  readonly executable: string;
  readonly arguments: readonly string[];
}

export function resolveProcessInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform,
  npmCli: string | undefined
): ProcessInvocation {
  if (platform === "win32" && command === "npm") {
    if (npmCli === undefined || npmCli.trim().length === 0) {
      throw new Error("npm_execpath is required to run npm safely on Windows");
    }
    return {
      executable: process.execPath,
      arguments: [npmCli, ...args]
    };
  }
  return { executable: command, arguments: args };
}

async function runProcess(
  command: string,
  args: readonly string[],
  cwd: string
): Promise<ProcessResult> {
  const invocation = resolveProcessInvocation(
    command,
    args,
    process.platform,
    process.env["npm_execpath"]
  );
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.executable, invocation.arguments, {
      cwd,
      env: process.env,
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
    child.once("close", (code) => {
      resolvePromise({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

export function createCliContext(options: CliContextOptions = {}): CliContext {
  return {
    cwd: resolve(options.cwd ?? process.cwd()),
    templatesRoot: resolve(
      options.templatesRoot ??
        fileURLToPath(new URL("../../templates/", import.meta.url))
    ),
    now: options.now ?? (() => new Date()),
    stdout: options.stdout ?? ((value) => process.stdout.write(value)),
    stderr: options.stderr ?? ((value) => process.stderr.write(value)),
    runProcess: options.runProcess ?? runProcess
  };
}

export function isRecord(
  value: unknown
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function resolveFrom(context: CliContext, path: string): string {
  return resolve(context.cwd, path);
}

export function resolveProjectPath(root: string, path: string): string {
  if (
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path)
  ) {
    throw new TypeError(`Unsafe project-relative path: ${path}`);
  }
  const target = resolve(root, ...path.split("/"));
  const relativePath = relative(resolve(root), target);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(root, relativePath) !== target
  ) {
    throw new TypeError(`Path escapes project root: ${path}`);
  }
  return target;
}

export async function readJsonObject(
  path: string
): Promise<Readonly<Record<string, unknown>>> {
  const source = await readFile(path, "utf8");
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) {
    throw new TypeError(`${path} must contain a JSON object`);
  }
  return value;
}

export async function writeTextAtomic(
  path: string,
  content: string
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.${String(process.pid)}.tmp`
  );
  await writeFile(temporary, content, "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "EEXIST" ||
        error.code === "EPERM" ||
        error.code === "ENOTEMPTY")
    ) {
      await rm(path, { force: true });
      await rename(temporary, path);
      return;
    }
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function loadPluginProject(
  directory: string
): Promise<ValidationResult<PluginDefinition>> {
  const manifestPath = resolve(directory, "plugin.yaml");
  let source: string;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            "PROJECT_MANIFEST_MISSING",
            "Project does not contain plugin.yaml.",
            "error",
            manifestPath
          )
        ]
      };
    }
    throw error;
  }
  return parsePluginManifest(source);
}

async function referencedFileDiagnostic(
  root: string,
  path: string,
  code: string,
  label: string,
  parseJson = false
): Promise<Diagnostic | undefined> {
  let target: string;
  try {
    target = resolveProjectPath(root, path);
  } catch {
    return diagnostic(
      `${code}_PATH`,
      `${label} must stay inside the project root.`,
      "error",
      path
    );
  }

  try {
    const stats = await lstat(target);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return diagnostic(
        code,
        `${label} must be a regular file.`,
        "error",
        path
      );
    }
    const projectRealPath = await realpath(root);
    const fileRealPath = await realpath(target);
    const containment = relative(projectRealPath, fileRealPath);
    if (
      containment === ".." ||
      containment.startsWith(`..${sep}`) ||
      resolve(projectRealPath, containment) !== fileRealPath
    ) {
      return diagnostic(
        `${code}_ESCAPE`,
        `${label} resolves outside the project root.`,
        "error",
        path
      );
    }

    const content = await readFile(target, "utf8");
    if (content.trim().length === 0) {
      return diagnostic(
        `${code}_EMPTY`,
        `${label} must not be empty.`,
        "error",
        path
      );
    }
    if (parseJson) {
      try {
        JSON.parse(content);
      } catch {
        return diagnostic(
          `${code}_JSON`,
          `${label} must contain valid JSON.`,
          "error",
          path
        );
      }
    }
    return undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return diagnostic(code, `${label} does not exist.`, "error", path);
    }
    throw error;
  }
}

export async function validateProjectFiles(
  root: string,
  plugin: PluginDefinition,
  includeBuiltEntry = false
): Promise<readonly Diagnostic[]> {
  const checks: Promise<Diagnostic | undefined>[] = [
    referencedFileDiagnostic(
      root,
      plugin.runtime.source,
      "RUNTIME_SOURCE_MISSING",
      "Runtime source"
    )
  ];
  if (includeBuiltEntry) {
    checks.push(
      referencedFileDiagnostic(
        root,
        plugin.runtime.entry,
        "RUNTIME_ENTRY_MISSING",
        "Built runtime entry"
      )
    );
  }
  if (plugin.privacy.notice.trim().length > 0) {
    checks.push(
      referencedFileDiagnostic(
        root,
        plugin.privacy.notice,
        "PRIVACY_NOTICE_MISSING",
        "Privacy notice"
      )
    );
  }
  for (const capability of plugin.capabilities) {
    for (const testPath of capability.tests) {
      checks.push(
        referencedFileDiagnostic(
          root,
          testPath,
          "CAPABILITY_TEST_MISSING",
          `Test for capability "${capability.id}"`
        )
      );
    }
    if (capability.inputSchema !== undefined) {
      checks.push(
        referencedFileDiagnostic(
          root,
          capability.inputSchema,
          "INPUT_SCHEMA_MISSING",
          `Input schema for capability "${capability.id}"`,
          true
        )
      );
    }
  }

  const diagnostics = (await Promise.all(checks)).filter(
    (item): item is Diagnostic => item !== undefined
  );
  return sortDiagnostics(diagnostics);
}

export async function collectProjectTextFiles(root: string): Promise<{
  readonly sources: readonly SecretScanSource[];
  readonly diagnostics: readonly Diagnostic[];
}> {
  const sources: SecretScanSource[] = [];
  const diagnostics: Diagnostic[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const absolute = resolve(directory, entry.name);
      const displayPath = relative(root, absolute).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        diagnostics.push(
          diagnostic(
            "PREFLIGHT_SYMLINK",
            "Preflight does not follow symbolic links.",
            "error",
            displayPath
          )
        );
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stats = await lstat(absolute);
      if (stats.size > MAX_SCANNED_FILE_BYTES) {
        continue;
      }
      const content = await readFile(absolute, "utf8");
      if (!content.includes("\0")) {
        sources.push({ path: displayPath, content });
      }
    }
  }

  await visit(root);
  return { sources, diagnostics: sortDiagnostics(diagnostics) };
}

export function parseOutputFormat(
  format: string | undefined,
  json: boolean | undefined
): OutputFormat {
  const selected = json === true ? "json" : (format ?? "human");
  if (selected !== "human" && selected !== "json") {
    throw new CliFailure('Output format must be "human" or "json".', 2);
  }
  return selected;
}

export function printDiagnostics(
  context: CliContext,
  command: string,
  diagnostics: readonly Diagnostic[],
  format: OutputFormat
): void {
  if (format === "json") {
    context.stdout(
      stableJson({
        command,
        diagnostics,
        ok: !hasErrors(diagnostics)
      })
    );
    return;
  }

  for (const item of diagnostics) {
    const path = item.path === undefined ? "" : ` ${item.path}`;
    context.stdout(
      `${item.severity.toUpperCase()} ${item.code}${path}: ${item.message}\n`
    );
    if (item.hint !== undefined) {
      context.stdout(`  hint: ${item.hint}\n`);
    }
  }
}

export function failAfterDiagnostics(
  context: CliContext,
  command: string,
  diagnostics: readonly Diagnostic[],
  format: OutputFormat
): never {
  printDiagnostics(context, command, diagnostics, format);
  throw new CliFailure(`${command} failed`, 1, true);
}

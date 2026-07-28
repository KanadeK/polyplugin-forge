import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";

import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { scaffoldProject } from "../adapters/template-filesystem.js";
import {
  evaluateCompatibilityMatrix,
  type CompatibilityEvidence
} from "../core/compatibility.js";
import { diagnostic, hasErrors, sortDiagnostics } from "../core/diagnostics.js";
import {
  generateManifest,
  stringifyManifest,
  validateNativeManifest
} from "../core/manifest-generator.js";
import {
  PLUGIN_TARGETS,
  type CompatibilityCell,
  type CompatibilityEnvironment,
  type Diagnostic,
  type ManifestOutput,
  type PluginDefinition,
  type PluginTarget
} from "../core/model.js";
import { scanFilesForSecrets } from "../core/secret-scanner.js";
import { stableJson } from "../core/stable-json.js";
import {
  INITIAL_TEMPLATE_VERSION,
  renderTemplate,
  type TemplateAnswers,
  type TemplateSourceFile
} from "../core/template-renderer.js";
import {
  planUpgrade,
  type FileSnapshot,
  type UpgradeOperation,
  type UpgradePlan
} from "../core/upgrade-planner.js";
import { renderCompatibilityHtml } from "../reporters/matrix-html.js";
import {
  CliFailure,
  collectProjectTextFiles,
  failAfterDiagnostics,
  isNodeError,
  isRecord,
  loadPluginProject,
  parseOutputFormat,
  pathExists,
  printDiagnostics,
  readJsonObject,
  resolveFrom,
  resolveProjectPath,
  validateProjectFiles,
  writeTextAtomic
} from "./shared.js";

import type { CliContext, OutputFormat } from "./shared.js";

interface FormatOptions {
  readonly format?: string;
  readonly json?: boolean;
}

interface CreateOptions {
  readonly template: string;
  readonly pluginId: string;
  readonly name: string;
  readonly description: string;
  readonly packageName: string;
  readonly templateVersion: string;
}

interface GenerateOptions extends FormatOptions {
  readonly check?: boolean;
}

interface MatrixOptions {
  readonly catalog: string;
  readonly out: string;
  readonly format?: string;
}

interface UpgradeOptions extends FormatOptions {
  readonly to: string;
  readonly dryRun?: boolean;
  readonly continue?: boolean;
}

const environmentSchema = z
  .object({
    id: z.string().min(1),
    target: z.enum(PLUGIN_TARGETS),
    targetVersion: z.string().min(1),
    node: z.string().min(1),
    os: z.enum(["linux", "darwin", "win32"]),
    arch: z.enum(["x64", "arm64"]),
    features: z.array(z.string()),
    transport: z.string().optional()
  })
  .strict();

const catalogSchema = z.array(environmentSchema).min(1);

const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    template: z.enum(PLUGIN_TARGETS),
    templateVersion: z.string().min(1),
    files: z.record(z.string(), z.string())
  })
  .strict();

const answersSchema = z
  .object({
    pluginId: z.string(),
    displayName: z.string(),
    description: z.string(),
    packageName: z.string()
  })
  .strict();

const pendingUpgradeSchema = z
  .object({
    schemaVersion: z.literal(1),
    targetVersion: z.string().min(1),
    conflictPaths: z.array(z.string())
  })
  .strict();

function target(value: string): PluginTarget {
  if (!PLUGIN_TARGETS.includes(value as PluginTarget)) {
    throw new CliFailure(
      `Template must be one of: ${PLUGIN_TARGETS.join(", ")}.`,
      2
    );
  }
  return value as PluginTarget;
}

async function requirePlugin(
  context: CliContext,
  directory: string,
  command: string,
  format: OutputFormat
): Promise<PluginDefinition> {
  const parsed = await loadPluginProject(directory);
  if (!parsed.ok || parsed.value === undefined) {
    failAfterDiagnostics(context, command, parsed.diagnostics, format);
  }
  return parsed.value;
}

function success(
  context: CliContext,
  format: OutputFormat,
  command: string,
  message: string,
  details: Readonly<Record<string, unknown>>
): void {
  if (format === "json") {
    context.stdout(stableJson({ command, ok: true, ...details }));
  } else {
    context.stdout(`${message}\n`);
  }
}

async function existingManifestForGeneration(
  plugin: PluginDefinition,
  root: string
): Promise<Readonly<Record<string, unknown>> | undefined> {
  if (plugin.target.type !== "vscode") {
    return undefined;
  }
  const packagePath = resolve(root, "package.json");
  return (await pathExists(packagePath))
    ? await readJsonObject(packagePath)
    : undefined;
}

async function expectedManifest(
  plugin: PluginDefinition,
  root: string
): Promise<ManifestOutput> {
  return generateManifest(
    plugin,
    await existingManifestForGeneration(plugin, root)
  );
}

async function readNativeManifest(
  root: string,
  output: ManifestOutput
): Promise<ManifestOutput> {
  const path = resolve(root, output.fileName);
  return {
    target: output.target,
    fileName: output.fileName,
    value: await readJsonObject(path)
  };
}

async function createCommand(
  context: CliContext,
  directory: string,
  options: CreateOptions
): Promise<void> {
  const kind = target(options.template);
  const destination = resolveFrom(context, directory);
  const templateDirectory = resolve(
    context.templatesRoot,
    kind,
    options.templateVersion
  );
  try {
    const rendered = await scaffoldProject({
      templateDirectory,
      destination,
      kind,
      version: options.templateVersion,
      answers: {
        pluginId: options.pluginId,
        displayName: options.name,
        description: options.description,
        packageName: options.packageName
      }
    });
    context.stdout(
      `Created ${kind} plugin at ${destination} (${String(rendered.files.length)} files).\n`
    );
  } catch (error) {
    throw new CliFailure(
      error instanceof Error ? error.message : "Unable to create plugin."
    );
  }
}

async function lintCommand(
  context: CliContext,
  directoryArgument: string,
  options: FormatOptions
): Promise<void> {
  const format = parseOutputFormat(options.format, options.json);
  const root = resolveFrom(context, directoryArgument);
  const parsed = await loadPluginProject(root);
  let diagnostics = [...parsed.diagnostics];
  if (parsed.value !== undefined) {
    diagnostics = [
      ...diagnostics,
      ...(await validateProjectFiles(root, parsed.value))
    ];
  }
  diagnostics = [...sortDiagnostics(diagnostics)];
  if (hasErrors(diagnostics)) {
    failAfterDiagnostics(context, "lint", diagnostics, format);
  }
  if (diagnostics.length > 0) {
    printDiagnostics(context, "lint", diagnostics, format);
  } else {
    success(context, format, "lint", `Lint passed: ${root}`, {
      directory: root,
      diagnostics: []
    });
  }
}

async function generateManifestCommand(
  context: CliContext,
  directoryArgument: string,
  options: GenerateOptions
): Promise<void> {
  const format = parseOutputFormat(options.format, options.json);
  const root = resolveFrom(context, directoryArgument);
  const plugin = await requirePlugin(
    context,
    root,
    "manifest generate",
    format
  );
  let output: ManifestOutput;
  try {
    output = await expectedManifest(plugin, root);
  } catch (error) {
    throw new CliFailure(
      error instanceof Error
        ? `Cannot read existing native manifest: ${error.message}`
        : "Cannot read existing native manifest."
    );
  }
  const diagnostics = validateNativeManifest(output);
  if (hasErrors(diagnostics)) {
    failAfterDiagnostics(context, "manifest generate", diagnostics, format);
  }

  const path = resolve(root, output.fileName);
  const expected = stringifyManifest(output);
  if (options.check === true) {
    let actual: string | undefined;
    try {
      actual = await readFile(path, "utf8");
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        throw error;
      }
    }
    if (actual !== expected) {
      failAfterDiagnostics(
        context,
        "manifest generate",
        [
          diagnostic(
            "NATIVE_MANIFEST_DRIFT",
            "Native manifest is missing or differs from generated output.",
            "error",
            path,
            "run manifest generate without --check"
          )
        ],
        format
      );
    }
    success(
      context,
      format,
      "manifest generate",
      `Manifest is current: ${path}`,
      {
        checked: true,
        file: path
      }
    );
    return;
  }

  await writeTextAtomic(path, expected);
  success(context, format, "manifest generate", `Generated ${path}`, {
    checked: false,
    file: path
  });
}

async function lintNativeManifestCommand(
  context: CliContext,
  directoryArgument: string,
  options: FormatOptions
): Promise<void> {
  const format = parseOutputFormat(options.format, options.json);
  const root = resolveFrom(context, directoryArgument);
  const plugin = await requirePlugin(context, root, "manifest lint", format);
  const shape = await expectedManifest(plugin, root);
  let actual: ManifestOutput;
  try {
    actual = await readNativeManifest(root, shape);
  } catch (error) {
    const message =
      isNodeError(error) && error.code === "ENOENT"
        ? "Native manifest does not exist."
        : "Native manifest is not valid JSON.";
    failAfterDiagnostics(
      context,
      "manifest lint",
      [
        diagnostic(
          "NATIVE_MANIFEST_UNREADABLE",
          message,
          "error",
          resolve(root, shape.fileName)
        )
      ],
      format
    );
  }
  const diagnostics = validateNativeManifest(actual);
  if (hasErrors(diagnostics)) {
    failAfterDiagnostics(context, "manifest lint", diagnostics, format);
  }
  success(
    context,
    format,
    "manifest lint",
    `Native manifest passed: ${resolve(root, actual.fileName)}`,
    { file: resolve(root, actual.fileName), diagnostics }
  );
}

async function packageBuildCommand(
  root: string
): Promise<readonly [string, ...string[]] | undefined> {
  const packageValue = await readJsonObject(resolve(root, "package.json"));
  const scripts = isRecord(packageValue["scripts"])
    ? packageValue["scripts"]
    : undefined;
  return scripts !== undefined && typeof scripts["build"] === "string"
    ? ["npm", "run", "build"]
    : undefined;
}

async function preflightCommand(
  context: CliContext,
  directoryArgument: string,
  options: FormatOptions
): Promise<void> {
  const format = parseOutputFormat(options.format, options.json);
  const root = resolveFrom(context, directoryArgument);
  const plugin = await requirePlugin(context, root, "preflight", format);
  const diagnostics: Diagnostic[] = [
    ...(await validateProjectFiles(root, plugin))
  ];
  const expected = await expectedManifest(plugin, root);
  try {
    const actual = await readNativeManifest(root, expected);
    diagnostics.push(...validateNativeManifest(actual));
    if (
      (await readFile(resolve(root, expected.fileName), "utf8")) !==
      stringifyManifest(expected)
    ) {
      diagnostics.push(
        diagnostic(
          "NATIVE_MANIFEST_DRIFT",
          "Native manifest differs from generated output.",
          "error",
          resolve(root, expected.fileName)
        )
      );
    }
  } catch {
    diagnostics.push(
      diagnostic(
        "NATIVE_MANIFEST_UNREADABLE",
        "Generate a valid native manifest before preflight.",
        "error",
        resolve(root, expected.fileName)
      )
    );
  }

  const collected = await collectProjectTextFiles(root);
  diagnostics.push(
    ...collected.diagnostics,
    ...scanFilesForSecrets(collected.sources)
  );

  let buildCommand: readonly [string, ...string[]] | undefined;
  try {
    buildCommand = await packageBuildCommand(root);
  } catch {
    diagnostics.push(
      diagnostic(
        "PACKAGE_JSON_INVALID",
        "package.json must exist and contain valid JSON.",
        "error",
        resolve(root, "package.json")
      )
    );
  }
  if (buildCommand === undefined) {
    diagnostics.push(
      diagnostic(
        "BUILD_COMMAND_MISSING",
        "package.json must define a build script.",
        "error",
        resolve(root, "package.json")
      )
    );
  }

  const initialDiagnostics = sortDiagnostics(diagnostics);
  if (hasErrors(initialDiagnostics)) {
    failAfterDiagnostics(context, "preflight", initialDiagnostics, format);
  }

  const commands = [
    { phase: "build", command: buildCommand },
    { phase: "test", command: plugin.tests.command }
  ] as const;
  for (const item of commands) {
    if (item.command === undefined) {
      continue;
    }
    const [command, ...args] = item.command;
    const result = await context.runProcess(command, args, root);
    if (result.exitCode !== 0) {
      failAfterDiagnostics(
        context,
        "preflight",
        [
          diagnostic(
            `PREFLIGHT_${item.phase.toUpperCase()}_FAILED`,
            `${item.phase} command exited with code ${String(result.exitCode)}.`,
            "error",
            root,
            `rerun ${[command, ...args].join(" ")} for full logs`
          )
        ],
        format
      );
    }
  }

  const finalDiagnostics = await validateProjectFiles(root, plugin, true);
  if (hasErrors(finalDiagnostics)) {
    failAfterDiagnostics(context, "preflight", finalDiagnostics, format);
  }
  success(context, format, "preflight", `Preflight passed: ${root}`, {
    capabilities: plugin.capabilities.length,
    directory: root
  });
}

function markdownMatrix(cells: readonly CompatibilityCell[]): string {
  const rows = cells
    .map(
      (cell) =>
        `| ${cell.pluginId.replaceAll("|", "\\|")} | ${cell.environmentId.replaceAll("|", "\\|")} | ${cell.status} |`
    )
    .join("\n");
  return `# Compatibility matrix

| Plugin | Environment | Status |
| --- | --- | --- |
${rows}
`;
}

function matrixFormat(path: string, explicit?: string): "html" | "json" | "md" {
  const selected =
    explicit ??
    { ".html": "html", ".json": "json", ".md": "md" }[extname(path)] ??
    "html";
  if (selected !== "html" && selected !== "json" && selected !== "md") {
    throw new CliFailure('Matrix format must be "html", "json", or "md".', 2);
  }
  return selected;
}

async function matrixCommand(
  context: CliContext,
  directoryArguments: readonly string[],
  options: MatrixOptions
): Promise<void> {
  const catalogPath = resolveFrom(context, options.catalog);
  const outPath = resolveFrom(context, options.out);
  let environments: readonly CompatibilityEnvironment[];
  try {
    const parsed: unknown = parseYaml(await readFile(catalogPath, "utf8"));
    environments = catalogSchema.parse(
      parsed
    ) as readonly CompatibilityEnvironment[];
  } catch (error) {
    throw new CliFailure(
      error instanceof Error
        ? `Invalid compatibility catalog: ${error.message}`
        : "Invalid compatibility catalog."
    );
  }

  const cells: CompatibilityCell[] = [];
  for (const argument of directoryArguments) {
    const root = resolveFrom(context, argument);
    const parsed = await loadPluginProject(root);
    if (!parsed.ok || parsed.value === undefined) {
      failAfterDiagnostics(context, "matrix", parsed.diagnostics, "human");
    }
    cells.push(
      ...evaluateCompatibilityMatrix(
        parsed.value,
        environments,
        [] as readonly CompatibilityEvidence[]
      )
    );
  }

  const generatedAt = context.now().toISOString();
  const format = matrixFormat(outPath, options.format);
  const content =
    format === "html"
      ? renderCompatibilityHtml({
          title: "PolyPlugin compatibility matrix",
          generatedAt,
          cells
        })
      : format === "json"
        ? stableJson({ schemaVersion: 1, generatedAt, cells })
        : markdownMatrix(cells);
  await writeTextAtomic(outPath, content);
  context.stdout(
    `Wrote ${format.toUpperCase()} compatibility matrix: ${outPath}\n`
  );
}

function portablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function readTemplateSourceFiles(
  templateDirectory: string
): Promise<readonly TemplateSourceFile[]> {
  const files: TemplateSourceFile[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push({
          path: portablePath(templateDirectory, path),
          template: await readFile(path, "utf8")
        });
      } else {
        throw new TypeError("Templates may contain only regular files.");
      }
    }
  }
  await visit(templateDirectory);
  return files;
}

async function readSnapshot(directory: string): Promise<FileSnapshot> {
  const snapshot: Record<string, string> = {};
  if (!(await pathExists(directory))) {
    return snapshot;
  }
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        snapshot[portablePath(directory, path)] = await readFile(path, "utf8");
      } else {
        throw new TypeError(
          "Upgrade snapshots may contain only regular files."
        );
      }
    }
  }
  await visit(directory);
  return snapshot;
}

async function readCurrentManagedSnapshot(
  root: string,
  paths: readonly string[]
): Promise<FileSnapshot> {
  const snapshot: Record<string, string> = {};
  for (const path of paths) {
    const targetPath = resolveProjectPath(root, path);
    if (!(await pathExists(targetPath))) {
      continue;
    }
    const stats = await lstat(targetPath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new TypeError(`Managed path is not a regular file: ${path}`);
    }
    snapshot[path] = await readFile(targetPath, "utf8");
  }
  return snapshot;
}

function renderedSnapshot(
  files: readonly { readonly path: string; readonly content: string }[]
): FileSnapshot {
  return Object.fromEntries(files.map((file) => [file.path, file.content]));
}

function printUpgradePlan(
  context: CliContext,
  plan: UpgradePlan,
  format: OutputFormat,
  dryRun: boolean
): void {
  if (format === "json") {
    context.stdout(
      stableJson({
        command: "upgrade",
        dryRun,
        ok: true,
        plan: {
          canApplyAtomically: plan.canApplyAtomically,
          operations: plan.operations.map(({ kind, path }) => ({
            kind,
            path
          })),
          preserved: plan.preserved.map(({ path, reason, current }) => ({
            path,
            reason,
            current: current.state
          })),
          conflicts: plan.conflicts.map(({ path, reason, materialPlan }) => ({
            path,
            reason,
            material: {
              baseline: materialPlan.baseline.state,
              current: materialPlan.current.state,
              next: materialPlan.next.state
            }
          }))
        }
      })
    );
    return;
  }
  context.stdout(
    `${dryRun ? "Upgrade dry run" : "Upgrade plan"}: ${String(plan.operations.length)} operations, ${String(plan.conflicts.length)} conflicts, ${String(plan.preserved.length)} preserved paths.\n`
  );
  for (const conflict of plan.conflicts) {
    context.stdout(`CONFLICT ${conflict.path}: ${conflict.reason}\n`);
  }
}

function conflictMaterialContent(
  material: UpgradePlan["conflicts"][number]["materialPlan"]["baseline"]
): string {
  return material.state === "present"
    ? material.content
    : "# PolyPlugin Forge: this file is absent in this version.\n";
}

async function writeConflictMaterials(
  metadataRoot: string,
  plan: UpgradePlan
): Promise<string> {
  const conflictRoot = resolve(metadataRoot, "conflicts");
  await rm(conflictRoot, { force: true, recursive: true });
  await mkdir(conflictRoot, { recursive: true });

  for (const conflict of plan.conflicts) {
    const prefix = resolveProjectPath(conflictRoot, conflict.path);
    await mkdir(dirname(prefix), { recursive: true });
    await writeFile(
      `${prefix}.base`,
      conflictMaterialContent(conflict.materialPlan.baseline),
      "utf8"
    );
    await writeFile(
      `${prefix}.current`,
      conflictMaterialContent(conflict.materialPlan.current),
      "utf8"
    );
    await writeFile(
      `${prefix}.incoming`,
      conflictMaterialContent(conflict.materialPlan.next),
      "utf8"
    );
  }
  await writeTextAtomic(
    resolve(conflictRoot, "conflicts.json"),
    stableJson({
      schemaVersion: 1,
      conflicts: plan.conflicts.map(({ path, reason }) => ({ path, reason }))
    })
  );
  return conflictRoot;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function verifyOperations(
  root: string,
  operations: readonly UpgradeOperation[]
): Promise<Record<string, string | undefined>> {
  const before: Record<string, string | undefined> = {};
  for (const operation of operations) {
    const path = resolveProjectPath(root, operation.path);
    const exists = await pathExists(path);
    const current = exists ? await readFile(path, "utf8") : undefined;
    before[operation.path] = current;
    if (operation.kind === "add" && exists) {
      throw new CliFailure(
        `Upgrade target appeared unexpectedly: ${operation.path}`
      );
    }
    if (operation.kind !== "add" && current !== operation.expectedCurrent) {
      throw new CliFailure(
        `Upgrade target changed during planning: ${operation.path}`
      );
    }
  }
  return before;
}

async function restoreOperations(
  root: string,
  before: Readonly<Record<string, string | undefined>>
): Promise<void> {
  for (const [path, content] of Object.entries(before)) {
    const targetPath = resolveProjectPath(root, path);
    if (content === undefined) {
      await rm(targetPath, { force: true });
    } else {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf8");
    }
  }
}

async function applyOperations(
  root: string,
  operations: readonly UpgradeOperation[],
  context: CliContext
): Promise<Record<string, string | undefined>> {
  const before = await verifyOperations(root, operations);
  const backupRoot = resolve(
    root,
    ".polyplugin",
    "backups",
    context.now().toISOString().replaceAll(/[:.]/gu, "-")
  );
  await mkdir(backupRoot, { recursive: true });
  await writeFile(
    resolve(backupRoot, "before.json"),
    stableJson(before),
    "utf8"
  );

  try {
    for (const operation of operations) {
      const path = resolveProjectPath(root, operation.path);
      if (operation.kind === "delete") {
        await rm(path, { force: true });
      } else {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, operation.content, "utf8");
      }
    }
  } catch (error) {
    await restoreOperations(root, before);
    throw error;
  }
  return before;
}

async function replaceBaseline(
  root: string,
  next: FileSnapshot,
  state: z.infer<typeof stateSchema>,
  context: CliContext
): Promise<void> {
  const metadataRoot = resolve(root, ".polyplugin");
  const baseline = resolve(metadataRoot, "baseline");
  const stage = resolve(metadataRoot, `baseline-next-${String(process.pid)}`);
  const previous = resolve(
    metadataRoot,
    `baseline-previous-${String(process.pid)}`
  );
  await rm(stage, { force: true, recursive: true });
  await rm(previous, { force: true, recursive: true });
  for (const [path, content] of Object.entries(next)) {
    const targetPath = resolveProjectPath(stage, path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf8");
  }

  await rename(baseline, previous);
  try {
    await rename(stage, baseline);
    await writeTextAtomic(
      resolve(metadataRoot, "state.json"),
      stableJson({
        ...state,
        templateVersion: state.templateVersion,
        files: Object.fromEntries(
          Object.entries(next).map(([path, content]) => [path, sha256(content)])
        )
      })
    );
    await rm(previous, { force: true, recursive: true });
  } catch (error) {
    await rm(baseline, { force: true, recursive: true });
    await rename(previous, baseline);
    throw error;
  }
  void context;
}

async function upgradeCommand(
  context: CliContext,
  directoryArgument: string,
  options: UpgradeOptions
): Promise<void> {
  if (options.dryRun === true && options.continue === true) {
    throw new CliFailure("--dry-run and --continue cannot be combined.", 2);
  }
  const format = parseOutputFormat(options.format, options.json);
  const root = resolveFrom(context, directoryArgument);
  const metadataRoot = resolve(root, ".polyplugin");
  const state = stateSchema.parse(
    await readJsonObject(resolve(metadataRoot, "state.json"))
  );
  const answers = answersSchema.parse(
    await readJsonObject(resolve(metadataRoot, "answers.json"))
  ) as TemplateAnswers;
  const templateDirectory = resolve(
    context.templatesRoot,
    state.template,
    options.to
  );
  const rendered = renderTemplate(
    state.template,
    await readTemplateSourceFiles(templateDirectory),
    answers,
    options.to
  );
  const baseline = await readSnapshot(resolve(metadataRoot, "baseline"));
  const next = renderedSnapshot(rendered.files);
  const managedPaths = [
    ...new Set([...Object.keys(baseline), ...Object.keys(next)])
  ];
  const current = await readCurrentManagedSnapshot(root, managedPaths);
  const plan = planUpgrade(baseline, current, next);
  printUpgradePlan(context, plan, format, options.dryRun === true);
  if (options.dryRun === true) {
    return;
  }

  const pendingPath = resolve(metadataRoot, "upgrade-pending.json");
  if (options.continue === true) {
    const pending = pendingUpgradeSchema.parse(
      await readJsonObject(pendingPath)
    );
    if (pending.targetVersion !== options.to) {
      throw new CliFailure(
        `Pending upgrade targets ${pending.targetVersion}, not ${options.to}.`
      );
    }
    const accepted = new Set(pending.conflictPaths);
    const unexpected = plan.conflicts.filter(
      (conflict) => !accepted.has(conflict.path)
    );
    if (unexpected.length > 0) {
      throw new CliFailure(
        "New conflicts appeared after the pending upgrade was created."
      );
    }
  } else if (plan.conflicts.length > 0) {
    const conflictRoot = await writeConflictMaterials(metadataRoot, plan);
    await writeTextAtomic(
      pendingPath,
      stableJson({
        schemaVersion: 1,
        targetVersion: options.to,
        conflictPaths: plan.conflicts.map(({ path }) => path)
      })
    );
    if (format === "human") {
      context.stdout(
        `Three-way materials were written to ${conflictRoot}. Resolve the listed project files, then rerun with --continue to accept the current merged content.\n`
      );
    }
    throw new CliFailure("Upgrade has conflicts.", 4, true);
  }

  const before = await applyOperations(root, plan.operations, context);
  try {
    await replaceBaseline(
      root,
      next,
      {
        ...state,
        templateVersion: options.to
      },
      context
    );
    await rm(pendingPath, { force: true });
    await rm(resolve(metadataRoot, "conflicts"), {
      force: true,
      recursive: true
    });
  } catch (error) {
    await restoreOperations(root, before);
    throw error;
  }
  success(context, format, "upgrade", `Upgraded ${root} to ${options.to}`, {
    directory: root,
    preserved: plan.preserved.length,
    version: options.to
  });
}

export function registerCommands(program: Command, context: CliContext): void {
  program
    .command("create")
    .description("Create a plugin from a bundled template.")
    .argument("<dir>", "empty destination directory")
    .requiredOption("--template <kind>", "mcp, vscode, chrome, or webhook")
    .requiredOption("--plugin-id <id>", "stable plugin identifier")
    .requiredOption("--name <name>", "display name")
    .requiredOption("--description <text>", "plugin description")
    .requiredOption("--package-name <name>", "npm package name")
    .option(
      "--template-version <version>",
      "bundled template version",
      INITIAL_TEMPLATE_VERSION
    )
    .action(async (directory: string, options: CreateOptions) => {
      await createCommand(context, directory, options);
    });

  program
    .command("lint")
    .description("Validate plugin.yaml and its referenced project files.")
    .argument("[dir]", "plugin directory", ".")
    .option("--format <format>", "human or json", "human")
    .option("--json", "emit machine-readable JSON")
    .action(async (directory: string, options: FormatOptions) => {
      await lintCommand(context, directory, options);
    });

  const manifest = program
    .command("manifest")
    .description("Generate and validate native manifests.");
  manifest
    .command("generate")
    .argument("[dir]", "plugin directory", ".")
    .option("--check", "fail if generated output is not current")
    .option("--format <format>", "human or json", "human")
    .option("--json", "emit machine-readable JSON")
    .action(async (directory: string, options: GenerateOptions) => {
      await generateManifestCommand(context, directory, options);
    });
  manifest
    .command("lint")
    .argument("[dir]", "plugin directory", ".")
    .option("--format <format>", "human or json", "human")
    .option("--json", "emit machine-readable JSON")
    .action(async (directory: string, options: FormatOptions) => {
      await lintNativeManifestCommand(context, directory, options);
    });

  program
    .command("preflight")
    .description("Run static, security, build, test, and entry checks.")
    .argument("[dir]", "plugin directory", ".")
    .option("--format <format>", "human or json", "human")
    .option("--json", "emit machine-readable JSON")
    .action(async (directory: string, options: FormatOptions) => {
      await preflightCommand(context, directory, options);
    });

  program
    .command("matrix")
    .description("Generate a deterministic compatibility matrix.")
    .argument("<dirs...>", "one or more plugin directories")
    .requiredOption("--catalog <file>", "environment fixture YAML")
    .requiredOption("--out <file>", "HTML, JSON, or Markdown output")
    .option("--format <format>", "html, json, or md")
    .action(async (directories: string[], options: MatrixOptions) => {
      await matrixCommand(context, directories, options);
    });

  program
    .command("upgrade")
    .description("Safely plan or apply a bundled template upgrade.")
    .argument("[dir]", "plugin directory", ".")
    .requiredOption("--to <version>", "target template version")
    .option("--dry-run", "print the three-way plan without writing")
    .option(
      "--continue",
      "accept resolved current files from a pending conflict"
    )
    .option("--format <format>", "human or json", "human")
    .option("--json", "emit machine-readable JSON")
    .action(async (directory: string, options: UpgradeOptions) => {
      await upgradeCommand(context, directory, options);
    });
}

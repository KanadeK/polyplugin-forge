import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { scanFilesForSecrets } from "../src/core/secret-scanner.js";
import { releaseArtifactNames } from "./package-release.js";

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

interface ReleaseMetadata {
  readonly name: string;
  readonly version: string;
  readonly author: string;
}

const EMPTY_MARKER =
  /\b(?:TODO|FIXME|NotImplemented|coming soon|lorem ipsum)\b/iu;
const TEXT_FILE = /\.(?:css|hbs|html|js|json|md|mjs|ts|txt|yaml|yml)$/iu;
const MARKER_EXCLUSIONS = new Set([
  "docs/ROADMAP.md",
  "scripts/release-check.ts",
  "src/core/secret-scanner.ts"
]);
const SECRET_SCAN_EXCLUSIONS = new Set([
  // This test intentionally contains synthetic detector inputs.
  "tests/unit/secret-scanner.test.ts"
]);

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
        CI: process.env["CI"] ?? "true",
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

async function git(
  arguments_: readonly string[],
  projectRoot: string
): Promise<string> {
  return (await run("git", arguments_, projectRoot)).stdout;
}

function parseReleaseMetadata(value: unknown): ReleaseMetadata {
  if (value === null || typeof value !== "object") {
    throw new TypeError("package.json must contain an object");
  }
  const record = value as Record<string, unknown>;
  const authorValue = record["author"];
  const author =
    typeof authorValue === "string"
      ? authorValue
      : authorValue !== null &&
          typeof authorValue === "object" &&
          typeof (authorValue as Record<string, unknown>)["name"] === "string"
        ? ((authorValue as Record<string, unknown>)["name"] as string)
        : undefined;
  if (
    typeof record["name"] !== "string" ||
    typeof record["version"] !== "string" ||
    author === undefined ||
    author.trim().length === 0
  ) {
    throw new TypeError("package.json name, version, and author are required");
  }
  return {
    name: record["name"],
    version: record["version"],
    author
  };
}

export function parseChecksumManifest(
  content: string
): ReadonlyMap<string, string> {
  const checksums = new Map<string, string>();
  for (const line of content.split(/\r?\n/u)) {
    if (line.length === 0) {
      continue;
    }
    const match = /^([a-f0-9]{64}) {2}([^/\\\r\n]+)$/u.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new Error("SHA256SUMS contains an invalid entry");
    }
    const [, hash, name] = match;
    if (checksums.has(name)) {
      throw new Error(`SHA256SUMS contains a duplicate entry: ${name}`);
    }
    checksums.set(name, hash);
  }
  return checksums;
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function verifyCleanTree(projectRoot: string): Promise<void> {
  const status = await git(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    projectRoot
  );
  if (status.trim().length > 0) {
    const count = status.trimEnd().split(/\r?\n/u).length;
    throw new Error(
      `Release requires a clean Git worktree; ${String(count)} change(s) remain`
    );
  }
}

async function verifyVersions(
  projectRoot: string,
  metadata: ReleaseMetadata
): Promise<void> {
  const lock = JSON.parse(
    await readFile(join(projectRoot, "package-lock.json"), "utf8")
  ) as unknown;
  if (lock === null || typeof lock !== "object") {
    throw new Error("package-lock.json must contain an object");
  }
  const lockRecord = lock as Record<string, unknown>;
  const packages = lockRecord["packages"];
  const rootPackage =
    packages !== null && typeof packages === "object"
      ? (packages as Record<string, unknown>)[""]
      : undefined;
  const rootVersion =
    rootPackage !== null && typeof rootPackage === "object"
      ? (rootPackage as Record<string, unknown>)["version"]
      : undefined;
  if (
    lockRecord["name"] !== metadata.name ||
    lockRecord["version"] !== metadata.version ||
    rootVersion !== metadata.version
  ) {
    throw new Error("package.json and package-lock.json versions disagree");
  }

  const versionSource = await readFile(
    join(projectRoot, "src", "version.ts"),
    "utf8"
  );
  const versionMatch = /export const VERSION = "([^"]+)";/u.exec(
    versionSource
  )?.[1];
  if (versionMatch !== metadata.version) {
    throw new Error("src/version.ts and package.json versions disagree");
  }

  const changelog = await readFile(join(projectRoot, "CHANGELOG.md"), "utf8");
  const escapedVersion = metadata.version.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&"
  );
  const releaseHeading = new RegExp(
    `^## \\[${escapedVersion}\\](?: - \\d{4}-\\d{2}-\\d{2})?$`,
    "mu"
  );
  if (!releaseHeading.test(changelog)) {
    throw new Error(
      `CHANGELOG.md must contain a release heading for ${metadata.version}`
    );
  }
}

async function verifyArtifacts(
  projectRoot: string,
  metadata: ReleaseMetadata
): Promise<readonly string[]> {
  const releaseRoot = join(projectRoot, "dist-release");
  const names = releaseArtifactNames(metadata.name, metadata.version);
  const expected = [
    names.tarball,
    ...Object.values(names.templates),
    names.matrix,
    names.checksums
  ].sort((left, right) => left.localeCompare(right));
  const actual = (await readdir(releaseRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      "dist-release does not contain the exact expected release artifact set"
    );
  }

  const checksumPath = join(releaseRoot, names.checksums);
  const checksums = parseChecksumManifest(await readFile(checksumPath, "utf8"));
  const payloadNames = expected.filter((name) => name !== names.checksums);
  if (checksums.size !== payloadNames.length) {
    throw new Error("SHA256SUMS does not cover every release payload");
  }
  for (const name of payloadNames) {
    const path = join(releaseRoot, name);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.size === 0) {
      throw new Error(`Release artifact is empty: ${name}`);
    }
    const expectedHash = checksums.get(name);
    if (
      expectedHash === undefined ||
      sha256(await readFile(path)) !== expectedHash
    ) {
      throw new Error(`Release artifact checksum mismatch: ${name}`);
    }
  }

  return expected;
}

async function trackedTextFiles(
  projectRoot: string
): Promise<readonly { readonly path: string; readonly content: string }[]> {
  const output = await git(["ls-files", "-z"], projectRoot);
  const paths = output.split("\0").filter((path) => path.length > 0);
  const files: { path: string; content: string }[] = [];

  for (const path of paths) {
    if (!TEXT_FILE.test(path)) {
      continue;
    }
    const absolute = resolve(projectRoot, ...path.split("/"));
    if (!absolute.startsWith(`${resolve(projectRoot)}${sep}`)) {
      throw new Error("Tracked path escapes the repository");
    }
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.size > 2 * 1024 * 1024) {
      continue;
    }
    const content = await readFile(absolute, "utf8");
    if (!content.includes("\0")) {
      files.push({ path, content });
    }
  }
  return files;
}

export async function verifySourceHygiene(projectRoot: string): Promise<void> {
  const files = await trackedTextFiles(projectRoot);
  const secretDiagnostics = scanFilesForSecrets(
    files.filter(({ path }) => !SECRET_SCAN_EXCLUSIONS.has(path))
  );
  if (secretDiagnostics.length > 0) {
    const summary = secretDiagnostics
      .map(({ code, path }) => `${path ?? "<unknown>"}: ${code}`)
      .join("\n");
    throw new Error(`Potential secrets detected:\n${summary}`);
  }

  for (const file of files) {
    if (file.path.startsWith("tests/") || MARKER_EXCLUSIONS.has(file.path)) {
      continue;
    }
    const match = EMPTY_MARKER.exec(file.content);
    if (match !== null) {
      const line = file.content.slice(0, match.index).split(/\r?\n/u).length;
      throw new Error(
        `Empty-implementation marker detected at ${file.path}:${String(line)}`
      );
    }
  }
}

async function verifyCommitIdentity(
  projectRoot: string,
  metadata: ReleaseMetadata
): Promise<void> {
  const configuredName = (
    await git(["config", "--local", "--get", "user.name"], projectRoot)
  ).trim();
  const configuredEmail = (
    await git(["config", "--local", "--get", "user.email"], projectRoot)
  ).trim();
  if (
    configuredName.length === 0 ||
    configuredEmail.length === 0 ||
    configuredName !== metadata.author
  ) {
    throw new Error(
      "Local Git identity must be configured and match package.json author"
    );
  }

  const log = await git(
    ["log", "--format=%an%x00%ae%x00%cn%x00%ce%x00%B%x00%x1e"],
    projectRoot
  );
  const records = log
    .split("\x1e")
    .map((record) => record.replace(/^\r?\n/u, ""))
    .filter((record) => record.trim().length > 0);
  if (records.length === 0) {
    throw new Error("Release requires at least one Git commit");
  }

  for (const record of records) {
    const fields = record.split("\0");
    const [authorName, authorEmail, committerName, committerEmail, body] =
      fields;
    if (
      authorName !== configuredName ||
      authorEmail !== configuredEmail ||
      committerName !== configuredName ||
      committerEmail !== configuredEmail
    ) {
      throw new Error(
        "Every commit author and committer must match the configured identity"
      );
    }
    if (/^Co-authored-by:/imu.test(body ?? "")) {
      throw new Error("Co-authored-by trailers are not allowed");
    }
  }
}

async function runQualityGate(projectRoot: string): Promise<void> {
  const npmCli = process.env["npm_execpath"];
  if (npmCli === undefined || npmCli.trim().length === 0) {
    throw new Error("npm_execpath is required; run release-check through npm");
  }
  await run(process.execPath, [npmCli, "run", "verify"], projectRoot);
}

export async function releaseCheck(projectRoot: string): Promise<{
  readonly artifacts: readonly string[];
}> {
  const root = resolve(projectRoot);
  const metadata = parseReleaseMetadata(
    JSON.parse(await readFile(join(root, "package.json"), "utf8")) as unknown
  );

  await verifyCleanTree(root);
  await verifyVersions(root, metadata);
  await verifySourceHygiene(root);
  await verifyCommitIdentity(root, metadata);
  await runQualityGate(root);
  const artifacts = await verifyArtifacts(root, metadata);

  return { artifacts };
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  const result = await releaseCheck(resolve(import.meta.dirname, ".."));
  process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
}

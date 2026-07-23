import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import {
  renderTemplate,
  type RenderedTemplate,
  type TemplateAnswers,
  type TemplateSourceFile
} from "../core/template-renderer.js";
import { stableJson } from "../core/stable-json.js";

import type { PluginTarget } from "../core/model.js";

const MAX_TEMPLATE_FILE_BYTES = 1024 * 1024;

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

function containedPath(root: string, path: string): string {
  const target = resolve(root, ...path.split("/"));
  const prefix = `${resolve(root)}${sep}`;
  if (!target.startsWith(prefix)) {
    throw new TypeError(`Path escapes target root: ${path}`);
  }
  return target;
}

async function readTemplateDirectory(
  templateRoot: string
): Promise<readonly TemplateSourceFile[]> {
  const root = resolve(templateRoot);
  const files: TemplateSourceFile[] = [];

  async function visitDirectory(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new TypeError(
          `Template directories cannot contain symlinks: ${entry.name}`
        );
      }
      if (entry.isDirectory()) {
        await visitDirectory(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new TypeError(`Unsupported template entry: ${entry.name}`);
      }
      const stats = await lstat(absolute);
      if (stats.size > MAX_TEMPLATE_FILE_BYTES) {
        throw new TypeError(`Template file exceeds 1 MiB: ${entry.name}`);
      }
      files.push({
        path: portablePath(relative(root, absolute)),
        template: await readFile(absolute, "utf8")
      });
    }
  }

  await visitDirectory(root);
  return files;
}

async function assertEmptyDestination(destination: string): Promise<boolean> {
  try {
    const stats = await lstat(destination);
    if (!stats.isDirectory()) {
      throw new TypeError("Destination exists and is not a directory");
    }
    if ((await readdir(destination)).length > 0) {
      throw new TypeError("Destination directory must be empty");
    }
    return false;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function writeRenderedTemplate(
  destination: string,
  rendered: RenderedTemplate
): Promise<void> {
  for (const file of rendered.files) {
    const target = containedPath(destination, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, { encoding: "utf8", flag: "wx" });

    const baseline = containedPath(
      destination,
      `.polyplugin/baseline/${file.path}`
    );
    await mkdir(dirname(baseline), { recursive: true });
    await writeFile(baseline, file.content, {
      encoding: "utf8",
      flag: "wx"
    });
  }

  const state = {
    schemaVersion: 1,
    template: rendered.kind,
    templateVersion: rendered.version,
    files: Object.fromEntries(
      rendered.files.map((file) => [file.path, sha256(file.content)])
    )
  };
  const statePath = containedPath(destination, ".polyplugin/state.json");
  const answersPath = containedPath(destination, ".polyplugin/answers.json");
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, stableJson(state), {
    encoding: "utf8",
    flag: "wx"
  });
  await writeFile(answersPath, stableJson(rendered.answers), {
    encoding: "utf8",
    flag: "wx"
  });
}

export interface ScaffoldOptions {
  readonly templateDirectory: string;
  readonly destination: string;
  readonly kind: PluginTarget;
  readonly version: string;
  readonly answers: TemplateAnswers;
}

export async function scaffoldProject(
  options: ScaffoldOptions
): Promise<RenderedTemplate> {
  const destination = resolve(options.destination);
  const shouldCreateDestination = await assertEmptyDestination(destination);
  if (shouldCreateDestination) {
    await mkdir(destination, { recursive: true });
  }

  try {
    const sourceFiles = await readTemplateDirectory(options.templateDirectory);
    const rendered = renderTemplate(
      options.kind,
      sourceFiles,
      options.answers,
      options.version
    );
    await writeRenderedTemplate(destination, rendered);
    return rendered;
  } catch (error) {
    if (shouldCreateDestination) {
      await rm(destination, { force: true, recursive: true });
    }
    throw error;
  }
}

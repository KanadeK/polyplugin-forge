import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { scaffoldProject } from "../src/adapters/template-filesystem.js";
import {
  generateAndValidateManifest,
  stringifyManifest
} from "../src/core/manifest-generator.js";
import { parsePluginManifest } from "../src/core/plugin-schema.js";
import { SUPPORTED_TEMPLATE_VERSIONS } from "../src/core/template-renderer.js";
import { TEMPLATE_CASES } from "./template-cases.js";

import type { PluginTarget } from "../src/core/model.js";

function formatDiagnostics(
  diagnostics: readonly { readonly code: string; readonly message: string }[]
): string {
  return diagnostics
    .map(({ code, message }) => `${code}: ${message}`)
    .join("\n");
}

async function run(
  executable: string,
  arguments_: readonly string[],
  cwd: string
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(executable, arguments_, {
      cwd,
      env: {
        ...process.env,
        NO_UPDATE_NOTIFIER: "1",
        npm_config_audit: "false",
        npm_config_fund: "false"
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${executable} ${arguments_.join(" ")} failed with ${signal ?? String(code)}\n${output}`
        )
      );
    });
  });
}

const projectRoot = resolve(import.meta.dirname, "..");
const validationRoot = await mkdtemp(
  join(tmpdir(), "polyplugin-template-validation-")
);
const npmCli = process.env["npm_execpath"];
if (npmCli === undefined || npmCli.trim().length === 0) {
  throw new Error("npm_execpath is required to validate generated templates");
}
const summary: {
  kind: PluginTarget;
  version: string;
  project: string;
  nativeManifest: string;
  commands: string[];
}[] = [];

try {
  for (const version of SUPPORTED_TEMPLATE_VERSIONS) {
    for (const templateCase of TEMPLATE_CASES) {
      process.stderr.write(
        `Validating ${templateCase.kind}@${version} template...\n`
      );
      const destination = join(
        validationRoot,
        `${templateCase.kind}-${version}`
      );
      await scaffoldProject({
        templateDirectory: join(
          projectRoot,
          "templates",
          templateCase.kind,
          version
        ),
        destination,
        kind: templateCase.kind,
        version,
        answers: templateCase.answers
      });

      const parsed = parsePluginManifest(
        await readFile(join(destination, "plugin.yaml"), "utf8")
      );
      if (!parsed.ok || parsed.value === undefined) {
        throw new Error(
          `${templateCase.kind}@${version} plugin.yaml is invalid\n${formatDiagnostics(parsed.diagnostics)}`
        );
      }

      let existingNativeManifest: Readonly<Record<string, unknown>> | undefined;
      if (templateCase.kind === "vscode") {
        existingNativeManifest = JSON.parse(
          await readFile(join(destination, "package.json"), "utf8")
        ) as Readonly<Record<string, unknown>>;
      }
      const native = generateAndValidateManifest(
        parsed.value,
        existingNativeManifest
      );
      if (!native.ok || native.value === undefined) {
        throw new Error(
          `${templateCase.kind}@${version} native manifest is invalid\n${formatDiagnostics(native.diagnostics)}`
        );
      }
      const nativePath = join(destination, native.value.fileName);
      await writeFile(nativePath, stringifyManifest(native.value), "utf8");

      await run(
        process.execPath,
        [npmCli, "ci", "--ignore-scripts", "--offline"],
        destination
      );
      await run(process.execPath, [npmCli, "test"], destination);
      await run(process.execPath, [npmCli, "run", "build"], destination);
      await access(join(destination, parsed.value.runtime.entry));

      summary.push({
        kind: templateCase.kind,
        version,
        project: destination,
        nativeManifest: native.value.fileName,
        commands: ["npm ci --offline", "npm test", "npm run build"]
      });
    }
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, templates: summary }, null, 2)}\n`
  );
} finally {
  if (process.env["KEEP_TEMPLATE_OUTPUT"] !== "1") {
    await rm(validationRoot, { force: true, recursive: true });
  }
}

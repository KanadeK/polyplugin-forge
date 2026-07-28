import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readScripts(): Promise<Readonly<Record<string, string>>> {
  const value: unknown = JSON.parse(
    await readFile(resolve(projectRoot, "package.json"), "utf8")
  );
  if (!isRecord(value) || !isRecord(value["scripts"])) {
    throw new Error("package.json must define scripts");
  }

  const scripts: Record<string, string> = {};
  for (const [name, command] of Object.entries(value["scripts"])) {
    if (typeof command === "string") {
      scripts[name] = command;
    }
  }
  return scripts;
}

const qualityScripts = [
  "format:check",
  "lint",
  "typecheck",
  "test:coverage",
  "templates:verify",
  "test:e2e",
  "build"
] as const;

async function runNpmScript(script: string, npmCli: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [npmCli, "run", script], {
      cwd: projectRoot,
      env: {
        ...process.env,
        CI: process.env["CI"] ?? "true",
        NO_UPDATE_NOTIFIER: "1",
        npm_config_audit: "false",
        npm_config_fund: "false"
      },
      shell: false,
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `npm run ${script} failed with ${signal ?? `exit code ${String(code)}`}`
        )
      );
    });
  });
}

const scripts = await readScripts();
const npmCli = process.env["npm_execpath"];
if (npmCli === undefined || npmCli.trim().length === 0) {
  throw new Error("npm_execpath is required; run this script through npm");
}

for (const script of qualityScripts) {
  if (scripts[script]?.trim().length === 0) {
    throw new Error(`Required npm script is missing: ${script}`);
  }
  process.stderr.write(`\n==> npm run ${script}\n`);
  await runNpmScript(script, npmCli);
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      commands: qualityScripts.map((script) => `npm run ${script}`)
    },
    null,
    2
  )}\n`
);

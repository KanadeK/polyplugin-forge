import { readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import { scaffoldProject } from "../src/adapters/template-filesystem.js";
import {
  generateAndValidateManifest,
  stringifyManifest
} from "../src/core/manifest-generator.js";
import { parsePluginManifest } from "../src/core/plugin-schema.js";
import { INITIAL_TEMPLATE_VERSION } from "../src/core/template-renderer.js";
import { TEMPLATE_CASES } from "./template-cases.js";

const projectRoot = resolve(import.meta.dirname, "..");
const examplesRoot = join(projectRoot, "examples");

for (const templateCase of TEMPLATE_CASES) {
  const destination = join(examplesRoot, `${templateCase.kind}-hello`);
  if (!destination.startsWith(`${examplesRoot}${sep}`)) {
    throw new Error(`Refusing to replace an example outside ${examplesRoot}`);
  }
  await rm(destination, { force: true, recursive: true });
  await scaffoldProject({
    templateDirectory: join(
      projectRoot,
      "templates",
      templateCase.kind,
      INITIAL_TEMPLATE_VERSION
    ),
    destination,
    kind: templateCase.kind,
    version: INITIAL_TEMPLATE_VERSION,
    answers: templateCase.answers
  });

  const manifest = parsePluginManifest(
    await readFile(join(destination, "plugin.yaml"), "utf8")
  );
  if (!manifest.ok || manifest.value === undefined) {
    throw new Error(`${templateCase.kind} example manifest is invalid`);
  }
  let existing: Readonly<Record<string, unknown>> | undefined;
  if (templateCase.kind === "vscode") {
    existing = JSON.parse(
      await readFile(join(destination, "package.json"), "utf8")
    ) as Readonly<Record<string, unknown>>;
  }
  const native = generateAndValidateManifest(manifest.value, existing);
  if (!native.ok || native.value === undefined) {
    throw new Error(`${templateCase.kind} native example manifest is invalid`);
  }
  await writeFile(
    join(destination, native.value.fileName),
    stringifyManifest(native.value),
    "utf8"
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      examples: TEMPLATE_CASES.map(({ kind }) => `examples/${kind}-hello`)
    },
    null,
    2
  )}\n`
);

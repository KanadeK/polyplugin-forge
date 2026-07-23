import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const generatedDirectories = [
  "coverage",
  "demo-output",
  "dist",
  "dist-release"
];

for (const directory of generatedDirectories) {
  const target = resolve(projectRoot, directory);
  if (
    !target.startsWith(`${projectRoot}\\`) &&
    !target.startsWith(`${projectRoot}/`)
  ) {
    throw new Error(`Refusing to clean outside the project: ${target}`);
  }
  await rm(target, { force: true, recursive: true });
}

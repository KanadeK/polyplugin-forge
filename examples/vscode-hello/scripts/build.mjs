import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(projectRoot, "src", "extension.js");
const outputDirectory = resolve(projectRoot, "dist");
const output = resolve(outputDirectory, "extension.js");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await copyFile(source, output);

console.log("Built Hello VS Code to dist/extension.js");

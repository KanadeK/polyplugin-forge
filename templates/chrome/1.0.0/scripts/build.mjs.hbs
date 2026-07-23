import { copyFile, mkdir, rm } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);
const sourceRoot = new URL("src/", projectRoot);
const outputRoot = new URL("dist/", projectRoot);
const modules = ["greeting.js", "index.js", "popup.js"];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const moduleName of modules) {
  await copyFile(new URL(moduleName, sourceRoot), new URL(moduleName, outputRoot));
}

console.log(`Built ${modules.length} extension modules in dist/.`);

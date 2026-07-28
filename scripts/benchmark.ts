import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { parse as parseYaml } from "yaml";

import { evaluateCompatibilityMatrix } from "../src/core/compatibility.js";
import { generateAndValidateManifest } from "../src/core/manifest-generator.js";
import { parsePluginManifest } from "../src/core/plugin-schema.js";
import { renderCompatibilityHtml } from "../src/reporters/matrix-html.js";
import { TEMPLATE_CASES } from "./template-cases.js";

import type {
  CompatibilityEnvironment,
  PluginDefinition
} from "../src/core/model.js";

const projectRoot = resolve(import.meta.dirname, "..");
const warmupIterations = 10;
const measuredIterations = 50;

function percentile(sorted: readonly number[], value: number): number {
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1)
  );
  return sorted[index] ?? 0;
}

async function loadInputs(): Promise<{
  readonly sources: readonly string[];
  readonly environments: readonly CompatibilityEnvironment[];
}> {
  const sources = await Promise.all(
    TEMPLATE_CASES.map(({ kind }) =>
      readFile(
        resolve(projectRoot, "examples", `${kind}-hello`, "plugin.yaml"),
        "utf8"
      )
    )
  );
  const value: unknown = parseYaml(
    await readFile(
      resolve(projectRoot, "fixtures", "compatibility-environments.yaml"),
      "utf8"
    )
  );
  if (!Array.isArray(value)) {
    throw new Error("Compatibility fixture must contain an array");
  }
  return {
    sources,
    environments: value as readonly CompatibilityEnvironment[]
  };
}

function runPipeline(
  sources: readonly string[],
  environments: readonly CompatibilityEnvironment[]
): { readonly cells: number; readonly outputBytes: number } {
  const plugins: PluginDefinition[] = [];
  for (const source of sources) {
    const parsed = parsePluginManifest(source);
    if (!parsed.ok || parsed.value === undefined) {
      throw new Error("Benchmark fixture contains an invalid plugin manifest");
    }
    const native = generateAndValidateManifest(parsed.value);
    if (!native.ok) {
      throw new Error("Benchmark fixture failed native manifest generation");
    }
    plugins.push(parsed.value);
  }

  const cells = plugins.flatMap((plugin) =>
    evaluateCompatibilityMatrix(plugin, environments)
  );
  const html = renderCompatibilityHtml({
    title: "PolyPlugin Forge benchmark matrix",
    generatedAt: "1980-01-01T00:00:00.000Z",
    cells
  });
  return {
    cells: cells.length,
    outputBytes: Buffer.byteLength(html, "utf8")
  };
}

const { sources, environments } = await loadInputs();
for (let index = 0; index < warmupIterations; index += 1) {
  runPipeline(sources, environments);
}

const samples: number[] = [];
let result = { cells: 0, outputBytes: 0 };
for (let index = 0; index < measuredIterations; index += 1) {
  const started = performance.now();
  result = runPipeline(sources, environments);
  samples.push(performance.now() - started);
}
samples.sort((left, right) => left - right);

const report = {
  schemaVersion: 1,
  machine: {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCores: cpus().length,
    memoryMiB: Math.round(totalmem() / 1024 / 1024)
  },
  dataset: {
    plugins: sources.length,
    environments: environments.length,
    cells: result.cells,
    outputBytes: result.outputBytes
  },
  run: {
    warmupIterations,
    measuredIterations,
    p50Milliseconds: Number(percentile(samples, 50).toFixed(3)),
    p95Milliseconds: Number(percentile(samples, 95).toFixed(3)),
    minimumMilliseconds: Number((samples[0] ?? 0).toFixed(3)),
    maximumMilliseconds: Number((samples.at(-1) ?? 0).toFixed(3))
  }
};

const outputDirectory = resolve(projectRoot, "demo-output");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  resolve(outputDirectory, "benchmark.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

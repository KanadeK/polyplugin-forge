import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

import {
  evaluateCompatibilityMatrix,
  type CompatibilityEvidence
} from "../src/core/compatibility.js";
import { parsePluginManifest } from "../src/core/plugin-schema.js";
import { renderCompatibilityHtml } from "../src/reporters/matrix-html.js";
import { TEMPLATE_CASES } from "./template-cases.js";

import type {
  CompatibilityEnvironment,
  PluginDefinition,
  PluginTarget
} from "../src/core/model.js";

function buildTimestamp(): string {
  const sourceDateEpoch = process.env["SOURCE_DATE_EPOCH"];
  if (sourceDateEpoch === undefined) {
    return "1980-01-01T00:00:00.000Z";
  }

  if (!/^\d+$/u.test(sourceDateEpoch)) {
    throw new Error("SOURCE_DATE_EPOCH must contain whole seconds");
  }

  const timestamp = new Date(Number(sourceDateEpoch) * 1000);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("SOURCE_DATE_EPOCH is outside the supported date range");
  }
  return timestamp.toISOString();
}

function environmentFor(plugin: PluginDefinition): CompatibilityEnvironment {
  const common = {
    id: `${plugin.target.type}-release-fixture`,
    target: plugin.target.type,
    node: "22.0.0",
    os: "linux" as const,
    arch: "x64" as const,
    features: plugin.compatibility.features
  };

  switch (plugin.target.type) {
    case "mcp":
      return {
        ...common,
        targetVersion: plugin.target.protocolVersion,
        transport: plugin.target.transport
      };
    case "vscode":
      return {
        ...common,
        targetVersion: "1.95.0"
      };
    case "chrome":
      return {
        ...common,
        targetVersion: plugin.target.minimumChromeVersion
      };
    case "webhook":
      return {
        ...common,
        targetVersion: plugin.target.openapiVersion
      };
  }
}

export function renderTemplateCompatibilityMatrix(
  plugins: readonly PluginDefinition[],
  testedTargets: ReadonlySet<PluginTarget> = new Set(),
  generatedAt = buildTimestamp()
): string {
  const cells = plugins.flatMap((plugin) => {
    const environment = environmentFor(plugin);
    const evidence: readonly CompatibilityEvidence[] = testedTargets.has(
      plugin.target.type
    )
      ? [
          {
            environmentId: environment.id,
            build: "passed",
            test: "passed",
            probe: "passed"
          }
        ]
      : [];

    return evaluateCompatibilityMatrix(plugin, [environment], evidence);
  });

  return renderCompatibilityHtml({
    title: "PolyPlugin Forge template compatibility matrix",
    generatedAt,
    cells
  });
}

export async function loadExamplePlugins(
  projectRoot: string
): Promise<readonly PluginDefinition[]> {
  const plugins: PluginDefinition[] = [];

  for (const templateCase of TEMPLATE_CASES) {
    const manifestPath = resolve(
      projectRoot,
      "examples",
      `${templateCase.kind}-hello`,
      "plugin.yaml"
    );
    const result = parsePluginManifest(await readFile(manifestPath, "utf8"));
    if (!result.ok || result.value === undefined) {
      const codes = result.diagnostics.map(({ code }) => code).join(", ");
      throw new Error(
        `Example manifest for ${templateCase.kind} is invalid: ${codes}`
      );
    }
    plugins.push(result.value);
  }

  return plugins;
}

export interface DemoResult {
  readonly html: string;
  readonly screenshot: string;
  readonly pagesScreenshot: string;
}

export async function writeDemo(projectRoot: string): Promise<DemoResult> {
  const outputDirectory = resolve(projectRoot, "demo-output");
  const outputPath = resolve(outputDirectory, "index.html");
  const screenshot = resolve(projectRoot, "docs", "assets", "demo.png");
  const pagesScreenshot = resolve(outputDirectory, "demo.png");
  const plugins = await loadExamplePlugins(projectRoot);
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(resolve(projectRoot, "docs", "assets"), { recursive: true });
  await writeFile(
    outputPath,
    renderTemplateCompatibilityMatrix(plugins),
    "utf8"
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      colorScheme: "dark",
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 900 }
    });
    await page.goto(pathToFileURL(outputPath).href, {
      waitUntil: "domcontentloaded"
    });
    await page.screenshot({
      path: screenshot,
      animations: "disabled",
      fullPage: false
    });
  } finally {
    await browser.close();
  }
  await copyFile(screenshot, pagesScreenshot);
  return { html: outputPath, screenshot, pagesScreenshot };
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  const projectRoot = resolve(import.meta.dirname, "..");
  const output = await writeDemo(projectRoot);
  process.stdout.write(`${JSON.stringify({ ok: true, output }, null, 2)}\n`);
}

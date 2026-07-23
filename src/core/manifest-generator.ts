import {
  generateChromeManifest,
  validateChromeManifest
} from "../adapters/manifests/chrome.js";
import {
  generateMcpManifest,
  validateMcpManifest
} from "../adapters/manifests/mcp.js";
import {
  generateVscodeManifest,
  validateVscodeManifest
} from "../adapters/manifests/vscode.js";
import {
  generateWebhookManifest,
  validateWebhookManifest
} from "../adapters/manifests/webhook.js";
import { hasErrors, sortDiagnostics } from "./diagnostics.js";
import type {
  Diagnostic,
  ManifestOutput,
  PluginDefinition,
  ValidationResult
} from "./model.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)])
  );
}

function stableOutput(output: ManifestOutput): ManifestOutput {
  return {
    ...output,
    value: stableValue(output.value) as Readonly<Record<string, unknown>>
  };
}

export function generateManifest(
  plugin: PluginDefinition,
  existingNativeManifest?: Readonly<Record<string, unknown>>
): ManifestOutput {
  let output: ManifestOutput;
  switch (plugin.target.type) {
    case "mcp":
      output = generateMcpManifest(plugin);
      break;
    case "vscode":
      output = generateVscodeManifest(plugin, existingNativeManifest);
      break;
    case "chrome":
      output = generateChromeManifest(plugin);
      break;
    case "webhook":
      output = generateWebhookManifest(plugin);
      break;
  }
  return stableOutput(output);
}

export function validateNativeManifest(
  output: ManifestOutput
): readonly Diagnostic[] {
  let diagnostics: readonly Diagnostic[];
  switch (output.target) {
    case "mcp":
      diagnostics = validateMcpManifest(output.value);
      break;
    case "vscode":
      diagnostics = validateVscodeManifest(output.value);
      break;
    case "chrome":
      diagnostics = validateChromeManifest(output.value);
      break;
    case "webhook":
      diagnostics = validateWebhookManifest(output.value);
      break;
  }
  return sortDiagnostics(diagnostics);
}

export function generateAndValidateManifest(
  plugin: PluginDefinition,
  existingNativeManifest?: Readonly<Record<string, unknown>>
): ValidationResult<ManifestOutput> {
  const output = generateManifest(plugin, existingNativeManifest);
  const diagnostics = validateNativeManifest(output);
  return hasErrors(diagnostics)
    ? {
        ok: false,
        diagnostics
      }
    : {
        ok: true,
        value: output,
        diagnostics
      };
}

export function stringifyManifest(output: ManifestOutput): string {
  return `${JSON.stringify(stableValue(output.value), undefined, 2)}\n`;
}

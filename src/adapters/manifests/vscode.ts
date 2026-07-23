import { diagnostic } from "../../core/diagnostics.js";
import type {
  Diagnostic,
  ManifestOutput,
  PluginDefinition
} from "../../core/model.js";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function modulePath(entry: string): string {
  return entry.startsWith("./") ? entry : `./${entry}`;
}

export function generateVscodeManifest(
  plugin: PluginDefinition,
  existing?: Readonly<Record<string, unknown>>
): ManifestOutput {
  if (plugin.target.type !== "vscode") {
    throw new TypeError(
      "The VS Code manifest adapter requires a VS Code plugin."
    );
  }

  const existingEngines = isRecord(existing?.["engines"])
    ? existing["engines"]
    : {};
  const existingContributes = isRecord(existing?.["contributes"])
    ? existing["contributes"]
    : {};
  const commands = plugin.capabilities
    .filter(({ type }) => type === "vscode.command")
    .map((capability) => ({
      command: capability.command ?? "",
      title: capability.title,
      category: plugin.metadata.name
    }))
    .sort((left, right) => left.command.localeCompare(right.command));

  return {
    target: "vscode",
    fileName: "package.json",
    value: {
      ...(existing ?? {}),
      name: plugin.metadata.package,
      displayName: plugin.metadata.name,
      description: plugin.metadata.description,
      version: plugin.metadata.version,
      license: plugin.metadata.license,
      publisher: plugin.target.publisher,
      engines: {
        ...existingEngines,
        vscode: plugin.target.engine
      },
      main: modulePath(plugin.runtime.entry),
      activationEvents: commands.map(({ command }) => `onCommand:${command}`),
      contributes: {
        ...existingContributes,
        commands
      }
    }
  };
}

export function validateVscodeManifest(value: unknown): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    return [
      diagnostic(
        "PPF_NATIVE_VSCODE_OBJECT",
        "VS Code package.json must contain a JSON object.",
        "error",
        "package.json"
      )
    ];
  }

  for (const field of [
    "name",
    "displayName",
    "description",
    "publisher",
    "main"
  ] as const) {
    if (!nonEmptyString(value[field])) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_VSCODE_REQUIRED",
          `VS Code package field "${field}" must be a non-empty string.`,
          "error",
          `package.json.${field}`
        )
      );
    }
  }
  if (
    !nonEmptyString(value["version"]) ||
    !SEMVER_PATTERN.test(value["version"])
  ) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_VSCODE_VERSION",
        "VS Code extension version must be an exact semantic version.",
        "error",
        "package.json.version"
      )
    );
  }

  const engines = isRecord(value["engines"]) ? value["engines"] : undefined;
  if (engines === undefined || !nonEmptyString(engines["vscode"])) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_VSCODE_ENGINE",
        "VS Code package.json must declare engines.vscode.",
        "error",
        "package.json.engines.vscode"
      )
    );
  }

  const activationEvents = Array.isArray(value["activationEvents"])
    ? value["activationEvents"]
    : undefined;
  if (
    activationEvents === undefined ||
    activationEvents.some((event) => !nonEmptyString(event))
  ) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_VSCODE_ACTIVATION",
        "VS Code activationEvents must be an array of non-empty strings.",
        "error",
        "package.json.activationEvents"
      )
    );
  }

  const contributes = isRecord(value["contributes"])
    ? value["contributes"]
    : undefined;
  const commands =
    contributes !== undefined && Array.isArray(contributes["commands"])
      ? contributes["commands"]
      : undefined;
  if (commands === undefined || commands.length === 0) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_VSCODE_COMMANDS",
        "VS Code package.json must contribute at least one command.",
        "error",
        "package.json.contributes.commands"
      )
    );
    return diagnostics;
  }

  const commandIds = new Set<string>();
  commands.forEach((candidate, index) => {
    const commandPath = `package.json.contributes.commands[${String(index)}]`;
    if (
      !isRecord(candidate) ||
      !nonEmptyString(candidate["command"]) ||
      !nonEmptyString(candidate["title"])
    ) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_VSCODE_COMMAND",
          "Each VS Code command requires non-empty command and title fields.",
          "error",
          commandPath
        )
      );
      return;
    }
    if (commandIds.has(candidate["command"])) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_VSCODE_COMMAND_DUPLICATE",
          `VS Code command "${candidate["command"]}" is duplicated.`,
          "error",
          `${commandPath}.command`
        )
      );
    }
    commandIds.add(candidate["command"]);
    if (
      activationEvents !== undefined &&
      !activationEvents.includes(`onCommand:${candidate["command"]}`)
    ) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_VSCODE_COMMAND_INACTIVE",
          `VS Code command "${candidate["command"]}" has no matching activation event.`,
          "error",
          "package.json.activationEvents"
        )
      );
    }
  });

  return diagnostics;
}

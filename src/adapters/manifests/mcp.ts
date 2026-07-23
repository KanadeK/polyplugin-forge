import { diagnostic } from "../../core/diagnostics.js";
import type {
  Diagnostic,
  ManifestOutput,
  PluginDefinition
} from "../../core/model.js";

export const MCP_SERVER_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function generateMcpManifest(plugin: PluginDefinition): ManifestOutput {
  if (plugin.target.type !== "mcp") {
    throw new TypeError("The MCP manifest adapter requires an MCP plugin.");
  }

  const environmentVariables = plugin.permissions
    .filter(({ kind }) => kind === "secrets.env")
    .flatMap(({ reason, resources }) =>
      resources.map((name) => ({
        name,
        description: reason,
        isRequired: true,
        isSecret: true
      }))
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const packageDefinition: Record<string, unknown> = {
    registryType: plugin.target.registry.type,
    identifier: plugin.target.registry.package,
    version: plugin.metadata.version,
    transport: {
      type: plugin.target.transport
    }
  };

  if (environmentVariables.length > 0) {
    packageDefinition["environmentVariables"] = environmentVariables;
  }

  return {
    target: "mcp",
    fileName: "server.json",
    value: {
      $schema: MCP_SERVER_SCHEMA,
      name: plugin.metadata.id,
      description: plugin.metadata.description,
      version: plugin.metadata.version,
      packages: [packageDefinition]
    }
  };
}

export function validateMcpManifest(value: unknown): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    return [
      diagnostic(
        "PPF_NATIVE_MCP_OBJECT",
        "server.json must contain a JSON object.",
        "error",
        "server.json"
      )
    ];
  }

  if (value["$schema"] !== MCP_SERVER_SCHEMA) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_MCP_SCHEMA",
        "server.json must reference the supported MCP Registry schema.",
        "error",
        "server.json.$schema"
      )
    );
  }
  for (const field of ["name", "description"] as const) {
    if (!nonEmptyString(value[field])) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_MCP_REQUIRED",
          `MCP manifest field "${field}" must be a non-empty string.`,
          "error",
          `server.json.${field}`
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
        "PPF_NATIVE_MCP_VERSION",
        "MCP manifest version must be an exact semantic version.",
        "error",
        "server.json.version"
      )
    );
  }

  if (!Array.isArray(value["packages"]) || value["packages"].length === 0) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_MCP_PACKAGES",
        "MCP manifest must declare at least one package.",
        "error",
        "server.json.packages"
      )
    );
    return diagnostics;
  }

  value["packages"].forEach((candidate, packageIndex) => {
    const packagePath = `server.json.packages[${String(packageIndex)}]`;
    if (!isRecord(candidate)) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_MCP_PACKAGE_OBJECT",
          "Each MCP package must be an object.",
          "error",
          packagePath
        )
      );
      return;
    }

    if (candidate["registryType"] !== "npm") {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_MCP_REGISTRY",
          'The MVP MCP adapter supports registryType "npm".',
          "error",
          `${packagePath}.registryType`
        )
      );
    }
    if (!nonEmptyString(candidate["identifier"])) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_MCP_IDENTIFIER",
          "MCP package identifier must be a non-empty string.",
          "error",
          `${packagePath}.identifier`
        )
      );
    }
    if (
      !nonEmptyString(candidate["version"]) ||
      !SEMVER_PATTERN.test(candidate["version"])
    ) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_MCP_PACKAGE_VERSION",
          "MCP package version must be an exact semantic version.",
          "error",
          `${packagePath}.version`
        )
      );
    }

    if (
      !isRecord(candidate["transport"]) ||
      (candidate["transport"]["type"] !== "stdio" &&
        candidate["transport"]["type"] !== "streamable-http")
    ) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_MCP_TRANSPORT",
          "MCP package transport must be stdio or streamable-http.",
          "error",
          `${packagePath}.transport`
        )
      );
    }

    if (candidate["environmentVariables"] === undefined) {
      return;
    }
    if (!Array.isArray(candidate["environmentVariables"])) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_MCP_ENV",
          "MCP environmentVariables must be an array.",
          "error",
          `${packagePath}.environmentVariables`
        )
      );
      return;
    }

    const names = new Set<string>();
    candidate["environmentVariables"].forEach((environmentVariable, index) => {
      const variablePath = `${packagePath}.environmentVariables[${String(index)}]`;
      if (
        !isRecord(environmentVariable) ||
        !nonEmptyString(environmentVariable["name"]) ||
        !nonEmptyString(environmentVariable["description"]) ||
        environmentVariable["isRequired"] !== true ||
        environmentVariable["isSecret"] !== true
      ) {
        diagnostics.push(
          diagnostic(
            "PPF_NATIVE_MCP_ENV_ENTRY",
            "Secret environment variables require name, description, isRequired=true, and isSecret=true.",
            "error",
            variablePath
          )
        );
        return;
      }
      if (names.has(environmentVariable["name"])) {
        diagnostics.push(
          diagnostic(
            "PPF_NATIVE_MCP_ENV_DUPLICATE",
            `Environment variable "${environmentVariable["name"]}" is duplicated.`,
            "error",
            `${variablePath}.name`
          )
        );
      }
      names.add(environmentVariable["name"]);
    });
  });

  return diagnostics;
}

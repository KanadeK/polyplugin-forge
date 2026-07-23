import { diagnostic } from "../../core/diagnostics.js";
import type {
  CapabilityDefinition,
  Diagnostic,
  ManifestOutput,
  PluginDefinition
} from "../../core/model.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function operationFor(
  plugin: PluginDefinition,
  capability: CapabilityDefinition
): Readonly<Record<string, unknown>> {
  const operation: Record<string, unknown> = {
    operationId: capability.id,
    summary: capability.title,
    description: capability.description,
    responses: {
      "200": {
        description: "Successful response"
      }
    },
    security:
      plugin.target.type === "webhook" &&
      plugin.target.authentication === "bearer"
        ? [{ bearerAuth: [] }]
        : [],
    "x-polyplugin-handler": capability.handler,
    "x-polyplugin-permissions": [...capability.permissions].sort()
  };

  if (capability.inputSchema !== undefined) {
    operation["requestBody"] = {
      required: true,
      content: {
        "application/json": {
          schema: {
            $ref: capability.inputSchema.replaceAll("\\", "/")
          }
        }
      }
    };
  }

  return operation;
}

export function generateWebhookManifest(
  plugin: PluginDefinition
): ManifestOutput {
  if (plugin.target.type !== "webhook") {
    throw new TypeError(
      "The webhook manifest adapter requires a webhook plugin."
    );
  }

  const paths: Record<string, Record<string, unknown>> = {};
  const capabilities = plugin.capabilities
    .filter(({ type }) => type.startsWith("webhook."))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const capability of capabilities) {
    const path = capability.path ?? "";
    const method = capability.method?.toLowerCase() ?? "";
    const pathItem = paths[path] ?? {};
    pathItem[method] = operationFor(plugin, capability);
    paths[path] = pathItem;
  }

  const dataFlows = plugin.dataFlows
    .map((dataFlow) => ({
      id: dataFlow.id,
      capability: dataFlow.capability,
      direction: dataFlow.direction,
      source: dataFlow.source,
      destination: dataFlow.destination,
      data: dataFlow.data,
      purpose: dataFlow.purpose,
      retention: dataFlow.retention
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    target: "webhook",
    fileName: "openapi.json",
    value: {
      openapi: plugin.target.openapiVersion,
      info: {
        title: plugin.metadata.name,
        version: plugin.metadata.version,
        description: plugin.metadata.description,
        license: {
          name: plugin.metadata.license
        }
      },
      servers: [
        {
          url: `http://${plugin.target.host}:{port}`,
          variables: {
            port: {
              default: "3000",
              description: "Local webhook server port"
            }
          }
        }
      ],
      paths,
      ...(plugin.target.authentication === "bearer"
        ? {
            components: {
              securitySchemes: {
                bearerAuth: {
                  type: "http",
                  scheme: "bearer"
                }
              }
            }
          }
        : {}),
      "x-polyplugin-runtime-entry": plugin.runtime.entry,
      "x-polyplugin-data-flows": dataFlows
    }
  };
}

export function validateWebhookManifest(value: unknown): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    return [
      diagnostic(
        "PPF_NATIVE_WEBHOOK_OBJECT",
        "openapi.json must contain a JSON object.",
        "error",
        "openapi.json"
      )
    ];
  }

  if (value["openapi"] !== "3.1.0") {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_WEBHOOK_OPENAPI",
        "Webhook manifest must use OpenAPI 3.1.0.",
        "error",
        "openapi.json.openapi"
      )
    );
  }
  const info = isRecord(value["info"]) ? value["info"] : undefined;
  for (const field of ["title", "version", "description"] as const) {
    if (info === undefined || !nonEmptyString(info[field])) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_WEBHOOK_INFO",
          `OpenAPI info.${field} must be a non-empty string.`,
          "error",
          `openapi.json.info.${field}`
        )
      );
    }
  }
  if (!nonEmptyString(value["x-polyplugin-runtime-entry"])) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_WEBHOOK_ENTRY",
        "Webhook manifest must identify its non-empty runtime entry.",
        "error",
        "openapi.json.x-polyplugin-runtime-entry"
      )
    );
  }

  const paths = isRecord(value["paths"]) ? value["paths"] : undefined;
  if (paths === undefined || Object.keys(paths).length === 0) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_WEBHOOK_PATHS",
        "Webhook OpenAPI manifest must contain at least one path.",
        "error",
        "openapi.json.paths"
      )
    );
    return diagnostics;
  }

  const operationIds = new Set<string>();
  let bearerAuthenticationUsed = false;
  for (const [path, candidate] of Object.entries(paths)) {
    const pathLocation = `openapi.json.paths.${path}`;
    if (!path.startsWith("/")) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_WEBHOOK_PATH",
          `Webhook path "${path}" must begin with "/".`,
          "error",
          pathLocation
        )
      );
    }
    if (!isRecord(candidate)) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_WEBHOOK_PATH_ITEM",
          "Each OpenAPI path item must be an object.",
          "error",
          pathLocation
        )
      );
      continue;
    }

    for (const [method, operationCandidate] of Object.entries(candidate)) {
      const operationPath = `${pathLocation}.${method}`;
      if (
        !HTTP_METHODS.includes(method as (typeof HTTP_METHODS)[number]) ||
        !isRecord(operationCandidate)
      ) {
        diagnostics.push(
          diagnostic(
            "PPF_NATIVE_WEBHOOK_OPERATION",
            `Webhook operation "${method}" is not a supported HTTP operation object.`,
            "error",
            operationPath
          )
        );
        continue;
      }
      if (!nonEmptyString(operationCandidate["operationId"])) {
        diagnostics.push(
          diagnostic(
            "PPF_NATIVE_WEBHOOK_OPERATION_ID",
            "Every webhook operation requires a non-empty operationId.",
            "error",
            `${operationPath}.operationId`
          )
        );
      } else if (operationIds.has(operationCandidate["operationId"])) {
        diagnostics.push(
          diagnostic(
            "PPF_NATIVE_WEBHOOK_OPERATION_DUPLICATE",
            `OpenAPI operationId "${operationCandidate["operationId"]}" is duplicated.`,
            "error",
            `${operationPath}.operationId`
          )
        );
      } else {
        operationIds.add(operationCandidate["operationId"]);
      }
      if (
        !isRecord(operationCandidate["responses"]) ||
        Object.keys(operationCandidate["responses"]).length === 0
      ) {
        diagnostics.push(
          diagnostic(
            "PPF_NATIVE_WEBHOOK_RESPONSES",
            "Every webhook operation requires at least one response.",
            "error",
            `${operationPath}.responses`
          )
        );
      }
      if (
        Array.isArray(operationCandidate["security"]) &&
        operationCandidate["security"].some(
          (requirement) =>
            isRecord(requirement) && Object.hasOwn(requirement, "bearerAuth")
        )
      ) {
        bearerAuthenticationUsed = true;
      }
    }
  }

  if (bearerAuthenticationUsed) {
    const components = isRecord(value["components"])
      ? value["components"]
      : undefined;
    const schemes =
      components !== undefined && isRecord(components["securitySchemes"])
        ? components["securitySchemes"]
        : undefined;
    const bearer =
      schemes !== undefined && isRecord(schemes["bearerAuth"])
        ? schemes["bearerAuth"]
        : undefined;
    if (bearer?.["type"] !== "http" || bearer["scheme"] !== "bearer") {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_WEBHOOK_BEARER",
          "Operations using bearerAuth require an HTTP bearer security scheme.",
          "error",
          "openapi.json.components.securitySchemes.bearerAuth"
        )
      );
    }
  }

  return diagnostics;
}

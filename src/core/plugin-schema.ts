import { Buffer } from "node:buffer";

import { parseDocument, visit } from "yaml";
import { z } from "zod";

import { diagnostic, sortDiagnostics } from "./diagnostics.js";
import {
  PERMISSION_KINDS,
  type Diagnostic,
  type PluginDefinition,
  type ValidationResult
} from "./model.js";
import { validatePluginDefinition } from "./semantic-validator.js";

const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_YAML_ALIASES = 32;
const MAX_YAML_DEPTH = 64;
const MAX_YAML_NODES = 10_000;

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u);
const nonBlankSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => {
    return value.trim().length > 0;
  });
const shortNonBlankSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => {
    return value.trim().length > 0;
  });
const relativePathCandidateSchema = z.string().max(512);

const metadataSchema = z
  .object({
    id: identifierSchema,
    name: shortNonBlankSchema,
    version: z
      .string()
      .regex(
        /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
      ),
    description: nonBlankSchema,
    license: z.string().min(1).max(64),
    package: z.string().min(1).max(214)
  })
  .strict();

const runtimeSchema = z
  .object({
    language: z.literal("node"),
    node: z.string().min(1).max(128),
    source: relativePathCandidateSchema,
    entry: relativePathCandidateSchema
  })
  .strict();

const mcpTargetSchema = z
  .object({
    type: z.literal("mcp"),
    protocolVersion: z.string().min(1).max(64),
    transport: z.enum(["stdio", "streamable-http"]),
    registry: z
      .object({
        type: z.literal("npm"),
        package: z.string().min(1).max(214)
      })
      .strict()
  })
  .strict();

const vscodeTargetSchema = z
  .object({
    type: z.literal("vscode"),
    publisher: z.string().min(1).max(128),
    engine: z.string().min(1).max(128)
  })
  .strict();

const chromeTargetSchema = z
  .object({
    type: z.literal("chrome"),
    manifestVersion: z.literal(3),
    minimumChromeVersion: z.string().min(1).max(32)
  })
  .strict();

const webhookTargetSchema = z
  .object({
    type: z.literal("webhook"),
    openapiVersion: z.literal("3.1.0"),
    host: z.enum(["127.0.0.1", "localhost"]),
    authentication: z.enum(["none", "bearer"])
  })
  .strict();

export const targetDefinitionSchema = z.discriminatedUnion("type", [
  mcpTargetSchema,
  vscodeTargetSchema,
  chromeTargetSchema,
  webhookTargetSchema
]);

const permissionSchema = z
  .object({
    id: identifierSchema,
    kind: z.enum(PERMISSION_KINDS),
    resources: z.array(z.string().min(1).max(2048)).max(64),
    reason: nonBlankSchema
  })
  .strict();

const capabilitySchema = z
  .object({
    id: identifierSchema,
    type: z.enum([
      "mcp.tool",
      "mcp.resource",
      "mcp.prompt",
      "vscode.command",
      "chrome.popup",
      "chrome.action",
      "chrome.background",
      "webhook.route"
    ]),
    name: shortNonBlankSchema,
    title: shortNonBlankSchema,
    description: nonBlankSchema,
    handler: z.string().min(1).max(512),
    permissions: z.array(identifierSchema).max(64),
    tests: z.array(z.string().min(1).max(512)).max(128),
    inputSchema: z.string().min(1).max(512).optional(),
    command: z.string().min(1).max(256).optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
    path: z.string().min(1).max(512).optional()
  })
  .strict();

const dataFlowSchema = z
  .object({
    id: identifierSchema,
    capability: identifierSchema,
    direction: z.enum(["inbound", "outbound"]),
    source: shortNonBlankSchema,
    destination: shortNonBlankSchema,
    data: z
      .array(
        z
          .object({
            name: shortNonBlankSchema,
            classification: z.enum([
              "public",
              "user-content",
              "personal",
              "credential"
            ])
          })
          .strict()
      )
      .min(1)
      .max(128),
    purpose: nonBlankSchema,
    retention: z.enum(["none", "memory", "session", "persistent"])
  })
  .strict();

const privacySchema = z
  .object({
    notice: z.string().max(4096),
    collectsPersonalData: z.boolean(),
    telemetry: z.boolean()
  })
  .strict();

const compatibilitySchema = z
  .object({
    os: z.array(z.enum(["linux", "darwin", "win32"])).min(1),
    arch: z.array(z.enum(["x64", "arm64"])).min(1),
    targetVersions: z.array(z.string().min(1).max(128)).min(1),
    features: z.array(z.string().min(1).max(128))
  })
  .strict();

const testsSchema = z
  .object({
    command: z.tuple([z.string().min(1).max(512)], z.string().min(1).max(512))
  })
  .strict();

const riskAcceptanceSchema = z
  .object({
    reason: nonBlankSchema,
    trackingUrl: z.url().max(2048)
  })
  .strict();

export const pluginDefinitionSchema = z
  .object({
    apiVersion: z.literal("polyplugin.dev/v1alpha1"),
    kind: z.literal("Plugin"),
    metadata: metadataSchema,
    runtime: runtimeSchema,
    target: targetDefinitionSchema,
    capabilities: z.array(capabilitySchema).min(1).max(256),
    permissions: z.array(permissionSchema).max(256),
    dataFlows: z.array(dataFlowSchema).max(256),
    privacy: privacySchema,
    compatibility: compatibilitySchema,
    tests: testsSchema,
    riskAcceptance: riskAcceptanceSchema.optional()
  })
  .strict();

function zodPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") {
      return `${result}[${String(segment)}]`;
    }

    if (typeof segment === "string" && /^[A-Za-z_$][\w$]*$/u.test(segment)) {
      return `${result}.${segment}`;
    }

    return result;
  }, "$");
}

function schemaDiagnostic(issue: z.core.$ZodIssue): Diagnostic {
  const path = zodPath(issue.path);

  if (
    issue.code === "invalid_type" &&
    issue.path.at(-1) === "tests" &&
    issue.path.at(-3) === "capabilities"
  ) {
    return diagnostic(
      "CAPABILITY_TESTS_REQUIRED",
      "Every capability must declare a tests array.",
      "error",
      path
    );
  }

  const code =
    issue.code === "unrecognized_keys"
      ? "SCHEMA_UNKNOWN_FIELD"
      : "SCHEMA_INVALID";

  return diagnostic(
    code,
    code === "SCHEMA_UNKNOWN_FIELD"
      ? "Manifest contains a field that is not part of the schema."
      : "Manifest field does not match the required schema.",
    "error",
    path
  );
}

function yamlErrorDiagnostic(code: string): Diagnostic {
  if (code === "DUPLICATE_KEY") {
    return diagnostic(
      "YAML_DUPLICATE_KEY",
      "YAML mapping keys must be unique.",
      "error",
      "$"
    );
  }

  if (code === "TAG_RESOLVE_FAILED" || code === "MULTIPLE_TAGS") {
    return diagnostic(
      "YAML_TAG_NOT_ALLOWED",
      "Explicit or custom YAML tags are not allowed.",
      "error",
      "$"
    );
  }

  return diagnostic(
    "YAML_PARSE_ERROR",
    "Manifest is not valid YAML.",
    "error",
    "$"
  );
}

function uniqueDiagnostics(
  diagnostics: readonly Diagnostic[]
): readonly Diagnostic[] {
  const seen = new Set<string>();

  return diagnostics.filter((item) => {
    const key = `${item.code}\u0000${item.path ?? ""}\u0000${item.message}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function parsePluginManifest(
  source: string
): ValidationResult<PluginDefinition> {
  if (Buffer.byteLength(source, "utf8") > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "MANIFEST_TOO_LARGE",
          "Manifest exceeds the 512 KiB size limit.",
          "error",
          "$"
        )
      ]
    };
  }

  const document = parseDocument(source, {
    customTags: [],
    merge: false,
    prettyErrors: false,
    resolveKnownTags: false,
    schema: "core",
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    version: "1.2"
  });

  if (document.errors.length > 0) {
    const diagnostics = document.errors.map(({ code }) =>
      yamlErrorDiagnostic(code)
    );
    return {
      ok: false,
      diagnostics: sortDiagnostics(uniqueDiagnostics(diagnostics))
    };
  }

  const yamlComplexity = {
    aliasCount: 0,
    nodeCount: 0,
    forbiddenTag: false,
    excessiveDepth: false
  };

  visit(document, {
    Alias() {
      yamlComplexity.aliasCount += 1;
    },
    Node(_key, node, path) {
      yamlComplexity.nodeCount += 1;
      if (node.tag !== undefined) {
        yamlComplexity.forbiddenTag = true;
      }
      if (path.length > MAX_YAML_DEPTH) {
        yamlComplexity.excessiveDepth = true;
      }
    }
  });

  if (yamlComplexity.forbiddenTag) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "YAML_TAG_NOT_ALLOWED",
          "Explicit or custom YAML tags are not allowed.",
          "error",
          "$"
        )
      ]
    };
  }

  if (yamlComplexity.aliasCount > MAX_YAML_ALIASES) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "YAML_ALIAS_LIMIT",
          "Manifest exceeds the YAML alias safety limit.",
          "error",
          "$"
        )
      ]
    };
  }

  if (
    yamlComplexity.nodeCount > MAX_YAML_NODES ||
    yamlComplexity.excessiveDepth
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "YAML_COMPLEXITY_LIMIT",
          "Manifest exceeds the YAML complexity safety limit.",
          "error",
          "$"
        )
      ]
    };
  }

  let value: unknown;
  try {
    value = document.toJS({
      mapAsMap: false,
      maxAliasCount: MAX_YAML_ALIASES
    }) as unknown;
  } catch {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "YAML_ALIAS_LIMIT",
          "Manifest exceeds the YAML alias safety limit.",
          "error",
          "$"
        )
      ]
    };
  }

  const parsed = pluginDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: sortDiagnostics(
        uniqueDiagnostics(parsed.error.issues.map(schemaDiagnostic))
      )
    };
  }

  return validatePluginDefinition(parsed.data as PluginDefinition);
}

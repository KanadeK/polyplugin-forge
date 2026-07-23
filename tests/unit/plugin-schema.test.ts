import { describe, expect, it } from "vitest";

import { parsePluginManifest } from "../../src/core/plugin-schema.js";
import { validatePluginDefinition } from "../../src/core/semantic-validator.js";
import type {
  CapabilityDefinition,
  PluginDefinition,
  TargetDefinition
} from "../../src/core/model.js";

function validPlugin(
  overrides: Partial<PluginDefinition> = {}
): PluginDefinition {
  return {
    apiVersion: "polyplugin.dev/v1alpha1",
    kind: "Plugin",
    metadata: {
      id: "hello-plugin",
      name: "Hello plugin",
      version: "1.2.3",
      description: "A deterministic hello-world plugin.",
      license: "MIT",
      package: "@polyplugin/hello-plugin"
    },
    runtime: {
      language: "node",
      node: ">=22.0.0",
      source: "src",
      entry: "src/index.ts"
    },
    target: {
      type: "mcp",
      protocolVersion: "2025-06-18",
      transport: "stdio",
      registry: {
        type: "npm",
        package: "@polyplugin/hello-plugin"
      }
    },
    capabilities: [
      {
        id: "say-hello",
        type: "mcp.tool",
        name: "say_hello",
        title: "Say hello",
        description: "Returns a greeting.",
        handler: "src/hello.ts",
        permissions: [],
        tests: ["tests/hello.test.ts"],
        inputSchema: "schemas/hello.input.json"
      }
    ],
    permissions: [],
    dataFlows: [],
    privacy: {
      notice: "",
      collectsPersonalData: false,
      telemetry: false
    },
    compatibility: {
      os: ["linux", "darwin", "win32"],
      arch: ["x64", "arm64"],
      targetVersions: ["2025-06-18"],
      features: []
    },
    tests: {
      command: ["npm", "test"]
    },
    ...overrides
  };
}

const VALID_YAML = `apiVersion: polyplugin.dev/v1alpha1
kind: Plugin
metadata:
  id: hello-plugin
  name: Hello plugin
  version: 1.2.3
  description: A deterministic hello-world plugin.
  license: MIT
  package: "@polyplugin/hello-plugin"
runtime:
  language: node
  node: ">=22.0.0"
  source: src
  entry: src/index.ts
target:
  type: mcp
  protocolVersion: "2025-06-18"
  transport: stdio
  registry:
    type: npm
    package: "@polyplugin/hello-plugin"
capabilities:
  - id: say-hello
    type: mcp.tool
    name: say_hello
    title: Say hello
    description: Returns a greeting.
    handler: src/hello.ts
    permissions: []
    tests: [tests/hello.test.ts]
    inputSchema: schemas/hello.input.json
permissions: []
dataFlows: []
privacy:
  notice: ""
  collectsPersonalData: false
  telemetry: false
compatibility:
  os: [linux, darwin, win32]
  arch: [x64, arm64]
  targetVersions: ["2025-06-18"]
  features: []
tests:
  command: [npm, test]
`;

function diagnosticCodes(result: {
  readonly diagnostics: readonly { readonly code: string }[];
}): string[] {
  return result.diagnostics.map(({ code }) => code);
}

function firstCapability(): CapabilityDefinition {
  const capability = validPlugin().capabilities[0];
  if (capability === undefined) {
    throw new Error("Test fixture must contain a capability");
  }

  return capability;
}

describe("parsePluginManifest", () => {
  it("parses a complete manifest and returns its canonical typed value", () => {
    const result = parsePluginManifest(VALID_YAML);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.value?.target.type).toBe("mcp");
    expect(result.value?.capabilities[0]?.type).toBe("mcp.tool");
  });

  it.each([
    [
      {
        type: "mcp",
        protocolVersion: "2025-06-18",
        transport: "stdio",
        registry: { type: "npm", package: "@polyplugin/test" }
      },
      "mcp.tool"
    ],
    [
      { type: "vscode", publisher: "polyplugin", engine: "^1.100.0" },
      "vscode.command"
    ],
    [
      {
        type: "chrome",
        manifestVersion: 3,
        minimumChromeVersion: "120"
      },
      "chrome.popup"
    ],
    [
      {
        type: "webhook",
        openapiVersion: "3.1.0",
        host: "127.0.0.1",
        authentication: "none"
      },
      "webhook.route"
    ]
  ] as const)(
    "accepts the %s target through the discriminated target schema",
    (target, capabilityType) => {
      const plugin = validPlugin({
        target: target as TargetDefinition,
        capabilities: [
          {
            ...firstCapability(),
            type: capabilityType
          }
        ]
      });

      const result = validatePluginDefinition(plugin);

      expect(result.ok).toBe(true);
    }
  );

  it("rejects duplicate YAML keys without echoing source values", () => {
    const source = `${VALID_YAML}\nkind: secret-value-that-must-not-leak\n`;
    const result = parsePluginManifest(source);

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toContain("YAML_DUPLICATE_KEY");
    expect(JSON.stringify(result.diagnostics)).not.toContain(
      "secret-value-that-must-not-leak"
    );
  });

  it("rejects explicit YAML tags", () => {
    const result = parsePluginManifest(
      VALID_YAML.replace("name: Hello plugin", "name: !!str Hello plugin")
    );

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toContain("YAML_TAG_NOT_ALLOWED");
  });

  it("rejects manifests that exceed the byte-size limit", () => {
    const result = parsePluginManifest(`secret: ${"x".repeat(512 * 1024)}`);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "MANIFEST_TOO_LARGE" })
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain("xxxxx");
  });

  it("limits YAML aliases before converting the document to JavaScript", () => {
    const aliases = Array.from({ length: 33 }, () => "*shared").join(", ");
    const result = parsePluginManifest(
      `shared: &shared [one, two]\nexpanded: [${aliases}]\n`
    );

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toContain("YAML_ALIAS_LIMIT");
  });

  it("reports a missing capability tests array with a stable diagnostic", () => {
    const source = VALID_YAML.replace("    tests: [tests/hello.test.ts]\n", "");
    const first = parsePluginManifest(source);
    const second = parsePluginManifest(source);

    expect(first.ok).toBe(false);
    expect(first.diagnostics).toEqual(second.diagnostics);
    expect(first.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "CAPABILITY_TESTS_REQUIRED",
        path: "$.capabilities[0].tests"
      })
    );
  });

  it("rejects unknown schema fields without exposing their names or values", () => {
    const result = parsePluginManifest(
      VALID_YAML.replace(
        "  telemetry: false",
        "  telemetry: false\n  privateApiToken: do-not-print-this"
      )
    );
    const serialized = JSON.stringify(result.diagnostics);

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toContain("SCHEMA_UNKNOWN_FIELD");
    expect(serialized).not.toContain("privateApiToken");
    expect(serialized).not.toContain("do-not-print-this");
  });
});

describe("validatePluginDefinition", () => {
  it("detects duplicate IDs in every independent ID namespace", () => {
    const capability = firstCapability();
    const permission = {
      id: "network",
      kind: "network.connect" as const,
      resources: ["https://example.test"],
      reason: "Fetch a greeting."
    };
    const dataFlow = {
      id: "request",
      capability: "say-hello",
      direction: "outbound" as const,
      source: "plugin",
      destination: "example.test",
      data: [{ name: "locale", classification: "public" as const }],
      purpose: "Select a greeting.",
      retention: "none" as const
    };
    const result = validatePluginDefinition(
      validPlugin({
        capabilities: [
          { ...capability, permissions: ["network"] },
          { ...capability, permissions: ["network"] }
        ],
        permissions: [permission, permission],
        dataFlows: [dataFlow, dataFlow]
      })
    );

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining([
        "DUPLICATE_CAPABILITY_ID",
        "DUPLICATE_PERMISSION_ID",
        "DUPLICATE_DATA_FLOW_ID"
      ])
    );
  });

  it("rejects a capability type from a different target", () => {
    const result = validatePluginDefinition(
      validPlugin({
        capabilities: [
          {
            ...firstCapability(),
            type: "vscode.command"
          }
        ]
      })
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "CAPABILITY_TARGET_MISMATCH",
        path: "$.capabilities[0].type"
      })
    );
  });

  it("detects broken permission and data-flow references", () => {
    const result = validatePluginDefinition(
      validPlugin({
        capabilities: [
          {
            ...firstCapability(),
            permissions: ["missing-permission"]
          }
        ],
        dataFlows: [
          {
            id: "request",
            capability: "missing-capability",
            direction: "outbound",
            source: "plugin",
            destination: "example.test",
            data: [{ name: "locale", classification: "public" }],
            purpose: "Select a greeting.",
            retention: "none"
          }
        ]
      })
    );

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_PERMISSION_REFERENCE",
        "UNKNOWN_DATA_FLOW_CAPABILITY"
      ])
    );
  });

  it("rejects declared permissions that no capability uses", () => {
    const result = validatePluginDefinition(
      validPlugin({
        permissions: [
          {
            id: "local-storage",
            kind: "storage.local",
            resources: ["settings"],
            reason: "Persist user settings."
          }
        ]
      })
    );

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toContain("UNUSED_PERMISSION");
  });

  it.each([
    ["", "src/index.ts", "RUNTIME_PATH_EMPTY"],
    ["/srv/plugin", "src/index.ts", "RUNTIME_PATH_ABSOLUTE"],
    ["C:\\plugin", "src/index.ts", "RUNTIME_PATH_ABSOLUTE"],
    ["src", "../outside.ts", "RUNTIME_PATH_TRAVERSAL"]
  ])("rejects unsafe runtime source %s", (source, entry, expectedCode) => {
    const result = validatePluginDefinition(
      validPlugin({
        runtime: {
          ...validPlugin().runtime,
          source,
          entry
        }
      })
    );

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toContain(expectedCode);
  });

  it("requires every capability to name at least one test", () => {
    const result = validatePluginDefinition(
      validPlugin({
        capabilities: [
          {
            ...firstCapability(),
            tests: []
          }
        ]
      })
    );

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toContain("CAPABILITY_TESTS_REQUIRED");
  });

  it("requires risk acceptance for broad permission resources", () => {
    const permission = {
      id: "all-hosts",
      kind: "network.connect" as const,
      resources: ["https://*"],
      reason: "Connect to a user-selected service."
    };
    const plugin = validPlugin({
      capabilities: [
        {
          ...firstCapability(),
          permissions: ["all-hosts"]
        }
      ],
      permissions: [permission]
    });

    const rejected = validatePluginDefinition(plugin);
    const accepted = validatePluginDefinition({
      ...plugin,
      riskAcceptance: {
        reason: "Users can configure arbitrary self-hosted endpoints.",
        trackingUrl: "https://example.test/security/risks/1"
      }
    });

    expect(rejected.ok).toBe(false);
    expect(diagnosticCodes(rejected)).toContain(
      "BROAD_PERMISSION_REQUIRES_RISK_ACCEPTANCE"
    );
    expect(accepted.ok).toBe(true);
  });

  it("requires disclosure and a notice for personal data flows", () => {
    const result = validatePluginDefinition(
      validPlugin({
        dataFlows: [
          {
            id: "profile",
            capability: "say-hello",
            direction: "inbound",
            source: "user",
            destination: "plugin",
            data: [{ name: "display name", classification: "personal" }],
            purpose: "Personalize the greeting.",
            retention: "session"
          }
        ]
      })
    );

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining([
        "PERSONAL_DATA_FLAG_REQUIRED",
        "PRIVACY_NOTICE_REQUIRED"
      ])
    );
  });

  it("requires a privacy notice when telemetry is enabled", () => {
    const result = validatePluginDefinition(
      validPlugin({
        privacy: {
          notice: "   ",
          collectsPersonalData: false,
          telemetry: true
        }
      })
    );

    expect(result.ok).toBe(false);
    expect(diagnosticCodes(result)).toContain("PRIVACY_NOTICE_REQUIRED");
  });

  it("allows an empty notice for a local plugin with only public data", () => {
    const plugin = validPlugin();
    const result = validatePluginDefinition(plugin);

    expect(result).toEqual({
      ok: true,
      value: plugin,
      diagnostics: []
    });
  });
});

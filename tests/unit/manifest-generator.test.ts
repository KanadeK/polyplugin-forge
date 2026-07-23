import { describe, expect, it } from "vitest";

import {
  generateAndValidateManifest,
  generateManifest,
  stringifyManifest,
  validateNativeManifest
} from "../../src/core/manifest-generator.js";
import type {
  ManifestOutput,
  PluginDefinition,
  TargetDefinition
} from "../../src/core/model.js";

function pluginFor(target: TargetDefinition): PluginDefinition {
  const capabilityByTarget = {
    mcp: {
      id: "hello",
      type: "mcp.tool",
      name: "hello",
      title: "Say hello",
      description: "Returns a greeting.",
      handler: "hello",
      permissions: ["api-token"],
      tests: ["tests/hello.test.ts"],
      inputSchema: "schemas/hello.input.json"
    },
    vscode: {
      id: "hello-command",
      type: "vscode.command",
      name: "hello",
      title: "Say hello",
      description: "Shows a greeting.",
      handler: "helloCommand",
      command: "polyplugin.hello",
      permissions: [],
      tests: ["tests/hello.test.ts"]
    },
    chrome: {
      id: "hello-popup",
      type: "chrome.popup",
      name: "hello",
      title: "Say hello",
      description: "Shows a greeting.",
      handler: "helloPopup",
      path: "popup.html",
      permissions: ["local-state", "example-api"],
      tests: ["tests/hello.test.ts"]
    },
    webhook: {
      id: "hello-route",
      type: "webhook.operation",
      name: "hello",
      title: "Say hello",
      description: "Returns a greeting.",
      handler: "helloRoute",
      method: "POST" as const,
      path: "/hello",
      inputSchema: "schemas/hello.input.json",
      permissions: [],
      tests: ["tests/hello.test.ts"]
    }
  };

  return {
    apiVersion: "polyplugin.dev/v1alpha1",
    kind: "Plugin",
    metadata: {
      id: `hello-${target.type}`,
      name: `Hello ${target.type}`,
      version: "0.1.0",
      description: "A deterministic hello-world plugin.",
      license: "MIT",
      package: `hello-${target.type}`
    },
    runtime: {
      language: "node",
      node: ">=22.0.0 <23",
      source: "src/index.ts",
      entry: "dist/index.js"
    },
    target,
    capabilities: [capabilityByTarget[target.type]],
    permissions:
      target.type === "mcp"
        ? [
            {
              id: "api-token",
              kind: "secrets.env",
              resources: ["HELLO_API_TOKEN"],
              reason: "Authenticates deterministic fixture requests."
            }
          ]
        : target.type === "chrome"
          ? [
              {
                id: "local-state",
                kind: "storage.local",
                resources: ["greeting"],
                reason: "Stores the most recent greeting locally."
              },
              {
                id: "example-api",
                kind: "network.connect",
                resources: ["https://example.test/*"],
                reason: "Connects to the documented example origin."
              }
            ]
          : [],
    dataFlows: [
      {
        id: "hello-input",
        capability: capabilityByTarget[target.type].id,
        direction: "inbound",
        source: "user",
        destination: "plugin",
        data: [{ name: "name", classification: "user-content" }],
        purpose: "Produce a greeting.",
        retention: "none"
      }
    ],
    privacy: {
      notice: "docs/PRIVACY.md",
      collectsPersonalData: false,
      telemetry: false
    },
    compatibility: {
      os: ["linux", "darwin", "win32"],
      arch: ["x64", "arm64"],
      targetVersions: ["1"],
      features: ["hello"]
    },
    tests: {
      command: ["npm", "test"]
    }
  };
}

describe("native manifest generation", () => {
  it("generates an MCP Registry-shaped server.json", () => {
    const result = generateAndValidateManifest(
      pluginFor({
        type: "mcp",
        protocolVersion: "2025-06-18",
        transport: "stdio",
        registry: { type: "npm", package: "hello-mcp" }
      })
    );

    expect(result.ok).toBe(true);
    expect(result.value?.fileName).toBe("server.json");
    expect(result.value?.value).toMatchObject({
      name: "hello-mcp",
      version: "0.1.0",
      packages: [
        {
          registryType: "npm",
          identifier: "hello-mcp",
          transport: { type: "stdio" },
          environmentVariables: [
            {
              name: "HELLO_API_TOKEN",
              isRequired: true,
              isSecret: true
            }
          ]
        }
      ]
    });
  });

  it("generates VS Code package fields and preserves unmanaged fields", () => {
    const output = generateManifest(
      pluginFor({
        type: "vscode",
        publisher: "KanadeK",
        engine: "^1.95.0"
      }),
      {
        private: true,
        scripts: { build: "tsc" },
        engines: { node: ">=22" },
        contributes: { configuration: { title: "Preserved" } }
      }
    );

    expect(validateNativeManifest(output)).toEqual([]);
    expect(output.value).toMatchObject({
      private: true,
      scripts: { build: "tsc" },
      engines: { node: ">=22", vscode: "^1.95.0" },
      activationEvents: ["onCommand:polyplugin.hello"],
      contributes: {
        configuration: { title: "Preserved" },
        commands: [
          {
            command: "polyplugin.hello",
            title: "Say hello",
            category: "Hello vscode"
          }
        ]
      }
    });
  });

  it("generates a Chrome Manifest V3 manifest with native permissions", () => {
    const output = generateManifest(
      pluginFor({
        type: "chrome",
        manifestVersion: 3,
        minimumChromeVersion: "120"
      })
    );

    expect(validateNativeManifest(output)).toEqual([]);
    expect(output.fileName).toBe("manifest.json");
    expect(output.value).toMatchObject({
      manifest_version: 3,
      minimum_chrome_version: "120",
      background: {
        service_worker: "dist/index.js",
        type: "module"
      },
      action: {
        default_popup: "popup.html",
        default_title: "Say hello"
      },
      permissions: ["storage"],
      host_permissions: ["https://example.test/*"]
    });
  });

  it("generates an OpenAPI 3.1 webhook document", () => {
    const output = generateManifest(
      pluginFor({
        type: "webhook",
        openapiVersion: "3.1.0",
        host: "127.0.0.1",
        authentication: "bearer"
      })
    );

    expect(validateNativeManifest(output)).toEqual([]);
    expect(output.fileName).toBe("openapi.json");
    expect(output.value).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/hello": {
          post: {
            operationId: "hello-route",
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "schemas/hello.input.json" }
                }
              }
            },
            security: [{ bearerAuth: [] }]
          }
        }
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" }
        }
      }
    });
  });

  it("reports invalid native manifests without throwing", () => {
    const invalid: ManifestOutput = {
      target: "chrome",
      fileName: "manifest.json",
      value: {
        manifest_version: 2,
        name: "",
        version: "not-a-chrome-version"
      }
    };

    const diagnostics = validateNativeManifest(invalid);
    expect(diagnostics.length).toBeGreaterThanOrEqual(4);
    expect(diagnostics.every(({ severity }) => severity === "error")).toBe(
      true
    );
    expect(diagnostics.map(({ code }) => code)).toContain(
      "PPF_NATIVE_CHROME_VERSION"
    );
  });

  it("uses stable recursive key ordering and emits no timestamp", () => {
    const plugin = pluginFor({
      type: "vscode",
      publisher: "KanadeK",
      engine: "^1.95.0"
    });
    const first = stringifyManifest(
      generateManifest(plugin, {
        zeta: { beta: true, alpha: true },
        alpha: "first"
      })
    );
    const second = stringifyManifest(
      generateManifest(plugin, {
        alpha: "first",
        zeta: { alpha: true, beta: true }
      })
    );

    expect(first).toBe(second);
    expect(first.indexOf('"alpha"')).toBeLessThan(first.indexOf('"zeta"'));
    expect(first).not.toMatch(/generatedAt|timestamp/i);
    expect(first.endsWith("\n")).toBe(true);
  });
});

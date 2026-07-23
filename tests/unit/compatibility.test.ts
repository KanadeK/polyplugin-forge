import { describe, expect, it } from "vitest";

import {
  evaluateCompatibility,
  evaluateCompatibilityMatrix
} from "../../src/core/compatibility.js";

import type {
  CompatibilityEnvironment,
  PluginDefinition
} from "../../src/core/model.js";

function chromePlugin(
  overrides: Partial<PluginDefinition> = {}
): PluginDefinition {
  return {
    apiVersion: "polyplugin.dev/v1alpha1",
    kind: "Plugin",
    metadata: {
      id: "hello.chrome",
      name: "Hello Chrome",
      version: "1.0.0",
      description: "A test plugin",
      license: "MIT",
      package: "@example/hello-chrome"
    },
    runtime: {
      language: "node",
      node: ">=22 <24",
      source: "src/index.ts",
      entry: "dist/index.js"
    },
    target: {
      type: "chrome",
      manifestVersion: 3,
      minimumChromeVersion: "120"
    },
    capabilities: [
      {
        id: "notify",
        type: "notification",
        name: "notify",
        title: "Notify",
        description: "Show a notification",
        handler: "notify",
        permissions: ["notifications"],
        tests: ["tests/notify.test.ts"]
      }
    ],
    permissions: [
      {
        id: "notifications",
        kind: "browser.notifications",
        resources: ["notifications"],
        reason: "Show the requested notification"
      },
      {
        id: "spawn",
        kind: "process.spawn",
        resources: ["node"],
        reason: "Exercise documented-only enforcement"
      }
    ],
    dataFlows: [],
    privacy: {
      notice: "No data leaves the device.",
      collectsPersonalData: false,
      telemetry: false
    },
    compatibility: {
      os: ["linux", "win32"],
      arch: ["x64"],
      targetVersions: [">=120 <130"],
      features: ["manifest-v3"]
    },
    tests: {
      command: ["npm", "test"]
    },
    ...overrides
  };
}

const chromeEnvironment: CompatibilityEnvironment = {
  id: "chrome-124-linux",
  target: "chrome",
  targetVersion: "124.0.0",
  node: "22.4.1",
  os: "linux",
  arch: "x64",
  features: ["manifest-v3"]
};

describe("evaluateCompatibility", () => {
  it("marks a matching environment tested only with complete passing evidence", () => {
    const cell = evaluateCompatibility(chromePlugin(), chromeEnvironment, {
      environmentId: chromeEnvironment.id,
      build: "passed",
      test: "passed",
      probe: "passed"
    });

    expect(cell.status).toBe("compatible-tested");
    expect(cell.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint: "Node version satisfies >=22 <24",
          passed: true,
          evidence: "environment Node version is 22.4.1"
        }),
        expect.objectContaining({
          constraint: "Chrome version is at least 120",
          passed: true,
          evidence: "environment Chrome version is 124.0.0"
        }),
        expect.objectContaining({
          constraint: "probe evidence passed",
          passed: true
        })
      ])
    );
    expect(cell.permissionEnforcement).toEqual([
      { permissionId: "notifications", enforcement: "native" },
      { permissionId: "spawn", enforcement: "documented" }
    ]);
  });

  it("keeps compatible declarations unverified when evidence is absent or partial", () => {
    expect(
      evaluateCompatibility(chromePlugin(), chromeEnvironment).status
    ).toBe("compatible-unverified");

    const partial = evaluateCompatibility(chromePlugin(), chromeEnvironment, {
      environmentId: chromeEnvironment.id,
      build: "passed",
      test: "passed",
      probe: "not-run"
    });
    expect(partial.status).toBe("compatible-unverified");
    expect(partial.checks).toContainEqual({
      constraint: "probe evidence passed",
      passed: false,
      evidence: "probe evidence state is not-run"
    });
  });

  it("reports concrete failed constraints as incompatible", () => {
    const environment: CompatibilityEnvironment = {
      ...chromeEnvironment,
      node: "24.0.0",
      os: "darwin",
      targetVersion: "119.0.0",
      features: []
    };

    const cell = evaluateCompatibility(chromePlugin(), environment);

    expect(cell.status).toBe("incompatible");
    expect(
      cell.checks
        .filter(({ passed }) => !passed)
        .map(({ constraint }) => constraint)
    ).toEqual(
      expect.arrayContaining([
        "operating system is one of linux, win32",
        "Node version satisfies >=22 <24",
        "target version matches one of >=120 <130",
        "feature manifest-v3 is available",
        "Chrome version is at least 120"
      ])
    );
    expect(cell.checks).toContainEqual({
      constraint: "Chrome version is at least 120",
      passed: false,
      evidence: "environment Chrome version is 119.0.0"
    });
  });

  it("uses invalid for malformed constraints and permission references", () => {
    const plugin = chromePlugin({
      runtime: {
        language: "node",
        node: "definitely not a range",
        source: "src/index.ts",
        entry: "dist/index.js"
      },
      compatibility: {
        os: [],
        arch: ["x64"],
        targetVersions: [">=broken"],
        features: []
      },
      capabilities: [
        {
          id: "missing-permission",
          type: "command",
          name: "missing",
          title: "Missing",
          description: "References an undeclared permission",
          handler: "missing",
          permissions: ["not-declared"],
          tests: ["tests/missing.test.ts"]
        }
      ]
    });

    const cell = evaluateCompatibility(plugin, chromeEnvironment);

    expect(cell.status).toBe("invalid");
    expect(cell.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint: "runtime.node is a valid semantic-version range",
          passed: false
        }),
        expect.objectContaining({
          constraint:
            "capability missing-permission references a declared permission",
          passed: false,
          evidence: "permission id not-declared is not declared"
        })
      ])
    );
  });

  it("treats explicit failed runtime evidence as incompatible", () => {
    const cell = evaluateCompatibility(chromePlugin(), chromeEnvironment, {
      environmentId: chromeEnvironment.id,
      build: "passed",
      test: "failed",
      probe: "not-run"
    });

    expect(cell.status).toBe("incompatible");
    expect(cell.checks).toContainEqual({
      constraint: "test evidence passed",
      passed: false,
      evidence: "test evidence state is failed"
    });
  });

  it("supports exact MCP protocol constraints and transport evidence", () => {
    const base = chromePlugin();
    const plugin: PluginDefinition = {
      ...base,
      metadata: { ...base.metadata, id: "hello.mcp" },
      target: {
        type: "mcp",
        protocolVersion: "2025-03-26",
        transport: "stdio",
        registry: {
          type: "npm",
          package: "@example/hello-mcp"
        }
      },
      compatibility: {
        ...base.compatibility,
        targetVersions: ["2025-03-26"],
        features: ["tools"]
      }
    };
    const environment: CompatibilityEnvironment = {
      ...chromeEnvironment,
      id: "mcp-2025-linux",
      target: "mcp",
      targetVersion: "2025-03-26",
      features: ["tools"],
      transport: "stdio"
    };

    const cell = evaluateCompatibility(plugin, environment);

    expect(cell.status).toBe("compatible-unverified");
    expect(cell.checks).toContainEqual({
      constraint: "MCP transport is stdio",
      passed: true,
      evidence: "environment transport is stdio"
    });
  });

  it("evaluates a matrix with environment-specific evidence", () => {
    const secondEnvironment: CompatibilityEnvironment = {
      ...chromeEnvironment,
      id: "chrome-124-windows",
      os: "win32"
    };
    const cells = evaluateCompatibilityMatrix(
      chromePlugin(),
      [chromeEnvironment, secondEnvironment],
      [
        {
          environmentId: secondEnvironment.id,
          build: "passed",
          test: "passed",
          probe: "passed",
          permissionEnforcement: {
            "process.spawn": "runtime"
          }
        }
      ]
    );

    expect(cells.map(({ status }) => status)).toEqual([
      "compatible-unverified",
      "compatible-tested"
    ]);
    expect(cells[1]?.permissionEnforcement).toContainEqual({
      permissionId: "spawn",
      enforcement: "runtime"
    });
  });

  it("invalidates duplicate permissions while retaining mismatch evidence", () => {
    const base = chromePlugin();
    const firstPermission = base.permissions[0];
    if (firstPermission === undefined) {
      throw new Error("chromePlugin fixture must declare a permission");
    }
    const cell = evaluateCompatibility(
      {
        ...base,
        permissions: [firstPermission, firstPermission]
      },
      {
        ...chromeEnvironment,
        target: "vscode",
        arch: "arm64"
      },
      {
        environmentId: "different-environment",
        build: "passed",
        test: "passed",
        probe: "passed"
      }
    );

    expect(cell.status).toBe("invalid");
    expect(cell.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint: "plugin target matches environment target",
          passed: false
        }),
        expect.objectContaining({
          constraint: "permission id notifications is unique",
          passed: false
        }),
        expect.objectContaining({
          constraint: "test evidence belongs to this environment",
          passed: false
        })
      ])
    );
  });

  it("evaluates VS Code and webhook target version rules", () => {
    const base = chromePlugin();
    const vscodePlugin: PluginDefinition = {
      ...base,
      target: {
        type: "vscode",
        publisher: "example",
        engine: "^1.90.0"
      },
      compatibility: {
        ...base.compatibility,
        targetVersions: ["^1.90.0"]
      }
    };
    const vscodeEnvironment: CompatibilityEnvironment = {
      ...chromeEnvironment,
      id: "vscode-1.95-linux",
      target: "vscode",
      targetVersion: "1.95.0"
    };

    expect(
      evaluateCompatibility(vscodePlugin, vscodeEnvironment).checks
    ).toContainEqual({
      constraint: "VS Code version satisfies ^1.90.0",
      passed: true,
      evidence: "environment VS Code version is 1.95.0"
    });
    expect(
      evaluateCompatibility(vscodePlugin, {
        ...vscodeEnvironment,
        targetVersion: "not-a-version"
      }).status
    ).toBe("invalid");

    const webhookPlugin: PluginDefinition = {
      ...base,
      target: {
        type: "webhook",
        openapiVersion: "3.1.0",
        host: "127.0.0.1",
        authentication: "none"
      },
      compatibility: {
        ...base.compatibility,
        targetVersions: ["3.1.0"]
      }
    };
    const webhookCell = evaluateCompatibility(webhookPlugin, {
      ...chromeEnvironment,
      id: "openapi-3.0-linux",
      target: "webhook",
      targetVersion: "3.0.0"
    });

    expect(webhookCell.status).toBe("incompatible");
    expect(webhookCell.checks).toContainEqual({
      constraint: "OpenAPI version is 3.1.0",
      passed: false,
      evidence: "environment OpenAPI version is 3.0.0"
    });
  });
});

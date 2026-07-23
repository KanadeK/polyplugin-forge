import { coerce, gte, satisfies, valid, validRange } from "semver";

import type {
  CompatibilityCell,
  CompatibilityEnvironment,
  PermissionKind,
  PluginDefinition,
  PluginTarget
} from "./model.js";

type CompatibilityCheck = CompatibilityCell["checks"][number];
type PermissionEnforcement =
  CompatibilityCell["permissionEnforcement"][number]["enforcement"];

export type EvidenceState = "passed" | "failed" | "not-run";

export interface CompatibilityEvidence {
  readonly environmentId: string;
  readonly build: EvidenceState;
  readonly test: EvidenceState;
  readonly probe: EvidenceState;
  readonly permissionEnforcement?: Readonly<
    Partial<Record<PermissionKind, PermissionEnforcement>>
  >;
}

const DEFAULT_PERMISSION_ENFORCEMENT: Readonly<
  Record<PluginTarget, Readonly<Record<PermissionKind, PermissionEnforcement>>>
> = {
  mcp: {
    "network.connect": "runtime",
    "network.listen": "runtime",
    "filesystem.read": "runtime",
    "filesystem.write": "runtime",
    "process.spawn": "runtime",
    "storage.local": "runtime",
    "secrets.env": "runtime",
    "browser.activeTab": "documented",
    "browser.tabs": "documented",
    "browser.notifications": "documented"
  },
  vscode: {
    "network.connect": "runtime",
    "network.listen": "runtime",
    "filesystem.read": "runtime",
    "filesystem.write": "runtime",
    "process.spawn": "runtime",
    "storage.local": "native",
    "secrets.env": "runtime",
    "browser.activeTab": "documented",
    "browser.tabs": "documented",
    "browser.notifications": "documented"
  },
  chrome: {
    "network.connect": "native",
    "network.listen": "documented",
    "filesystem.read": "documented",
    "filesystem.write": "documented",
    "process.spawn": "documented",
    "storage.local": "native",
    "secrets.env": "documented",
    "browser.activeTab": "native",
    "browser.tabs": "native",
    "browser.notifications": "native"
  },
  webhook: {
    "network.connect": "runtime",
    "network.listen": "runtime",
    "filesystem.read": "runtime",
    "filesystem.write": "runtime",
    "process.spawn": "runtime",
    "storage.local": "runtime",
    "secrets.env": "runtime",
    "browser.activeTab": "documented",
    "browser.tabs": "documented",
    "browser.notifications": "documented"
  }
};

const SEMVERISH =
  /^\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const EXACT_TARGET_VERSION = /^[0-9A-Za-z][0-9A-Za-z._-]*$/u;

interface TargetConstraintResult {
  readonly valid: boolean;
  readonly matched: boolean;
  readonly evidence: string;
}

function normalizeSemver(value: string): string | null {
  const exact = valid(value);
  if (exact !== null) {
    return exact;
  }

  if (!SEMVERISH.test(value)) {
    return null;
  }

  return coerce(value)?.version ?? null;
}

function evaluateTargetConstraint(
  constraint: string,
  targetVersion: string
): TargetConstraintResult {
  const trimmed = constraint.trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      matched: false,
      evidence: "the target-version constraint is empty"
    };
  }

  if (trimmed === "*") {
    return {
      valid: targetVersion.trim().length > 0,
      matched: targetVersion.trim().length > 0,
      evidence: `target version ${targetVersion || "<empty>"} is accepted by *`
    };
  }

  const range = validRange(trimmed);
  const normalizedTarget = normalizeSemver(targetVersion);
  if (range !== null && normalizedTarget !== null) {
    const matched = satisfies(normalizedTarget, range);
    return {
      valid: true,
      matched,
      evidence: `target version ${targetVersion} ${
        matched ? "satisfies" : "does not satisfy"
      } ${trimmed}`
    };
  }

  if (EXACT_TARGET_VERSION.test(trimmed)) {
    const matched = targetVersion === trimmed;
    return {
      valid: targetVersion.trim().length > 0,
      matched,
      evidence: `target version ${targetVersion || "<empty>"} ${
        matched ? "equals" : "does not equal"
      } ${trimmed}`
    };
  }

  return {
    valid: false,
    matched: false,
    evidence: `target-version constraint ${trimmed} is not a valid range or exact identifier`
  };
}

function enforcementDescription(
  target: PluginTarget,
  enforcement: PermissionEnforcement
): string {
  switch (enforcement) {
    case "native":
      return `${target} provides a native permission boundary`;
    case "runtime":
      return `the generated ${target} runtime enforces the permission`;
    case "documented":
      return `${target} cannot enforce this permission directly; the boundary is documented`;
  }
}

export function evaluateCompatibility(
  plugin: PluginDefinition,
  environment: CompatibilityEnvironment,
  evidence?: CompatibilityEvidence
): CompatibilityCell {
  const checks: CompatibilityCheck[] = [];
  const invalidConstraints: string[] = [];
  const incompatibleConstraints: string[] = [];

  const addConstraint = (
    constraint: string,
    passed: boolean,
    evidenceText: string
  ): void => {
    checks.push({ constraint, passed, evidence: evidenceText });
    if (!passed) {
      incompatibleConstraints.push(constraint);
    }
  };

  const addInvalid = (constraint: string, evidenceText: string): void => {
    checks.push({ constraint, passed: false, evidence: evidenceText });
    invalidConstraints.push(constraint);
  };

  if (plugin.metadata.id.trim().length === 0) {
    addInvalid("plugin id is non-empty", "plugin metadata.id is empty");
  }
  if (environment.id.trim().length === 0) {
    addInvalid("environment id is non-empty", "environment id is empty");
  }

  addConstraint(
    "plugin target matches environment target",
    plugin.target.type === environment.target,
    `plugin declares ${plugin.target.type}; environment provides ${environment.target}`
  );

  if (plugin.compatibility.os.length === 0) {
    addInvalid(
      "at least one supported operating system is declared",
      "compatibility.os is empty"
    );
  } else {
    addConstraint(
      `operating system is one of ${plugin.compatibility.os.join(", ")}`,
      plugin.compatibility.os.includes(environment.os),
      `environment operating system is ${environment.os}`
    );
  }

  if (plugin.compatibility.arch.length === 0) {
    addInvalid(
      "at least one supported architecture is declared",
      "compatibility.arch is empty"
    );
  } else {
    addConstraint(
      `architecture is one of ${plugin.compatibility.arch.join(", ")}`,
      plugin.compatibility.arch.includes(environment.arch),
      `environment architecture is ${environment.arch}`
    );
  }

  const nodeRangeText = plugin.runtime.node.trim();
  const nodeRange =
    nodeRangeText.length === 0 ? null : validRange(nodeRangeText);
  const environmentNode = normalizeSemver(environment.node);
  if (nodeRange === null) {
    addInvalid(
      "runtime.node is a valid semantic-version range",
      `declared Node constraint ${nodeRangeText || "<empty>"} is invalid`
    );
  }
  if (environmentNode === null) {
    addInvalid(
      "environment Node version is valid",
      `environment Node version ${environment.node || "<empty>"} is invalid`
    );
  }
  if (nodeRange !== null && environmentNode !== null) {
    addConstraint(
      `Node version satisfies ${nodeRangeText}`,
      satisfies(environmentNode, nodeRange),
      `environment Node version is ${environment.node}`
    );
  }

  if (plugin.compatibility.targetVersions.length === 0) {
    addInvalid(
      "at least one target-version constraint is declared",
      "compatibility.targetVersions is empty"
    );
  } else {
    const targetResults = plugin.compatibility.targetVersions.map(
      (constraint) => ({
        constraint,
        result: evaluateTargetConstraint(constraint, environment.targetVersion)
      })
    );

    for (const { constraint, result } of targetResults) {
      if (!result.valid) {
        addInvalid(
          `target-version constraint ${constraint || "<empty>"} is valid`,
          result.evidence
        );
      }
    }

    const validResults = targetResults.filter(({ result }) => result.valid);
    if (validResults.length > 0) {
      const matched = validResults.find(({ result }) => result.matched);
      addConstraint(
        `target version matches one of ${plugin.compatibility.targetVersions.join(
          ", "
        )}`,
        matched !== undefined,
        matched?.result.evidence ??
          `target version ${environment.targetVersion} matched no declared constraint`
      );
    }
  }

  const requiredFeatures = new Set(plugin.compatibility.features);
  for (const feature of [...requiredFeatures].sort((left, right) =>
    left.localeCompare(right)
  )) {
    if (feature.trim().length === 0) {
      addInvalid(
        "compatibility feature names are non-empty",
        "compatibility.features contains an empty value"
      );
      continue;
    }
    addConstraint(
      `feature ${feature} is available`,
      environment.features.includes(feature),
      `environment features: ${
        environment.features.length === 0
          ? "<none>"
          : environment.features.join(", ")
      }`
    );
  }

  if (plugin.target.type === environment.target) {
    switch (plugin.target.type) {
      case "mcp":
        addConstraint(
          `MCP protocol version is ${plugin.target.protocolVersion}`,
          environment.targetVersion === plugin.target.protocolVersion,
          `environment MCP protocol version is ${environment.targetVersion}`
        );
        addConstraint(
          `MCP transport is ${plugin.target.transport}`,
          environment.transport === plugin.target.transport,
          `environment transport is ${environment.transport ?? "<missing>"}`
        );
        break;
      case "vscode": {
        const engineRange = validRange(plugin.target.engine);
        const targetVersion = normalizeSemver(environment.targetVersion);
        if (engineRange === null) {
          addInvalid(
            "VS Code engine is a valid semantic-version range",
            `declared VS Code engine ${plugin.target.engine} is invalid`
          );
        } else if (targetVersion === null) {
          addInvalid(
            "VS Code environment version is valid",
            `environment VS Code version ${environment.targetVersion} is invalid`
          );
        } else {
          addConstraint(
            `VS Code version satisfies ${plugin.target.engine}`,
            satisfies(targetVersion, engineRange),
            `environment VS Code version is ${environment.targetVersion}`
          );
        }
        break;
      }
      case "chrome": {
        const minimum = normalizeSemver(plugin.target.minimumChromeVersion);
        const targetVersion = normalizeSemver(environment.targetVersion);
        if (minimum === null) {
          addInvalid(
            "minimum Chrome version is valid",
            `declared minimum Chrome version ${plugin.target.minimumChromeVersion} is invalid`
          );
        } else if (targetVersion === null) {
          addInvalid(
            "Chrome environment version is valid",
            `environment Chrome version ${environment.targetVersion} is invalid`
          );
        } else {
          addConstraint(
            `Chrome version is at least ${plugin.target.minimumChromeVersion}`,
            gte(targetVersion, minimum),
            `environment Chrome version is ${environment.targetVersion}`
          );
        }
        break;
      }
      case "webhook":
        addConstraint(
          `OpenAPI version is ${plugin.target.openapiVersion}`,
          environment.targetVersion === plugin.target.openapiVersion,
          `environment OpenAPI version is ${environment.targetVersion}`
        );
        break;
    }
  }

  const permissionIds = new Set<string>();
  for (const permission of plugin.permissions) {
    if (permissionIds.has(permission.id)) {
      addInvalid(
        `permission id ${permission.id} is unique`,
        `permission id ${permission.id} is declared more than once`
      );
    }
    permissionIds.add(permission.id);
  }

  for (const capability of plugin.capabilities) {
    for (const permissionId of capability.permissions) {
      if (!permissionIds.has(permissionId)) {
        addInvalid(
          `capability ${capability.id} references a declared permission`,
          `permission id ${permissionId} is not declared`
        );
      }
    }
  }

  const evidenceMatches = evidence?.environmentId === environment.id;
  const enforcementOverrides = evidenceMatches
    ? evidence.permissionEnforcement
    : undefined;
  const permissionEnforcement = plugin.permissions.map((permission) => {
    const enforcement =
      enforcementOverrides?.[permission.kind] ??
      DEFAULT_PERMISSION_ENFORCEMENT[environment.target][permission.kind];
    checks.push({
      constraint: `permission ${permission.id} (${permission.kind}) has an enforcement path`,
      passed: true,
      evidence: enforcementDescription(environment.target, enforcement)
    });
    return {
      permissionId: permission.id,
      enforcement
    };
  });

  let completePassingEvidence = false;
  if (evidence !== undefined) {
    if (!evidenceMatches) {
      checks.push({
        constraint: "test evidence belongs to this environment",
        passed: false,
        evidence: `evidence is for ${evidence.environmentId}; environment is ${environment.id}`
      });
    } else {
      const phases = [
        ["build", evidence.build],
        ["test", evidence.test],
        ["probe", evidence.probe]
      ] as const;
      for (const [phase, state] of phases) {
        checks.push({
          constraint: `${phase} evidence passed`,
          passed: state === "passed",
          evidence: `${phase} evidence state is ${state}`
        });
        if (state === "failed") {
          incompatibleConstraints.push(`${phase} evidence passed`);
        }
      }
      completePassingEvidence = phases.every(([, state]) => state === "passed");
    }
  }

  const status: CompatibilityCell["status"] =
    invalidConstraints.length > 0
      ? "invalid"
      : incompatibleConstraints.length > 0
        ? "incompatible"
        : completePassingEvidence
          ? "compatible-tested"
          : "compatible-unverified";

  return {
    pluginId: plugin.metadata.id,
    environmentId: environment.id,
    status,
    checks,
    permissionEnforcement
  };
}

export function evaluateCompatibilityMatrix(
  plugin: PluginDefinition,
  environments: readonly CompatibilityEnvironment[],
  evidence: readonly CompatibilityEvidence[] = []
): readonly CompatibilityCell[] {
  const evidenceByEnvironment = new Map(
    evidence.map((entry) => [entry.environmentId, entry] as const)
  );

  return environments.map((environment) =>
    evaluateCompatibility(
      plugin,
      environment,
      evidenceByEnvironment.get(environment.id)
    )
  );
}

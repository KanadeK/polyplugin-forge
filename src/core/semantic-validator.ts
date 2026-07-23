import { diagnostic, hasErrors, sortDiagnostics } from "./diagnostics.js";
import type {
  Diagnostic,
  PermissionDefinition,
  PluginDefinition,
  PluginTarget,
  ValidationResult
} from "./model.js";

const CAPABILITY_TYPES: Readonly<Record<PluginTarget, ReadonlySet<string>>> = {
  mcp: new Set(["mcp.tool", "mcp.resource", "mcp.prompt"]),
  vscode: new Set(["vscode.command"]),
  chrome: new Set(["chrome.popup", "chrome.action", "chrome.background"]),
  webhook: new Set(["webhook.route"])
};

function duplicateIdDiagnostics(
  values: readonly { readonly id: string }[],
  collection: "capabilities" | "permissions" | "dataFlows",
  code: string,
  label: string
): Diagnostic[] {
  const firstIndexes = new Map<string, number>();
  const diagnostics: Diagnostic[] = [];

  values.forEach(({ id }, index) => {
    if (firstIndexes.has(id)) {
      diagnostics.push(
        diagnostic(
          code,
          `${label} IDs must be unique.`,
          "error",
          `$.${collection}[${String(index)}].id`
        )
      );
      return;
    }

    firstIndexes.set(id, index);
  });

  return diagnostics;
}

function validateRuntimePath(
  value: string,
  field: "source" | "entry"
): Diagnostic | undefined {
  const path = `$.runtime.${field}`;
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return diagnostic(
      "RUNTIME_PATH_EMPTY",
      "Runtime paths must not be empty.",
      "error",
      path
    );
  }

  if (
    /^(?:[a-z]:[\\/]|[\\/]{1,2}|file:)/iu.test(trimmed) ||
    trimmed.startsWith("~")
  ) {
    return diagnostic(
      "RUNTIME_PATH_ABSOLUTE",
      "Runtime paths must be relative to the plugin root.",
      "error",
      path
    );
  }

  const segments = trimmed.replaceAll("\\", "/").split("/");
  if (segments.includes("..")) {
    return diagnostic(
      "RUNTIME_PATH_TRAVERSAL",
      "Runtime paths must stay inside the plugin root.",
      "error",
      path
    );
  }

  return undefined;
}

function isBroadResource(resource: string): boolean {
  const normalized = resource.trim().toLowerCase().replaceAll("\\", "/");

  return (
    normalized === "*" ||
    normalized === "**" ||
    normalized === "**/*" ||
    normalized === "/*" ||
    normalized === "/" ||
    normalized === "<all_urls>" ||
    normalized === "0.0.0.0" ||
    normalized === "0.0.0.0/0" ||
    normalized === "::/0" ||
    /^[a-z]:\/?(?:\*{1,2}(?:\/\*)?)?$/u.test(normalized) ||
    /^(?:https?|wss?):\/\/\*(?::\*)?(?:\/.*)?$/u.test(normalized)
  );
}

function isBroadPermission(permission: PermissionDefinition): boolean {
  return permission.resources.some(isBroadResource);
}

function needsPrivacyNotice(plugin: PluginDefinition): boolean {
  return (
    plugin.privacy.collectsPersonalData ||
    plugin.privacy.telemetry ||
    plugin.dataFlows.some(
      ({ data, retention }) =>
        retention === "persistent" ||
        data.some(({ classification }) => classification !== "public")
    )
  );
}

export function validatePluginDefinition(
  plugin: PluginDefinition
): ValidationResult<PluginDefinition> {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(
    ...duplicateIdDiagnostics(
      plugin.capabilities,
      "capabilities",
      "DUPLICATE_CAPABILITY_ID",
      "Capability"
    ),
    ...duplicateIdDiagnostics(
      plugin.permissions,
      "permissions",
      "DUPLICATE_PERMISSION_ID",
      "Permission"
    ),
    ...duplicateIdDiagnostics(
      plugin.dataFlows,
      "dataFlows",
      "DUPLICATE_DATA_FLOW_ID",
      "Data flow"
    )
  );

  const sourceDiagnostic = validateRuntimePath(plugin.runtime.source, "source");
  if (sourceDiagnostic !== undefined) {
    diagnostics.push(sourceDiagnostic);
  }

  const entryDiagnostic = validateRuntimePath(plugin.runtime.entry, "entry");
  if (entryDiagnostic !== undefined) {
    diagnostics.push(entryDiagnostic);
  }

  const permissionIds = new Set(
    plugin.permissions.map((permission) => permission.id)
  );
  const capabilityIds = new Set(
    plugin.capabilities.map((capability) => capability.id)
  );
  const referencedPermissionIds = new Set<string>();
  const allowedCapabilityTypes = CAPABILITY_TYPES[plugin.target.type];

  plugin.capabilities.forEach((capability, capabilityIndex) => {
    if (!allowedCapabilityTypes.has(capability.type)) {
      diagnostics.push(
        diagnostic(
          "CAPABILITY_TARGET_MISMATCH",
          "Capability type is not supported by the selected target.",
          "error",
          `$.capabilities[${String(capabilityIndex)}].type`
        )
      );
    }

    if (capability.tests.length === 0) {
      diagnostics.push(
        diagnostic(
          "CAPABILITY_TESTS_REQUIRED",
          "Every capability must declare at least one test.",
          "error",
          `$.capabilities[${String(capabilityIndex)}].tests`
        )
      );
    }

    capability.permissions.forEach((permissionId, permissionIndex) => {
      referencedPermissionIds.add(permissionId);
      if (!permissionIds.has(permissionId)) {
        diagnostics.push(
          diagnostic(
            "UNKNOWN_PERMISSION_REFERENCE",
            "Capability references an undeclared permission.",
            "error",
            `$.capabilities[${String(capabilityIndex)}].permissions[${String(permissionIndex)}]`
          )
        );
      }
    });
  });

  plugin.permissions.forEach((permission, permissionIndex) => {
    if (!referencedPermissionIds.has(permission.id)) {
      diagnostics.push(
        diagnostic(
          "UNUSED_PERMISSION",
          "Declared permissions must be used by a capability.",
          "error",
          `$.permissions[${String(permissionIndex)}]`
        )
      );
    }

    if (plugin.riskAcceptance === undefined && isBroadPermission(permission)) {
      diagnostics.push(
        diagnostic(
          "BROAD_PERMISSION_REQUIRES_RISK_ACCEPTANCE",
          "Broad permission scopes require an explicit risk acceptance.",
          "error",
          `$.permissions[${String(permissionIndex)}].resources`
        )
      );
    }
  });

  plugin.dataFlows.forEach((dataFlow, dataFlowIndex) => {
    if (!capabilityIds.has(dataFlow.capability)) {
      diagnostics.push(
        diagnostic(
          "UNKNOWN_DATA_FLOW_CAPABILITY",
          "Data flow references an undeclared capability.",
          "error",
          `$.dataFlows[${String(dataFlowIndex)}].capability`
        )
      );
    }
  });

  const declaresPersonalData = plugin.dataFlows.some(({ data }) =>
    data.some(
      ({ classification }) =>
        classification === "personal" || classification === "credential"
    )
  );

  if (declaresPersonalData && !plugin.privacy.collectsPersonalData) {
    diagnostics.push(
      diagnostic(
        "PERSONAL_DATA_FLAG_REQUIRED",
        "Personal or credential data flows must be disclosed.",
        "error",
        "$.privacy.collectsPersonalData"
      )
    );
  }

  if (needsPrivacyNotice(plugin) && plugin.privacy.notice.trim().length === 0) {
    diagnostics.push(
      diagnostic(
        "PRIVACY_NOTICE_REQUIRED",
        "A privacy notice is required for non-public data, telemetry, or persistent retention.",
        "error",
        "$.privacy.notice"
      )
    );
  }

  const sortedDiagnostics = sortDiagnostics(diagnostics);
  if (hasErrors(sortedDiagnostics)) {
    return { ok: false, diagnostics: sortedDiagnostics };
  }

  return {
    ok: true,
    value: plugin,
    diagnostics: sortedDiagnostics
  };
}

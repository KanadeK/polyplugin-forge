import { diagnostic } from "../../core/diagnostics.js";
import type {
  Diagnostic,
  ManifestOutput,
  PermissionKind,
  PluginDefinition
} from "../../core/model.js";

const CHROME_VERSION_PATTERN = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/;

const CHROME_PERMISSION_MAP: Partial<Record<PermissionKind, string>> = {
  "storage.local": "storage",
  "browser.activeTab": "activeTab",
  "browser.tabs": "tabs",
  "browser.notifications": "notifications"
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function extensionPath(path: string): string {
  return path.startsWith("./") ? path.slice(2) : path;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function generateChromeManifest(
  plugin: PluginDefinition
): ManifestOutput {
  if (plugin.target.type !== "chrome") {
    throw new TypeError(
      "The Chrome manifest adapter requires a Chrome plugin."
    );
  }

  const chromeCapabilities = plugin.capabilities.filter(({ type }) =>
    type.startsWith("chrome.")
  );
  const popup = chromeCapabilities.find(
    ({ path, type }) => type === "chrome.popup" && path !== undefined
  );
  const permissions = uniqueSorted(
    plugin.permissions.flatMap(({ kind }) => {
      const nativePermission = CHROME_PERMISSION_MAP[kind];
      return nativePermission === undefined ? [] : [nativePermission];
    })
  );
  const hostPermissions = uniqueSorted(
    plugin.permissions
      .filter(({ kind }) => kind === "network.connect")
      .flatMap(({ resources }) => resources)
  );

  const action: Record<string, unknown> = {
    default_title: chromeCapabilities[0]?.title ?? plugin.metadata.name
  };
  if (popup?.path !== undefined) {
    action["default_popup"] = extensionPath(popup.path);
  }

  return {
    target: "chrome",
    fileName: "manifest.json",
    value: {
      manifest_version: 3,
      name: plugin.metadata.name,
      version: plugin.metadata.version,
      description: plugin.metadata.description,
      minimum_chrome_version: plugin.target.minimumChromeVersion,
      background: {
        service_worker: extensionPath(plugin.runtime.entry),
        type: "module"
      },
      action,
      ...(permissions.length === 0 ? {} : { permissions }),
      ...(hostPermissions.length === 0
        ? {}
        : { host_permissions: hostPermissions })
    }
  };
}

function validateStringArray(
  value: unknown,
  path: string,
  code: string
): readonly Diagnostic[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => !nonEmptyString(item)) ||
    new Set(value).size !== value.length
  ) {
    return [
      diagnostic(
        code,
        `${path} must be an array of unique, non-empty strings.`,
        "error",
        path
      )
    ];
  }
  return [];
}

export function validateChromeManifest(value: unknown): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(value)) {
    return [
      diagnostic(
        "PPF_NATIVE_CHROME_OBJECT",
        "Chrome manifest.json must contain a JSON object.",
        "error",
        "manifest.json"
      )
    ];
  }

  if (value["manifest_version"] !== 3) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_CHROME_VERSION",
        "Chrome extensions must use Manifest V3.",
        "error",
        "manifest.json.manifest_version"
      )
    );
  }
  for (const field of [
    "name",
    "description",
    "minimum_chrome_version"
  ] as const) {
    if (!nonEmptyString(value[field])) {
      diagnostics.push(
        diagnostic(
          "PPF_NATIVE_CHROME_REQUIRED",
          `Chrome manifest field "${field}" must be a non-empty string.`,
          "error",
          `manifest.json.${field}`
        )
      );
    }
  }
  if (
    !nonEmptyString(value["version"]) ||
    !CHROME_VERSION_PATTERN.test(value["version"])
  ) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_CHROME_EXTENSION_VERSION",
        "Chrome extension version must contain one to four numeric components.",
        "error",
        "manifest.json.version"
      )
    );
  }

  const background = isRecord(value["background"])
    ? value["background"]
    : undefined;
  if (
    background === undefined ||
    !nonEmptyString(background["service_worker"])
  ) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_CHROME_BACKGROUND",
        "Chrome manifest must declare a non-empty background service worker.",
        "error",
        "manifest.json.background.service_worker"
      )
    );
  }
  if (background !== undefined && background["type"] !== "module") {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_CHROME_BACKGROUND_TYPE",
        'Chrome background worker type must be "module".',
        "error",
        "manifest.json.background.type"
      )
    );
  }

  const action = isRecord(value["action"]) ? value["action"] : undefined;
  if (action === undefined || !nonEmptyString(action["default_title"])) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_CHROME_ACTION",
        "Chrome manifest action must have a non-empty default title.",
        "error",
        "manifest.json.action.default_title"
      )
    );
  }
  if (
    action?.["default_popup"] !== undefined &&
    !nonEmptyString(action["default_popup"])
  ) {
    diagnostics.push(
      diagnostic(
        "PPF_NATIVE_CHROME_POPUP",
        "Chrome action default_popup must be a non-empty path.",
        "error",
        "manifest.json.action.default_popup"
      )
    );
  }

  if (value["permissions"] !== undefined) {
    diagnostics.push(
      ...validateStringArray(
        value["permissions"],
        "manifest.json.permissions",
        "PPF_NATIVE_CHROME_PERMISSIONS"
      )
    );
  }
  if (value["host_permissions"] !== undefined) {
    diagnostics.push(
      ...validateStringArray(
        value["host_permissions"],
        "manifest.json.host_permissions",
        "PPF_NATIVE_CHROME_HOST_PERMISSIONS"
      )
    );
  }

  return diagnostics;
}

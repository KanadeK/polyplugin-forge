export const PLUGIN_TARGETS = ["mcp", "vscode", "chrome", "webhook"] as const;

export type PluginTarget = (typeof PLUGIN_TARGETS)[number];

export const PERMISSION_KINDS = [
  "network.connect",
  "network.listen",
  "filesystem.read",
  "filesystem.write",
  "process.spawn",
  "storage.local",
  "secrets.env",
  "browser.activeTab",
  "browser.tabs",
  "browser.notifications"
] as const;

export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly path?: string;
  readonly hint?: string;
}

export interface PluginMetadata {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly license: string;
  readonly package: string;
}

export interface RuntimeDefinition {
  readonly language: "node";
  readonly node: string;
  readonly source: string;
  readonly entry: string;
}

export interface PermissionDefinition {
  readonly id: string;
  readonly kind: PermissionKind;
  readonly resources: readonly string[];
  readonly reason: string;
}

export interface CapabilityDefinition {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly handler: string;
  readonly permissions: readonly string[];
  readonly tests: readonly string[];
  readonly inputSchema?: string;
  readonly command?: string;
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path?: string;
}

export interface DataFlowDefinition {
  readonly id: string;
  readonly capability: string;
  readonly direction: "inbound" | "outbound";
  readonly source: string;
  readonly destination: string;
  readonly data: readonly {
    readonly name: string;
    readonly classification:
      "public" | "user-content" | "personal" | "credential";
  }[];
  readonly purpose: string;
  readonly retention: "none" | "memory" | "session" | "persistent";
}

export interface PrivacyDefinition {
  readonly notice: string;
  readonly collectsPersonalData: boolean;
  readonly telemetry: boolean;
}

export interface CompatibilityDefinition {
  readonly os: readonly ("linux" | "darwin" | "win32")[];
  readonly arch: readonly ("x64" | "arm64")[];
  readonly targetVersions: readonly string[];
  readonly features: readonly string[];
}

export interface McpTarget {
  readonly type: "mcp";
  readonly protocolVersion: string;
  readonly transport: "stdio" | "streamable-http";
  readonly registry: {
    readonly type: "npm";
    readonly package: string;
  };
}

export interface VscodeTarget {
  readonly type: "vscode";
  readonly publisher: string;
  readonly engine: string;
}

export interface ChromeTarget {
  readonly type: "chrome";
  readonly manifestVersion: 3;
  readonly minimumChromeVersion: string;
}

export interface WebhookTarget {
  readonly type: "webhook";
  readonly openapiVersion: "3.1.0";
  readonly host: "127.0.0.1" | "localhost";
  readonly authentication: "none" | "bearer";
}

export type TargetDefinition =
  McpTarget | VscodeTarget | ChromeTarget | WebhookTarget;

export interface TestDefinition {
  readonly command: readonly [string, ...string[]];
}

export interface RiskAcceptance {
  readonly reason: string;
  readonly trackingUrl: string;
}

export interface PluginDefinition {
  readonly apiVersion: "polyplugin.dev/v1alpha1";
  readonly kind: "Plugin";
  readonly metadata: PluginMetadata;
  readonly runtime: RuntimeDefinition;
  readonly target: TargetDefinition;
  readonly capabilities: readonly CapabilityDefinition[];
  readonly permissions: readonly PermissionDefinition[];
  readonly dataFlows: readonly DataFlowDefinition[];
  readonly privacy: PrivacyDefinition;
  readonly compatibility: CompatibilityDefinition;
  readonly tests: TestDefinition;
  readonly riskAcceptance?: RiskAcceptance;
}

export interface ValidationResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CompatibilityEnvironment {
  readonly id: string;
  readonly target: PluginTarget;
  readonly targetVersion: string;
  readonly node: string;
  readonly os: "linux" | "darwin" | "win32";
  readonly arch: "x64" | "arm64";
  readonly features: readonly string[];
  readonly transport?: string;
}

export type CompatibilityStatus =
  "compatible-tested" | "compatible-unverified" | "incompatible" | "invalid";

export interface CompatibilityCell {
  readonly pluginId: string;
  readonly environmentId: string;
  readonly status: CompatibilityStatus;
  readonly checks: readonly {
    readonly constraint: string;
    readonly passed: boolean;
    readonly evidence: string;
  }[];
  readonly permissionEnforcement: readonly {
    readonly permissionId: string;
    readonly enforcement: "native" | "runtime" | "documented";
  }[];
}

export interface ManifestOutput {
  readonly target: PluginTarget;
  readonly fileName: string;
  readonly value: Readonly<Record<string, unknown>>;
}

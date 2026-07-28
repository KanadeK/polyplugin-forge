export { VERSION } from "./version.js";
export { diagnostic, hasErrors, sortDiagnostics } from "./core/diagnostics.js";
export {
  generateAndValidateManifest,
  generateManifest,
  stringifyManifest,
  validateNativeManifest
} from "./core/manifest-generator.js";
export {
  parsePluginManifest,
  pluginDefinitionSchema,
  targetDefinitionSchema
} from "./core/plugin-schema.js";
export { validatePluginDefinition } from "./core/semantic-validator.js";
export { stableJson } from "./core/stable-json.js";
export {
  evaluateCompatibility,
  evaluateCompatibilityMatrix
} from "./core/compatibility.js";
export {
  scanFilesForSecrets,
  scanTextForSecrets
} from "./core/secret-scanner.js";
export {
  INITIAL_TEMPLATE_VERSION,
  LATEST_TEMPLATE_VERSION,
  renderTemplate,
  SUPPORTED_TEMPLATE_VERSIONS,
  validateTemplateAnswers,
  validateTemplatePath
} from "./core/template-renderer.js";
export { planUpgrade } from "./core/upgrade-planner.js";
export { PERMISSION_KINDS, PLUGIN_TARGETS } from "./core/model.js";
export {
  escapeHtml,
  renderCompatibilityHtml
} from "./reporters/matrix-html.js";
export type {
  CapabilityDefinition,
  CompatibilityCell,
  CompatibilityEnvironment,
  Diagnostic,
  ManifestOutput,
  PermissionDefinition,
  PluginDefinition,
  PluginTarget,
  ValidationResult
} from "./core/model.js";
export type {
  CompatibilityEvidence,
  EvidenceState
} from "./core/compatibility.js";
export type { SecretScanSource } from "./core/secret-scanner.js";
export type {
  RenderedTemplate,
  RenderedTemplateFile,
  TemplateAnswers,
  TemplateSourceFile
} from "./core/template-renderer.js";
export type {
  ConflictMaterialPlan,
  FileMaterial,
  FileSnapshot,
  PreservedPath,
  PreserveReason,
  UpgradeConflict,
  UpgradeConflictReason,
  UpgradeOperation,
  UpgradePlan
} from "./core/upgrade-planner.js";
export type { MatrixHtmlInput } from "./reporters/matrix-html.js";

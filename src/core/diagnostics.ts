import type { Diagnostic, DiagnosticSeverity } from "./model.js";

export function diagnostic(
  code: string,
  message: string,
  severity: DiagnosticSeverity = "error",
  path?: string,
  hint?: string
): Diagnostic {
  return {
    code,
    message,
    severity,
    ...(path === undefined ? {} : { path }),
    ...(hint === undefined ? {} : { hint })
  };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some(({ severity }) => severity === "error");
}

export function sortDiagnostics(
  diagnostics: readonly Diagnostic[]
): readonly Diagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      (left.path ?? "").localeCompare(right.path ?? "") ||
      left.code.localeCompare(right.code)
  );
}

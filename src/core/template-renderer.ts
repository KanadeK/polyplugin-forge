import Handlebars from "handlebars";

import type { PluginTarget } from "./model.js";

export const INITIAL_TEMPLATE_VERSION = "1.0.0";

export interface TemplateAnswers {
  readonly pluginId: string;
  readonly displayName: string;
  readonly description: string;
  readonly packageName: string;
}

export interface TemplateSourceFile {
  readonly path: string;
  readonly template: string;
}

export interface RenderedTemplateFile {
  readonly path: string;
  readonly content: string;
}

export interface RenderedTemplate {
  readonly kind: PluginTarget;
  readonly version: string;
  readonly answers: TemplateAnswers;
  readonly files: readonly RenderedTemplateFile[];
}

const PLUGIN_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const SAFE_TEMPLATE_SEGMENT = /^[^./\\][^/\\]*$|^\.[^./\\][^/\\]*$/u;

function assertPlainText(label: string, value: string, maximum: number): void {
  let hasControlCharacter = false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      (codeUnit >= 0 && codeUnit <= 8) ||
      codeUnit === 11 ||
      codeUnit === 12 ||
      (codeUnit >= 14 && codeUnit <= 31) ||
      codeUnit === 127
    ) {
      hasControlCharacter = true;
      break;
    }
  }
  if (
    value.trim().length === 0 ||
    value.length > maximum ||
    hasControlCharacter
  ) {
    throw new TypeError(`${label} must be non-blank plain text`);
  }
}

export function validateTemplateAnswers(answers: TemplateAnswers): void {
  if (!PLUGIN_ID.test(answers.pluginId)) {
    throw new TypeError(
      "pluginId must be a lowercase dot, dash, or underscore identifier"
    );
  }
  if (!PACKAGE_NAME.test(answers.packageName)) {
    throw new TypeError("packageName must be a safe npm package name");
  }
  assertPlainText("displayName", answers.displayName, 80);
  assertPlainText("description", answers.description, 280);
}

export function validateTemplatePath(path: string): void {
  if (
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path.split("/").some((segment) => !SAFE_TEMPLATE_SEGMENT.test(segment))
  ) {
    throw new TypeError(`Unsafe template path: ${path}`);
  }
  if (!path.endsWith(".hbs")) {
    throw new TypeError(`Template file must use the .hbs suffix: ${path}`);
  }
}

function outputPath(path: string): string {
  return path.slice(0, -".hbs".length);
}

export function renderTemplate(
  kind: PluginTarget,
  sourceFiles: readonly TemplateSourceFile[],
  answers: TemplateAnswers,
  version = INITIAL_TEMPLATE_VERSION
): RenderedTemplate {
  validateTemplateAnswers(answers);
  assertPlainText("template version", version, 32);

  const handlebars = Handlebars.create();
  handlebars.registerHelper("json", (value: unknown) => {
    return new handlebars.SafeString(JSON.stringify(value));
  });

  const paths = new Set<string>();
  const files = [...sourceFiles]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((sourceFile) => {
      validateTemplatePath(sourceFile.path);
      const path = outputPath(sourceFile.path);
      if (paths.has(path)) {
        throw new TypeError(`Duplicate rendered path: ${path}`);
      }
      paths.add(path);
      const compile = handlebars.compile(sourceFile.template, {
        noEscape: true,
        strict: true
      });
      return {
        path,
        content: compile({
          ...answers,
          templateKind: kind,
          templateVersion: version
        })
      };
    });

  return {
    kind,
    version,
    answers,
    files
  };
}

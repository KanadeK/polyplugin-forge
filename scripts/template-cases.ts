import type { PluginTarget } from "../src/core/model.js";
import type { TemplateAnswers } from "../src/core/template-renderer.js";

export interface TemplateCase {
  readonly kind: PluginTarget;
  readonly answers: TemplateAnswers;
}

export const TEMPLATE_CASES: readonly TemplateCase[] = [
  {
    kind: "mcp",
    answers: {
      pluginId: "hello.mcp",
      displayName: "Hello MCP",
      description: "Returns a deterministic greeting over MCP stdio.",
      packageName: "hello-mcp"
    }
  },
  {
    kind: "vscode",
    answers: {
      pluginId: "hello.vscode",
      displayName: "Hello VS Code",
      description: "Registers a real VS Code greeting command.",
      packageName: "hello-vscode"
    }
  },
  {
    kind: "chrome",
    answers: {
      pluginId: "hello.chrome",
      displayName: "Hello Chrome",
      description: "Greets a user from an accessible Manifest V3 popup.",
      packageName: "hello-chrome"
    }
  },
  {
    kind: "webhook",
    answers: {
      pluginId: "hello.webhook",
      displayName: "Hello Webhook",
      description: "Serves a deterministic loopback POST greeting.",
      packageName: "hello-webhook"
    }
  }
];

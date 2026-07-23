#!/usr/bin/env node

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const PROTOCOL_VERSION = "2025-06-18";
const PLUGIN_ID = "hello.mcp";
const DISPLAY_NAME = "Hello MCP";
const VERSION = "0.1.0";

export const helloInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      minLength: 1,
      description: "Name to greet."
    }
  },
  required: ["name"]
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestId(message) {
  return isRecord(message) &&
    (typeof message.id === "string" ||
      typeof message.id === "number" ||
      message.id === null)
    ? message.id
    : null;
}

function success(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function failure(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  };
}

function hello(argumentsValue) {
  if (!isRecord(argumentsValue)) {
    return undefined;
  }

  const name =
    typeof argumentsValue.name === "string"
      ? argumentsValue.name.trim()
      : "";
  return name.length === 0 ? undefined : `Hello, ${name}!`;
}

export function handleJsonRpcMessage(message) {
  if (
    !isRecord(message) ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  ) {
    return failure(requestId(message), -32600, "Invalid Request");
  }

  if (!Object.hasOwn(message, "id")) {
    return undefined;
  }

  const id = requestId(message);
  switch (message.method) {
    case "initialize":
      return success(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: PLUGIN_ID,
          title: DISPLAY_NAME,
          version: VERSION
        }
      });

    case "tools/list":
      return success(id, {
        tools: [
          {
            name: "hello",
            title: "Say hello",
            description: "Return a deterministic greeting for a supplied name.",
            inputSchema: helloInputSchema
          }
        ]
      });

    case "tools/call": {
      if (!isRecord(message.params) || message.params.name !== "hello") {
        return failure(id, -32602, "Unknown tool");
      }

      const greeting = hello(message.params.arguments);
      if (greeting === undefined) {
        return failure(id, -32602, 'Tool "hello" requires a non-empty name.');
      }

      return success(id, {
        content: [
          {
            type: "text",
            text: greeting
          }
        ],
        isError: false
      });
    }

    default:
      return failure(id, -32601, "Method not found");
  }
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export function runStdioServer() {
  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
    terminal: false
  });

  lines.on("line", (line) => {
    if (line.trim().length === 0) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      writeMessage(failure(null, -32700, "Parse error"));
      return;
    }

    const response = handleJsonRpcMessage(message);
    if (response !== undefined) {
      writeMessage(response);
    }
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runStdioServer();
}

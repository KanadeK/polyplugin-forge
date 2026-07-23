import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

const serverPath = fileURLToPath(
  new URL("../src/server.js", import.meta.url)
);

function launchClient() {
  const child = spawn(process.execPath, [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdoutBuffer = "";
  let stderr = "";
  const pending = new Map();

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) {
        break;
      }

      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line.trim().length === 0) {
        continue;
      }

      const response = JSON.parse(line);
      const waiter = pending.get(response.id);
      if (waiter !== undefined) {
        pending.delete(response.id);
        waiter.resolve(response);
      }
    }
  });
  child.on("error", (error) => {
    for (const waiter of pending.values()) {
      waiter.reject(error);
    }
    pending.clear();
  });
  child.on("exit", (code) => {
    if (pending.size === 0) {
      return;
    }

    const error = new Error(
      `MCP server exited with code ${String(code)}. ${stderr}`
    );
    for (const waiter of pending.values()) {
      waiter.reject(error);
    }
    pending.clear();
  });

  function sendLine(line, expectedId) {
    return new Promise((resolve, reject) => {
      pending.set(expectedId, { resolve, reject });
      child.stdin.write(`${line}\n`, (error) => {
        if (error !== null && error !== undefined) {
          pending.delete(expectedId);
          reject(error);
        }
      });
    });
  }

  return {
    request(message) {
      return sendLine(JSON.stringify(message), message.id);
    },
    raw(line, expectedId) {
      return sendLine(line, expectedId);
    },
    async close() {
      child.stdin.end();
      const [code] = await once(child, "exit");
      assert.equal(code, 0, stderr);
    }
  };
}

test(
  "performs initialize, tools/list, and tools/call over stdio",
  { timeout: 5000 },
  async () => {
    const client = launchClient();
    const initialize = await client.request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "template-test", version: "1.0.0" }
      }
    });
    assert.equal(initialize.result.protocolVersion, "2025-06-18");
    assert.equal(initialize.result.serverInfo.name, "hello.mcp");
    assert.deepEqual(initialize.result.capabilities, { tools: {} });

    const listed = await client.request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    assert.equal(listed.result.tools.length, 1);
    assert.equal(listed.result.tools[0].name, "hello");
    assert.deepEqual(listed.result.tools[0].inputSchema.required, ["name"]);

    const called = await client.request({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "hello",
        arguments: { name: "Ada" }
      }
    });
    assert.equal(called.result.isError, false);
    assert.equal(called.result.content[0].text, "Hello, Ada!");
    await client.close();
  }
);

test(
  "returns JSON-RPC errors for parse, method, tool, and input failures",
  { timeout: 5000 },
  async () => {
    const client = launchClient();

    const parseError = await client.raw("{", null);
    assert.equal(parseError.error.code, -32700);

    const methodError = await client.request({
      jsonrpc: "2.0",
      id: 10,
      method: "unknown/method"
    });
    assert.equal(methodError.error.code, -32601);

    const toolError = await client.request({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "missing", arguments: {} }
    });
    assert.equal(toolError.error.code, -32602);

    const inputError = await client.request({
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "hello", arguments: { name: "   " } }
    });
    assert.equal(inputError.error.code, -32602);
    await client.close();
  }
);

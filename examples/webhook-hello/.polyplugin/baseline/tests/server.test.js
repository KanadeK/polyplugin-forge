import assert from "node:assert/strict";
import test from "node:test";

import { createWebhookServer } from "../src/server.js";

async function startServer(t) {
  const server = createWebhookServer();
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      reject(error);
    };

    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  });

  const address = server.address();
  assert.equal(typeof address, "object");
  assert.notEqual(address, null);
  return `http://127.0.0.1:${String(address.port)}`;
}

test(
  "POST /hello returns a real greeting from a port-zero server",
  { timeout: 5000 },
  async (t) => {
    const origin = await startServer(t);
    const response = await fetch(`${origin}/hello`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ name: "Ada" })
    });

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /application\/json/
    );
    assert.deepEqual(await response.json(), {
      message: "Hello, Ada!"
    });
  }
);

test(
  "returns explicit errors for invalid input, method, and path branches",
  { timeout: 5000 },
  async (t) => {
    const origin = await startServer(t);

    const malformed = await fetch(`${origin}/hello`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: "{"
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: "invalid_json"
    });

    const invalidName = await fetch(`${origin}/hello`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ name: "   " })
    });
    assert.equal(invalidName.status, 422);
    assert.deepEqual(await invalidName.json(), {
      error: "name_must_be_non_empty"
    });

    const wrongContentType = await fetch(`${origin}/hello`, {
      method: "POST",
      body: JSON.stringify({ name: "Ada" })
    });
    assert.equal(wrongContentType.status, 415);
    assert.deepEqual(await wrongContentType.json(), {
      error: "json_content_type_required"
    });

    const wrongMethod = await fetch(`${origin}/hello`);
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get("allow"), "POST");
    assert.deepEqual(await wrongMethod.json(), {
      error: "method_not_allowed"
    });

    const missingRoute = await fetch(`${origin}/missing`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ name: "Ada" })
    });
    assert.equal(missingRoute.status, 404);
    assert.deepEqual(await missingRoute.json(), {
      error: "not_found"
    });
  }
);

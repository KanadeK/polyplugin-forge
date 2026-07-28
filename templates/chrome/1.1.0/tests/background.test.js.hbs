import assert from "node:assert/strict";
import test from "node:test";

import { installBackground } from "../src/index.js";

function createChromeFake(initial = {}) {
  const values = { ...initial };
  const listeners = {};

  return {
    values,
    listeners,
    api: {
      runtime: {
        onInstalled: {
          addListener(listener) {
            listeners.installed = listener;
          }
        },
        onMessage: {
          addListener(listener) {
            listeners.message = listener;
          }
        }
      },
      storage: {
        local: {
          async get(key) {
            return key in values ? { [key]: values[key] } : {};
          },
          async set(update) {
            Object.assign(values, update);
          }
        }
      }
    }
  };
}

test("initializes local state without overwriting an existing name", async () => {
  const empty = createChromeFake();
  installBackground(empty.api);
  await empty.listeners.installed();
  assert.equal(empty.values.lastName, "friend");

  const existing = createChromeFake({ lastName: "Ada" });
  installBackground(existing.api);
  await existing.listeners.installed();
  assert.equal(existing.values.lastName, "Ada");
});

test("handles greeting messages and ignores unrelated messages", async () => {
  const fake = createChromeFake();
  installBackground(fake.api);

  let response;
  const keepChannelOpen = fake.listeners.message(
    { type: "greet", name: "  Ada  " },
    {},
    (value) => {
      response = value;
    }
  );
  await Promise.resolve();

  assert.equal(keepChannelOpen, false);
  assert.deepEqual(response, { greeting: "Hello, Ada!" });
  assert.equal(fake.values.lastName, "Ada");
  assert.equal(fake.listeners.message({ type: "other" }, {}, () => {}), false);
});

test("rejects a runtime missing required Chrome APIs", () => {
  assert.throws(
    () => installBackground({ runtime: {} }),
    /Chrome extension runtime/
  );
});

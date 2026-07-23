import assert from "node:assert/strict";
import test from "node:test";

import { bindPopup, requestGreeting } from "../src/popup.js";

class FakeElement {
  constructor(value = "") {
    this.value = value;
    this.textContent = "";
    this.disabled = false;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  dispatch(type, event = {}) {
    const listener = this.listeners.get(type);
    if (listener === undefined) {
      throw new Error(`No ${type} listener`);
    }
    return listener(event);
  }
}

function createPopupFake() {
  const input = new FakeElement("Ada");
  const button = new FakeElement();
  const output = new FakeElement();
  const elements = new Map([
    ["greeting-name", input],
    ["greet-button", button],
    ["greeting-output", output]
  ]);

  return {
    input,
    button,
    output,
    root: {
      getElementById(id) {
        return elements.get(id) ?? null;
      }
    }
  };
}

test("click requests and renders a greeting", async () => {
  const popup = createPopupFake();
  const controller = bindPopup(
    popup.root,
    async (name) => `Hello from click, ${name}!`
  );

  await popup.button.dispatch("click");

  assert.equal(popup.output.textContent, "Hello from click, Ada!");
  assert.equal(popup.button.disabled, false);
  controller.dispose();
  assert.equal(popup.button.listeners.size, 0);
});

test("Enter prevents default and requests a greeting", async () => {
  const popup = createPopupFake();
  popup.input.value = "Grace";
  let prevented = false;
  bindPopup(popup.root, async (name) => `Hello from Enter, ${name}!`);

  await popup.input.dispatch("keydown", {
    key: "Enter",
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.equal(popup.output.textContent, "Hello from Enter, Grace!");
});

test("shows a safe error and validates background responses", async () => {
  const popup = createPopupFake();
  bindPopup(popup.root, async () => {
    throw new Error("private implementation detail");
  });

  await popup.button.dispatch("click");
  assert.equal(
    popup.output.textContent,
    "Unable to create a greeting. Try again."
  );

  await assert.rejects(
    requestGreeting("Ada", {
      async sendMessage() {
        return { notGreeting: "invalid" };
      }
    }),
    /invalid greeting/
  );
});

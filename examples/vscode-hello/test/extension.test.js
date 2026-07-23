import assert from "node:assert/strict";
import test from "node:test";

import { activate, deactivate } from "../src/extension.js";

const EXPECTED_COMMAND_ID = "hello.vscode";
const EXPECTED_MESSAGE = "Hello from " + "Hello VS Code" + "!";

function createFixture() {
  const state = {
    commandId: undefined,
    commandHandler: undefined,
    disposeCalls: 0,
    messages: []
  };

  const host = {
    commands: {
      registerCommand(commandId, handler) {
        state.commandId = commandId;
        state.commandHandler = handler;
        return {
          dispose() {
            state.disposeCalls += 1;
          }
        };
      }
    },
    window: {
      async showInformationMessage(message) {
        state.messages.push(message);
        return message;
      }
    }
  };

  return {
    context: { subscriptions: [] },
    host,
    state
  };
}

test("activate registers the declared command with the injected host", async () => {
  const fixture = createFixture();
  const activation = await activate(fixture.context, fixture.host);

  assert.equal(fixture.state.commandId, EXPECTED_COMMAND_ID);
  assert.equal(activation.commandId, EXPECTED_COMMAND_ID);
  assert.equal(typeof fixture.state.commandHandler, "function");
  assert.equal(fixture.context.subscriptions.length, 1);

  activation.dispose();
});

test("the registered command displays and returns a real greeting", async () => {
  const fixture = createFixture();
  const activation = await activate(fixture.context, fixture.host);

  assert.equal(typeof fixture.state.commandHandler, "function");
  const result = await fixture.state.commandHandler();

  assert.equal(result, EXPECTED_MESSAGE);
  assert.deepEqual(fixture.state.messages, [EXPECTED_MESSAGE]);

  activation.dispose();
});

test("the activation disposable releases the registration exactly once", async () => {
  const fixture = createFixture();
  const activation = await activate(fixture.context, fixture.host);

  activation.dispose();
  activation.dispose();
  fixture.context.subscriptions[0].dispose();

  assert.equal(fixture.state.disposeCalls, 1);
});

test("deactivate releases the active command registration", async () => {
  const fixture = createFixture();
  await activate(fixture.context, fixture.host);

  deactivate();
  deactivate();

  assert.equal(fixture.state.disposeCalls, 1);
});

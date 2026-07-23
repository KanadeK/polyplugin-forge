import { createGreeting, normalizeName } from "./greeting.js";

export function installBackground(chromeApi) {
  if (
    chromeApi?.runtime?.onInstalled?.addListener === undefined ||
    chromeApi.runtime.onMessage?.addListener === undefined ||
    chromeApi.storage?.local === undefined
  ) {
    throw new TypeError("A Chrome extension runtime with local storage is required.");
  }

  const onInstalled = async () => {
    const stored = await chromeApi.storage.local.get("lastName");
    if (typeof stored.lastName !== "string") {
      await chromeApi.storage.local.set({ lastName: "friend" });
    }
  };

  const onMessage = (message, _sender, sendResponse) => {
    if (message?.type !== "greet") {
      return false;
    }

    const name = normalizeName(message.name);
    const greeting = createGreeting(name);
    void chromeApi.storage.local.set({ lastName: name });
    sendResponse({ greeting });
    return false;
  };

  chromeApi.runtime.onInstalled.addListener(onInstalled);
  chromeApi.runtime.onMessage.addListener(onMessage);

  return { onInstalled, onMessage };
}

const chromeApi = globalThis.chrome;
if (chromeApi?.runtime !== undefined) {
  installBackground(chromeApi);
}

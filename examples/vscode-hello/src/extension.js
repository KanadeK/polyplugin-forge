const COMMAND_ID = "hello.vscode";
const DISPLAY_NAME = "Hello VS Code";
const GREETING = `Hello from ${DISPLAY_NAME}!`;

let activeDisposable;

function requireHost(host) {
  if (
    host === null ||
    typeof host !== "object" ||
    typeof host.commands?.registerCommand !== "function" ||
    typeof host.window?.showInformationMessage !== "function"
  ) {
    throw new TypeError("A VS Code-compatible host is required");
  }

  return host;
}

function requireContext(context) {
  if (
    context === null ||
    typeof context !== "object" ||
    !Array.isArray(context.subscriptions)
  ) {
    throw new TypeError("A VS Code extension context is required");
  }

  return context;
}

export async function activate(context, injectedHost) {
  const extensionContext = requireContext(context);
  const host = requireHost(injectedHost ?? (await import("vscode")));

  let disposed = false;
  const registration = host.commands.registerCommand(COMMAND_ID, async () => {
    await host.window.showInformationMessage(GREETING);
    return GREETING;
  });

  if (registration === null || typeof registration?.dispose !== "function") {
    throw new TypeError("The host returned an invalid command registration");
  }

  const disposable = {
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      registration.dispose();
      if (activeDisposable === disposable) {
        activeDisposable = undefined;
      }
    }
  };

  extensionContext.subscriptions.push(disposable);
  activeDisposable = disposable;

  return {
    commandId: COMMAND_ID,
    message: GREETING,
    dispose: () => {
      disposable.dispose();
    }
  };
}

export function deactivate() {
  activeDisposable?.dispose();
  activeDisposable = undefined;
}

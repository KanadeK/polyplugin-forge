function requiredElement(root, id) {
  const element = root.getElementById(id);
  if (element === null) {
    throw new Error(`Missing popup element: ${id}`);
  }
  return element;
}

export async function requestGreeting(name, runtime = globalThis.chrome?.runtime) {
  if (runtime?.sendMessage === undefined) {
    throw new Error("The Chrome extension runtime is unavailable.");
  }

  const response = await runtime.sendMessage({ type: "greet", name });
  if (
    response === null ||
    typeof response !== "object" ||
    typeof response.greeting !== "string"
  ) {
    throw new Error("The background service returned an invalid greeting.");
  }
  return response.greeting;
}

export function bindPopup(root, greet = requestGreeting) {
  const input = requiredElement(root, "greeting-name");
  const button = requiredElement(root, "greet-button");
  const output = requiredElement(root, "greeting-output");
  let busy = false;

  const submit = async () => {
    if (busy) {
      return;
    }

    busy = true;
    button.disabled = true;
    output.textContent = "Creating greeting…";

    try {
      output.textContent = await greet(input.value);
    } catch {
      output.textContent = "Unable to create a greeting. Try again.";
    } finally {
      button.disabled = false;
      busy = false;
    }
  };

  const onClick = () => submit();
  const onKeyDown = (event) => {
    if (event.key !== "Enter") {
      return undefined;
    }
    event.preventDefault();
    return submit();
  };

  button.addEventListener("click", onClick);
  input.addEventListener("keydown", onKeyDown);

  return {
    submit,
    dispose() {
      button.removeEventListener("click", onClick);
      input.removeEventListener("keydown", onKeyDown);
    }
  };
}

function start() {
  bindPopup(document);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

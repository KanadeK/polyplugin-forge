import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../..");
const chromeExample = resolve(projectRoot, "examples/chrome-hello");

const routes = new Map<
  string,
  { readonly file: string; readonly type: string }
>([
  [
    "/chrome/popup.html",
    {
      file: resolve(chromeExample, "popup.html"),
      type: "text/html; charset=utf-8"
    }
  ],
  [
    "/chrome/popup.css",
    {
      file: resolve(chromeExample, "popup.css"),
      type: "text/css; charset=utf-8"
    }
  ],
  [
    "/chrome/dist/popup.js",
    {
      file: resolve(chromeExample, "src/popup.js"),
      type: "text/javascript; charset=utf-8"
    }
  ]
]);

export interface FixtureServer {
  readonly baseURL: string;
  readonly close: () => Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const route = routes.get(url.pathname);
      if (route === undefined) {
        response.writeHead(404, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end("not found");
        return;
      }

      try {
        const content = await readFile(route.file);
        response.writeHead(200, {
          "content-type": route.type,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        });
        response.end(content);
      } catch {
        response.writeHead(500, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end("fixture unavailable");
      }
    })();
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Fixture server did not bind a TCP port");
  }

  return {
    baseURL: `http://127.0.0.1:${String(address.port)}`,
    close: async () => {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolvePromise();
          } else {
            reject(error);
          }
        });
      });
    }
  };
}

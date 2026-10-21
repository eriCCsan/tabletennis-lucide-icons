import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { root } from "./catalog.mjs";
import { loadConfig, validateConfig } from "./config.ts";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export async function exampleServer(config) {
  const snapshot = JSON.stringify(validateConfig(config ?? (await loadConfig())));
  return createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (path === "/icons.config.json") {
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(request.method === "HEAD" ? undefined : snapshot);
        return;
      }
      const relative = path === "/" ? "example/vanilla/index.html" : path.slice(1);
      const file = resolve(root, relative);
      const allowed =
        file === resolve(root, "example/style.css") ||
        ["dist", "example/vanilla"].some((directory) =>
          file.startsWith(`${resolve(root, directory)}${sep}`),
        );
      if (!allowed || !mimeTypes[extname(file)]) {
        response.writeHead(404).end("Not found");
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, {
        "Content-Type": mimeTypes[extname(file)],
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}

export async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

import { join } from "node:path";
import { root } from "./catalog.mjs";
import { loadConfig } from "./config.ts";
import { buildRequired } from "./ensure-build.mjs";
import { bin, run } from "./run.mjs";
import { exampleServer, listen } from "./server.mjs";

const platform = process.argv[2];
if (platform !== "vanilla" && platform !== "react")
  throw new Error("Choose example:vanilla or example:react");
const config = await loadConfig();
if (await buildRequired()) {
  console.log("Library artifacts are missing or outdated; building first.");
  await run("npm", ["run", "build"]);
}
let server;
if (platform === "vanilla") {
  server = await exampleServer(config);
  console.log(`Vanilla example: ${await listen(server, Number(process.env.PORT ?? 3000))}`);
} else {
  await run(bin("tsc"), ["--project", "example/react/tsconfig.json"]);
  const { createServer } = await import("vite");
  server = await createServer({
    root: join(root, "example/react"),
    server: { host: "127.0.0.1", port: Number(process.env.PORT ?? 5173), strictPort: true },
  });
  await server.listen();
  server.printUrls();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());

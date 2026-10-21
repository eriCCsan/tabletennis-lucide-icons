import { catalog } from "./catalog.mjs";
import { loadConfig } from "./config.ts";
import { bin, run } from "./run.mjs";

await loadConfig();
await catalog();
await run(bin("biome"), ["ci", "--error-on-warnings", "."]);
await run(bin("tsc"), ["--noEmit"]);
await run(process.execPath, [
  "--test",
  "tests/source.test.mjs",
  "tests/config.test.mjs",
  "tests/browser.test.mjs",
  "tests/ensure-build.test.mjs",
]);

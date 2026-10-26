import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { root } from "./catalog.mjs";

export function packResult(output) {
  const parsed = JSON.parse(output);
  // npm 12 keys results by package name; npm 11 returns an array.
  const results = Array.isArray(parsed) ? parsed : Object.values(parsed);
  assert(
    results.length === 1 &&
      results[0]?.name &&
      results[0]?.version &&
      Array.isArray(results[0]?.files) &&
      results[0]?.filename &&
      results[0]?.integrity,
    "Expected one complete npm pack result",
  );
  return results[0];
}

export async function run(command, args, options = {}) {
  const { capture = false, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      ...spawnOptions,
    });
    let output = "";
    let errors = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      errors += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${output}${errors}`));
    });
  });
}

export function bin(name) {
  return new URL(`../node_modules/.bin/${name}`, import.meta.url).pathname;
}

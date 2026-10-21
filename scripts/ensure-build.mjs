import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { root } from "./catalog.mjs";

export async function buildRequired(directory = root) {
  const inputs = [
    "package.json",
    "tsconfig.json",
    "icons.config.json",
    "scripts/build.mjs",
    "scripts/catalog.mjs",
    "scripts/assets.mjs",
    "scripts/config.ts",
  ];
  for (const folder of ["src", "icons"]) {
    for (const file of await readdir(join(directory, folder))) {
      if (/\.(ts|svg)$/.test(file)) inputs.push(`${folder}/${file}`);
    }
  }
  const newestInput = Math.max(
    ...(await Promise.all(inputs.map(async (file) => (await stat(join(directory, file))).mtimeMs))),
  );
  for (const platform of ["react", "vanilla"]) {
    for (const extension of ["js", "d.ts"]) {
      try {
        if (
          (await stat(join(directory, "dist", platform, `index.${extension}`))).mtimeMs <
          newestInput
        )
          return true;
      } catch (error) {
        if (error.code === "ENOENT") return true;
        throw error;
      }
    }
  }
  return false;
}

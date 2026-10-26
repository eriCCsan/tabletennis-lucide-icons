import assert from "node:assert/strict";
import { open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { catalog, root } from "./catalog.mjs";
import { run } from "./run.mjs";

export function registerIcons(icons, hashes) {
  assert(
    hashes && !Array.isArray(hashes) && typeof hashes === "object",
    "Invalid checksum registry",
  );
  const actual = new Map(icons.map((icon) => [icon.file, icon.hash]));
  for (const [file, hash] of Object.entries(hashes)) {
    assert(/^[a-f0-9]{64}$/.test(hash), `${file}: invalid registered checksum`);
    assert(actual.has(file), `${file}: registered source is missing; restore it`);
    assert.equal(
      actual.get(file),
      hash,
      `${file}: existing artwork changed; explicit review required`,
    );
  }
  const exports = new Map();
  for (const icon of icons) {
    assert(
      !exports.has(icon.name),
      `${icon.file}: Duplicate export ${icon.name}, already used by ${exports.get(icon.name)}`,
    );
    exports.set(icon.name, icon.file);
  }
  return {
    added: icons.filter((icon) => !Object.hasOwn(hashes, icon.file)),
    hashes: Object.fromEntries(icons.map((icon) => [icon.file, icon.hash])),
  };
}

export async function addIcons({
  directory = root,
  build = () => run(process.execPath, ["scripts/build.mjs"]),
} = {}) {
  const path = join(directory, "icons/checksums.json");
  const lockPath = `${path}.lock`;
  let lock;
  let before;
  let next;
  try {
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST")
        throw new Error(
          "icons:add is already running or was interrupted; check icons/checksums.json.lock before removing it.",
        );
      throw error;
    }
    before = await readFile(path, "utf8");
    const result = registerIcons(
      await catalog(pathToFileURL(`${join(directory, "icons")}/`)),
      JSON.parse(before),
    );
    next = `${JSON.stringify(result.hashes, null, 2)}\n`;
    if (next !== before) {
      const temporary = await open(`${path}.tmp`, "wx", 0o600);
      try {
        await temporary.writeFile(next);
      } finally {
        await temporary.close();
      }
      await rename(`${path}.tmp`, path);
    }
    await build();
    return result.added.map((icon) => icon.name);
  } catch (error) {
    if (before && next && before !== next && (await readFile(path, "utf8")) === next) {
      const rollback = await open(`${path}.tmp`, "wx", 0o600);
      try {
        await rollback.writeFile(before);
      } finally {
        await rollback.close();
      }
      await rename(`${path}.tmp`, path);
    }
    throw error;
  } finally {
    if (lock) {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const names = await addIcons();
    console.log(
      names.length
        ? `Added and verified: ${names.join(", ")}.`
        : "All icons are registered; build and package checks passed.",
    );
  } catch (error) {
    console.error(`icons:add failed: ${error.message}`);
    process.exitCode = 1;
  }
}

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildRequired } from "../scripts/ensure-build.mjs";

test("example preparation rebuilds missing/stale exports and preserves current builds", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "icons-build-state-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of [
    "package.json",
    "tsconfig.json",
    "icons.config.json",
    "scripts/build.mjs",
    "scripts/catalog.mjs",
    "scripts/assets.mjs",
    "scripts/config.ts",
    "src/core.ts",
    "icons/01-paddle.svg",
  ]) {
    const path = join(directory, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "fixture");
    await utimes(path, 100, 100);
  }
  assert.equal(await buildRequired(directory), true);
  for (const platform of ["react", "vanilla"]) {
    for (const extension of ["js", "d.ts"]) {
      const file = join(directory, "dist", platform, `index.${extension}`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "fixture");
      await utimes(file, 200, 200);
    }
  }
  assert.equal(await buildRequired(directory), false);
  for (const file of [
    "icons.config.json",
    "src/core.ts",
    "icons/01-paddle.svg",
    "scripts/build.mjs",
  ]) {
    const path = join(directory, file);
    await utimes(path, 300, 300);
    assert.equal(await buildRequired(directory), true, `${file} must invalidate the build`);
    await utimes(path, 100, 100);
  }
  await rm(join(directory, "dist/react/index.d.ts"));
  assert.equal(await buildRequired(directory), true);
});

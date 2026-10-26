import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { packResult } from "../scripts/run.mjs";

const receipt = { name: "tabletennis-lucide-icons", version: "0.1.2", integrity: "sha512-YQ==" };

test("npm pack metadata supports npm 11/12 and rejects incomplete or multi-package responses", () => {
  const data = {
    name: receipt.name,
    version: receipt.version,
    filename: "package.tgz",
    files: [],
    integrity: receipt.integrity,
  };
  assert.deepEqual(packResult(JSON.stringify([data])), data);
  assert.deepEqual(packResult(JSON.stringify({ [receipt.name]: data })), data);
  for (const value of [
    [],
    {},
    [data, data],
    { name: receipt.name },
    [{ ...data, integrity: undefined }],
  ])
    assert.throws(() => packResult(JSON.stringify(value)));
});

test("publishing stays local and GitHub has no workflows to monitor", async () => {
  const files = await readdir(new URL("../.github/workflows/", import.meta.url)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return [];
  });
  assert.equal(files.length, 0, "Do not add GitHub workflows");
  const dependabot = await readFile(new URL("../.github/dependabot.yml", import.meta.url), "utf8");
  assert.doesNotMatch(dependabot, /package-ecosystem: github-actions/);
  const source = await readFile(new URL("../scripts/release.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /publish\.yml|actions\/runs|actions\/artifacts|OIDC/);
});

test("manifest/lockfile are synchronized and patched tooling dependencies are actually resolved", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url)));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.deepEqual(lock.packages[""].devDependencies, pkg.devDependencies);
  const vulnerable = Object.entries(lock.packages).filter(([path]) =>
    /node_modules\/(undici|basic-ftp)$/.test(path),
  );
  assert(vulnerable.length >= 2);
  for (const [path, value] of vulnerable) {
    const min = path.endsWith("/undici") ? [7, 30, 1] : [6, 2, 1];
    const actual = value.version.split(".").map(Number);
    assert(
      actual[0] > min[0] ||
        (actual[0] === min[0] &&
          (actual[1] > min[1] || (actual[1] === min[1] && actual[2] >= min[2]))),
      `${path}: unsafe version ${value.version}`,
    );
    const installed = JSON.parse(
      await readFile(new URL(`../${path}/package.json`, import.meta.url)),
    );
    assert.equal(installed.version, value.version);
  }
});

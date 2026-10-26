import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { catalog } from "../scripts/catalog.mjs";
import { addIcons, registerIcons } from "../scripts/icons-add.mjs";

const original = (await catalog())[0];
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "icons-add-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "icons"));
  await writeFile(join(directory, "icons", original.file), original.source);
  await writeFile(
    join(directory, "icons/checksums.json"),
    `${JSON.stringify({ [original.file]: original.hash }, null, 2)}\n`,
  );
  return directory;
}

test("registers only new hashes and rejects changed, missing and duplicate exports", () => {
  const icons = [
    { file: "01-one.svg", hash: "a".repeat(64), name: "One" },
    { file: "02-two.svg", hash: "b".repeat(64), name: "Two" },
  ];
  assert.deepEqual(registerIcons(icons, { "01-one.svg": icons[0].hash }).added, [icons[1]]);
  assert.throws(
    () => registerIcons(icons, { "01-one.svg": "c".repeat(64) }),
    /01-one.svg.*artwork changed/,
  );
  assert.throws(
    () => registerIcons(icons, { "03-old.svg": "c".repeat(64) }),
    /03-old.svg.*missing/,
  );
  assert.throws(() => registerIcons([icons[0], { ...icons[1], name: "One" }], {}), /Duplicate/);
});

test("multiple new SVGs register before exactly one full build; SVG bytes stay unchanged", async (t) => {
  const directory = await fixture(t);
  await writeFile(join(directory, "icons/02-other.svg"), original.source);
  await writeFile(join(directory, "icons/03-third.svg"), original.source);
  let builds = 0;
  const added = await addIcons({
    directory,
    build: async () => {
      builds++;
      const hashes = JSON.parse(await readFile(join(directory, "icons/checksums.json"), "utf8"));
      assert.equal(Object.keys(hashes).length, 3);
    },
  });
  assert.equal(builds, 1);
  assert.deepEqual(added, ["Other", "Third"]);
  assert.equal(await readFile(join(directory, "icons/02-other.svg"), "utf8"), original.source);
  assert.deepEqual(await addIcons({ directory, build: async () => {} }), []);
});

test("build failure restores only its registry update and releases lock", async (t) => {
  const directory = await fixture(t);
  const path = join(directory, "icons/checksums.json");
  const before = await readFile(path, "utf8");
  await writeFile(join(directory, "icons/02-other.svg"), original.source);
  await assert.rejects(
    addIcons({
      directory,
      build: async () => {
        throw new Error("broken build");
      },
    }),
    /broken build/,
  );
  assert.equal(await readFile(path, "utf8"), before);
  await assert.rejects(readFile(`${path}.lock`), { code: "ENOENT" });
  await assert.rejects(
    addIcons({
      directory,
      build: async () => {
        await writeFile(path, "concurrent edit");
        throw new Error("broken build");
      },
    }),
    /broken build/,
  );
  assert.equal(await readFile(path, "utf8"), "concurrent edit");
});

test("invalid numbering, slug and unsafe XML fail before registration/build", async (t) => {
  for (const [file, source, pattern] of [
    ["03-gap.svg", original.source, /03-gap.svg.*number 2/],
    ["02-Bad.svg", original.source, /02-Bad.svg.*lowercase/],
    ["02-other.SVG", original.source, /02-other.SVG.*lowercase/],
    [
      "02-unsafe.svg",
      original.source.replace("<path", '<image href="https://example.com"/><path'),
      /02-unsafe.svg/,
    ],
  ]) {
    const directory = await fixture(t);
    const before = await readFile(join(directory, "icons/checksums.json"), "utf8");
    await writeFile(join(directory, "icons", file), source);
    await assert.rejects(
      addIcons({ directory, build: async () => assert.fail("must not build invalid sources") }),
      pattern,
    );
    assert.equal(await readFile(join(directory, "icons/checksums.json"), "utf8"), before);
  }
});

test("numeric catalog ordering remains correct beyond two-digit numbers", async (t) => {
  const directory = await fixture(t);
  for (let index = 2; index <= 101; index++)
    await writeFile(
      join(directory, "icons", `${String(index).padStart(2, "0")}-icon-${index}.svg`),
      original.source,
    );
  const icons = await catalog(pathToFileURL(`${join(directory, "icons")}/`));
  assert.equal(icons[99].file, "100-icon-100.svg");
  assert.equal(icons[100].name, "Icon101");
});

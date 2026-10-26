import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Resvg } from "@resvg/resvg-js";
import { assetSvg, catalog, parseSvg } from "../scripts/catalog.mjs";
import { strokeWidthFor as computeStrokeWidth } from "../src/core.ts";
import { createIcon } from "../src/react.ts";
import { defaults, names } from "./helpers.mjs";

const strokeWidthFor = (options) => computeStrokeWidth(options, defaults);

const icons = await catalog();
const hashes = JSON.parse(
  await readFile(new URL("../icons/checksums.json", import.meta.url), "utf8"),
);

test("catalog and source hashes", () => {
  assert.deepEqual(
    icons.map(({ name }) => name),
    names,
  );
  assert.deepEqual(Object.fromEntries(icons.map(({ file, hash }) => [file, hash])), hashes);
  for (const icon of icons)
    assert.equal(createIcon(icon.name, icon.nodes, defaults).displayName, icon.name);
});

for (const icon of icons) {
  test(`${icon.name}: safe XML and faithful 24px raster`, () => {
    const reference = icon.source
      .replace('width="64" height="64"', 'width="24" height="24"')
      .replace('stroke-width="2"', `stroke-width="${(defaults.strokeWidth * 64) / 24}"`);
    const original = new Resvg(reference, { font: { loadSystemFonts: false } }).render();
    const generated = new Resvg(
      assetSvg(icon, {
        ...defaults,
        size: 24,
        color: "currentColor",
        absoluteStrokeWidth: false,
      }),
      { font: { loadSystemFonts: false } },
    ).render();
    assert.equal(generated.width, 24);
    assert.equal(generated.height, 24);
    assert.deepEqual(generated.pixels, original.pixels);
    assert(generated.pixels.some((value, index) => index % 4 === 3 && value > 0));
  });
}

for (const [name, fragment] of [
  ["external use", '<use href="https://example.com/icon.svg"/>'],
  ["raster image", '<image href="data:image/png;base64,AAAA"/>'],
  ["script", "<script>alert(1)</script>"],
  ["event handler", '<path d="M0 0L1 1" onclick="alert(1)"/>'],
  ["external paint", '<path d="M0 0L1 1" fill="url(https://example.com)"/>'],
  ["foreign content", "<foreignObject/>"],
  ["wrong namespace", '<path xmlns="https://example.com" d="M0 0L1 1"/>'],
  ["missing circle radius", '<circle cx="2" cy="2"/>'],
  ["empty path", '<path d=""/>'],
]) {
  test(`reject ${name}`, () => {
    const svg = icons[0].source.replace(/<path[^>]*\/>/, fragment);
    assert.throws(() => parseSvg(svg));
  });
}

test("reject DTD, entities and malformed XML", () => {
  for (const source of [
    `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${icons[0].source}`,
    icons[0].source.replace("</svg>", ""),
    icons[0].source.replace("</svg>", "&unknown;</svg>"),
    icons[0].source.replace('width="64"', 'width="24"'),
  ])
    assert.throws(() => parseSvg(source));
});

test("nominal and absolute stroke widths", () => {
  assert.equal(defaults.strokeWidth, 0.75);
  assert.equal(strokeWidthFor({}), 2);
  assert.equal((strokeWidthFor({}) * 24) / 64, 0.75);
  assert.equal((strokeWidthFor({ size: 48 }) * 48) / 64, 1.5);
  assert.equal((strokeWidthFor({ size: 48, absoluteStrokeWidth: true }) * 48) / 64, 0.75);
  assert.equal(strokeWidthFor({ size: 48, nonScalingStroke: true }), 0.75);
  assert.equal(strokeWidthFor({ strokeWidth: 2 }), (2 * 64) / 24);
  assert.equal(strokeWidthFor({ size: "48", strokeWidth: "3", absoluteStrokeWidth: true }), 4);
  assert.equal(strokeWidthFor({ strokeWidth: 0 }), 0);
  for (const strokeWidth of [-1, NaN, Infinity, "bad"]) {
    assert.throws(() => strokeWidthFor({ strokeWidth }), RangeError);
  }
  for (const size of [0, -1, Infinity, "2em", "100%", ""]) {
    assert.throws(() => strokeWidthFor({ size, absoluteStrokeWidth: true }), RangeError);
  }
});

test("optional peers and publishing boundary", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "tabletennis-lucide-icons");
  assert.match(pkg.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  assert.equal(pkg.license, "Apache-2.0");
  assert.equal(pkg.sideEffects, false);
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(Object.keys(pkg.peerDependenciesMeta).sort(), [
    "react",
    "react-native",
    "react-native-svg",
  ]);
  for (const peer of Object.values(pkg.peerDependenciesMeta)) assert.equal(peer.optional, true);
  for (const forbidden of ["publish", "prepublishOnly", "prepack", "prepare", "postinstall"]) {
    assert.equal(pkg.scripts[forbidden], undefined);
  }
  assert.equal(pkg.scripts.release, "node scripts/release.mjs");
  assert.equal(pkg.scripts["release:dry-run"], "node scripts/release.mjs --dry-run");
});

test("README commands exist and documentation stays version/count independent", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const [, command] of readme.matchAll(/npm run ([\w:-]+)/g)) {
    assert(Object.hasOwn(pkg.scripts, command), `Undocumented script: ${command}`);
  }
  assert.doesNotMatch(readme, /\b\d+\.\d+\.\d+\b/);
  assert.doesNotMatch(readme, /\b\d+\s+(?:original\s+)?(?:table-tennis\s+)?icons\b/i);
  assert.doesNotMatch(readme, /^## (?:Icon catalog|Build configuration|Local development)$/im);
});

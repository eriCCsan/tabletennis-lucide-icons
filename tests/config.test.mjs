import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { sheetSvg, spriteSvg } from "../scripts/assets.mjs";
import { assetSvg, catalog } from "../scripts/catalog.mjs";
import { loadConfig, validateConfig } from "../scripts/config.ts";
import { exampleServer, listen } from "../scripts/server.mjs";
import { config } from "./helpers.mjs";

test("configuration: valid root configuration and zero-width strokes", () => {
  assert.deepEqual(validateConfig(config), config);
  const value = structuredClone(config);
  value.defaults.strokeWidth = 0;
  value.sheet.strokeWidth = 0;
  value.defaults.color = "rgb(1 2 3 / 50%)";
  value.example.theme = "dark";
  assert.deepEqual(validateConfig(value), value);
});

for (const [field, value] of [
  ["defaults.size", 0],
  ["defaults.size", -1],
  ["defaults.size", Infinity],
  ["defaults.size", "24"],
  ["defaults.strokeWidth", -1],
  ["defaults.strokeWidth", NaN],
  ["defaults.absoluteStrokeWidth", "false"],
  ["defaults.color", ""],
  ["defaults.color", 123],
  ["defaults.color", 'red" onclick="alert(1)'],
  ["sheet.background", "url(https://example.com)"],
  ["sheet.iconSize", 0],
  ["sheet.iconSize", null],
  ["sheet.strokeWidth", -0.1],
  ["sheet.color", "   "],
  ["example.theme", "system"],
]) {
  test(`configuration rejects ${field}=${String(value)}`, () => {
    const input = structuredClone(config);
    const [section, key] = field.split(".");
    input[section][key] = value;
    assert.throws(
      () => validateConfig(input),
      (error) => error.message.startsWith(`icons.config.json: ${field} `),
    );
  });
}

test("configuration rejects missing/unknown fields and non-object sections", () => {
  for (const value of [
    null,
    [],
    "config",
    {},
    { ...config, unexpected: true },
    { ...config, sheet: [] },
  ]) {
    assert.throws(() => validateConfig(value), /icons\.config\.json:/);
  }
  const missing = structuredClone(config);
  delete missing.defaults.color;
  assert.throws(() => validateConfig(missing), /defaults\.color is required/);
  const unknown = structuredClone(config);
  unknown.defaults.strokeWidht = 2;
  assert.throws(() => validateConfig(unknown), /defaults\.strokeWidht is not a supported field/);
});

test("configuration loader reports missing files and invalid JSON", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "icons-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = pathToFileURL(join(directory, "icons.config.json"));
  await assert.rejects(loadConfig(file), /icons\.config\.json: cannot read valid JSON/);
  await writeFile(file, "{");
  await assert.rejects(loadConfig(file), /icons\.config\.json: cannot read valid JSON/);
});

test("sheet: 0.75px at 48px, independent library defaults, matching reference raster", async () => {
  const [icon] = await catalog();
  const sheet = { iconSize: 48, strokeWidth: 0.75, color: "#000000", background: "#ffffff" };
  const library = { size: 96, strokeWidth: 3, color: "red", absoluteStrokeWidth: false };
  const asset = assetSvg(icon, library);
  assert.match(asset, /width="96" height="96"/);
  assert.match(asset, /color="red"/);
  assert.match(asset, /stroke-width="8"/);
  const svg = sheetSvg([icon], sheet);
  assert.match(
    svg,
    /width="48" height="48" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1"/,
  );
  const actual = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
  const source = icon.source
    .replace('width="64" height="64"', 'width="48" height="48"')
    .replace('stroke-width="2"', 'stroke-width="1"')
    .replace("<svg ", '<svg x="56" y="12" ');
  // Use the same translation to avoid different subpixel rounding in the rasterizer.
  const expected = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="112"><rect width="800" height="112" fill="${sheet.background}"/>${source}</svg>`,
    { font: { loadSystemFonts: false } },
  ).render();
  const crop = Buffer.alloc(48 * 48 * 4);
  const referenceCrop = Buffer.alloc(crop.length);
  const pixels = actual.pixels;
  const referencePixels = expected.pixels;
  for (let y = 0; y < 48; y++) {
    pixels.copy(
      crop,
      y * 48 * 4,
      ((y + 12) * actual.width + 56) * 4,
      ((y + 12) * actual.width + 104) * 4,
    );
    referencePixels.copy(
      referenceCrop,
      y * 48 * 4,
      ((y + 12) * expected.width + 56) * 4,
      ((y + 12) * expected.width + 104) * 4,
    );
  }
  assert.deepEqual(crop, referenceCrop);
  const sprite = spriteSvg([icon], library);
  assert.doesNotMatch(sprite, /color="red"|stroke-width="0\.75"/);
  assert.match(sprite, /stroke="currentColor" stroke-width="8"/);
  const coloredSprite = sprite
    .replace("<svg ", '<svg width="24" height="24" viewBox="0 0 64 64" color="red" ')
    .replace("</svg>", '<use href="#paddle"/></svg>');
  const redPixels = new Resvg(coloredSprite, { font: { loadSystemFonts: false } }).render().pixels;
  assert(redPixels.some((value, index) => index % 4 === 3 && value > 0));
  assert(redPixels.every((value, index) => (index % 4 !== 1 && index % 4 !== 2) || value === 0));
  const absolute = assetSvg(icon, { ...library, absoluteStrokeWidth: true });
  assert.match(absolute, /stroke-width="2"/);
});

test("example: each startup loads the current config, snapshots it and disables caching", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "icons-example-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = pathToFileURL(join(directory, "icons.config.json"));
  for (const theme of ["light", "dark"]) {
    const value = { ...config, example: { theme } };
    await writeFile(file, JSON.stringify(value));
    const loaded = await loadConfig(file);
    const server = await exampleServer(loaded);
    const url = await listen(server);
    try {
      loaded.example.theme = "changed after startup";
      const response = await fetch(`${url}/icons.config.json`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), value);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  await assert.rejects(exampleServer({}), /icons\.config\.json:/);
});

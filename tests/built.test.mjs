import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { Resvg } from "@resvg/resvg-js";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SaxesParser } from "saxes";
import { assetSvg, catalog } from "../scripts/catalog.mjs";
import { exampleServer, listen } from "../scripts/server.mjs";
import { browser, config, defaults, fixture, names, nativeBoundary } from "./helpers.mjs";

const icons = await catalog();

test("built public exports, SVG assets and rendered React output", async () => {
  const react = await import("tabletennis-lucide-icons/react");
  const vanilla = await import("tabletennis-lucide-icons/vanilla");
  assert.deepEqual(Object.keys(react).sort(), [...names].sort());
  assert.deepEqual(Object.keys(vanilla).sort(), [...names].sort());
  const require = createRequire(import.meta.url);
  for (const icon of icons) {
    const source = await readFile(
      require.resolve(`tabletennis-lucide-icons/icons/${icon.file}`),
      "utf8",
    );
    const asset = new Resvg(source, { font: { loadSystemFonts: false } }).render();
    assert.deepEqual(
      asset.pixels,
      new Resvg(assetSvg(icon, defaults), { font: { loadSystemFonts: false } }).render().pixels,
    );
    assert.equal(asset.width, defaults.size);
    const svg = renderToStaticMarkup(createElement(react[icon.name], { color: "#2563eb" }));
    assert.match(svg, /viewBox="0 0 64 64"/);
    assert.match(svg, /stroke-width="2"/);
    assert.match(source, /stroke-width="2"/);
    assert(svg.includes(`width="${defaults.size}"`));
    assert.match(svg, /color="#2563eb"/);
    assert.equal(react[icon.name].displayName, icon.name);
    assert.equal(typeof vanilla[icon.name], "function");
  }
  for (const asset of ["sprite.svg", "sheet.svg", "sheet.png"]) {
    assert(require.resolve(`tabletennis-lucide-icons/${asset}`).endsWith(asset));
  }
});

test("built modules tree-shake every unused icon and isolate platform peers", async () => {
  for (const platform of ["vanilla", "react", "react-native"]) {
    const result = await build({
      stdin: {
        contents: `import { Paddle } from "tabletennis-lucide-icons/${platform}"; console.log(Paddle);`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: "esm",
      platform: "neutral",
      write: false,
      minify: true,
      external: ["react", "react-native", "react-native-svg"],
      metafile: true,
    });
    const output = result.outputFiles[0].text;
    assert(output.includes(icons[0].nodes[0][1].d), `${platform}: requested geometry missing`);
    const usedPaths = new Set(
      icons[0].nodes.filter(([tag]) => tag === "path").map(([, attributes]) => attributes.d),
    );
    for (const icon of icons.slice(1)) {
      for (const [, attributes] of icon.nodes.filter(([tag]) => tag === "path")) {
        if (!usedPaths.has(attributes.d))
          assert(
            !output.includes(attributes.d),
            `${platform}: unused ${icon.name} geometry retained`,
          );
      }
    }
    const imports = Object.values(result.metafile.outputs).flatMap(({ imports }) =>
      imports.map(({ path }) => path),
    );
    if (platform === "vanilla") assert.deepEqual(imports, []);
    if (platform === "react") assert.deepEqual(imports, ["react"]);
    if (platform === "react-native")
      assert.deepEqual(imports.sort(), ["react", "react-native-svg"]);
  }
});

test("sprite has all symbols; SVG and PNG sheets contain the same rendered image", async () => {
  const sprite = await readFile(new URL("../dist/sprite.svg", import.meta.url), "utf8");
  const parser = new SaxesParser({ xmlns: true });
  const ids = [];
  parser.on("opentag", ({ local, attributes }) => {
    if (local === "symbol") ids.push(attributes.id.value);
  });
  parser.write(sprite).close();
  assert.deepEqual(
    ids,
    icons.map(({ slug }) => slug),
  );
  const sheet = await readFile(new URL("../dist/sheet.svg", import.meta.url), "utf8");
  for (const icon of icons) {
    const used = sprite
      .replace("<svg ", '<svg width="24" height="24" viewBox="0 0 64 64" ')
      .replace("</svg>", `<use href="#${icon.slug}"/></svg>`);
    const actual = new Resvg(used, { font: { loadSystemFonts: false } }).render();
    const expected = new Resvg(
      assetSvg(icon, { ...defaults, size: 24, color: "currentColor", absoluteStrokeWidth: false }),
      { font: { loadSystemFonts: false } },
    ).render();
    assert.deepEqual(
      actual.pixels,
      expected.pixels,
      `Sprite ${icon.slug} differs from individual SVG`,
    );
  }
  for (const [index, icon] of icons.entries())
    assert(sheet.includes(`${index + 1}. ${icon.slug}</text>`));
  const rendered = new Resvg(sheet).render();
  const width = 5 * Math.max(160, config.sheet.iconSize + 32);
  const height = Math.ceil(icons.length / 5) * (config.sheet.iconSize + 64);
  assert.equal(rendered.width, width);
  assert.equal(rendered.height, height);
  assert(
    sheet.includes(`stroke-width="${(config.sheet.strokeWidth * 64) / config.sheet.iconSize}"`),
  );
  assert(sheet.includes(`color="${config.sheet.color}"`));
  assert(sheet.includes(`fill="${config.sheet.background}"`));
  const png = await readFile(new URL("../dist/sheet.png", import.meta.url));
  assert.equal(png.readUInt32BE(16), width);
  assert.equal(png.readUInt32BE(20), height);
  assert.deepEqual(
    createHash("sha256").update(rendered.asPng()).digest(),
    createHash("sha256").update(png).digest(),
  );
  assert.equal((await readdir(new URL("../dist/icons/", import.meta.url))).length, icons.length);
});

test("actual built React Native modules at the native renderer boundary", async (t) => {
  const served = await fixture(
    `
    import * as icons from "tabletennis-lucide-icons/react-native";
    import {createElement, createRef} from "react";
    import {createRoot} from "react-dom/client";
    import {flushSync} from "react-dom";
    const refs = Object.keys(icons).map(() => createRef());
    const root = createRoot(document.querySelector("#root"));
    globalThis.renderNative = props => flushSync(() => root.render(
      createElement("div", {}, ...Object.entries(icons).map(([name, Icon], index) =>
        createElement(Icon, {key:name, ref:refs[index], ...props, "data-name":name})
      ))
    ));
    globalThis.renderNative({});
    globalThis.result = {names:Object.keys(icons), refs:refs.every(ref => ref.current?.tagName === "svg")};
  `,
    [nativeBoundary],
  );
  const instance = await browser();
  t.after(async () => {
    await instance.close();
    await new Promise((resolve) => served.server.close(resolve));
  });
  const page = await instance.newPage();
  await page.goto(served.url);
  await page.waitForFunction(() => globalThis.result);
  const result = await page.evaluate(() => globalThis.result);
  assert.deepEqual(result.names.sort(), [...names].sort());
  assert(result.refs);
  assert.equal(await page.locator('svg[width="24"][stroke-width="2"]').count(), names.length);
  await page.evaluate(() =>
    globalThis.renderNative({ size: 48, strokeWidth: 3, absoluteStrokeWidth: true, color: "red" }),
  );
  assert.equal(await page.locator('svg[stroke-width="4"][color="red"]').count(), names.length);
  assert.equal(
    await page.locator('[data-name="PipsRubber"] circle[stroke="none"][fill="red"]').count(),
    28,
  );
});

test("vanilla example loads actual built modules and all controls work", async (t) => {
  const server = await exampleServer();
  const url = await listen(server);
  const instance = await browser();
  t.after(async () => {
    await instance.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const page = await instance.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (!response.ok()) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(url);
  await page.waitForSelector(`#icons figure:nth-child(${names.length})`);
  assert.deepEqual((await page.locator("figcaption").allTextContents()).sort(), [...names].sort());
  assert.equal(
    await page.locator(`#icons svg[width="${defaults.size}"][height="${defaults.size}"]`).count(),
    names.length,
  );
  assert.equal(await page.locator("#size").inputValue(), String(defaults.size));
  assert.equal(await page.locator("#color").inputValue(), defaults.color);
  assert.equal(await page.locator("#stroke").inputValue(), String(defaults.strokeWidth));
  assert.equal(await page.locator("#absolute").isChecked(), defaults.absoluteStrokeWidth);
  assert.equal(await page.locator("#background").inputValue(), config.example.theme);
  await page.locator("#size").fill("48");
  await page.locator("#stroke").fill("3");
  await page.locator("#absolute").check();
  await page.locator("#color").fill("#ff0000");
  await page.locator("#background").selectOption("dark");
  assert.equal(
    await page
      .locator('#icons svg[width="48"][height="48"][stroke-width="4"][color="#ff0000"]')
      .count(),
    names.length,
  );
  assert.equal(await page.locator("body").getAttribute("data-background"), "dark");
  await page.locator("#background").selectOption("light");
  assert.equal(await page.locator("body").getAttribute("data-background"), "light");
  assert.deepEqual(errors, []);
  const forbidden = await fetch(`${url}/%2e%2e/package.json`);
  assert.equal(forbidden.status, 404);
});

test("example restart initializes all controls from current config, even outside slider limits", async (t) => {
  const instance = await browser();
  t.after(() => instance.close());
  const page = await instance.newPage();
  for (const settings of [
    {
      ...config,
      defaults: { size: 120, color: "currentColor", strokeWidth: 5.5, absoluteStrokeWidth: true },
      example: { theme: "dark" },
    },
    {
      ...config,
      defaults: { size: 12, color: "#aa22cc", strokeWidth: 0, absoluteStrokeWidth: false },
      example: { theme: "light" },
    },
  ]) {
    const server = await exampleServer(settings);
    const url = await listen(server);
    try {
      await page.goto(url);
      await page.waitForSelector(`#icons figure:nth-child(${names.length})`);
      assert.equal(await page.locator("#size").inputValue(), String(settings.defaults.size));
      assert.equal(await page.locator("#color").inputValue(), settings.defaults.color);
      assert.equal(
        await page.locator("#stroke").inputValue(),
        String(settings.defaults.strokeWidth),
      );
      assert.equal(
        await page.locator("#absolute").isChecked(),
        settings.defaults.absoluteStrokeWidth,
      );
      assert.equal(await page.locator("#background").inputValue(), settings.example.theme);
      assert.equal(
        await page.locator("body").getAttribute("data-background"),
        settings.example.theme,
      );
      const width =
        (settings.defaults.strokeWidth * 64) /
        (settings.defaults.absoluteStrokeWidth ? settings.defaults.size : 24);
      assert.equal(
        await page
          .locator(
            `#icons svg[width="${settings.defaults.size}"][color="${settings.defaults.color}"][stroke-width="${width}"]`,
          )
          .count(),
        names.length,
      );
      await page.locator("#color").fill("red");
      assert.equal(await page.locator('#icons svg[color="red"]').count(), names.length);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

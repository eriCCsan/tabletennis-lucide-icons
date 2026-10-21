import assert from "node:assert/strict";
import test from "node:test";
import { catalog } from "../scripts/catalog.mjs";
import { browser, defaults, fixture, nativeBoundary } from "./helpers.mjs";

const icons = await catalog();

test("browser: React refs, native adapter boundary and vanilla rendering", async (t) => {
  const served = await fixture(
    `
    import {createElement, createRef} from "react";
    import {createRoot} from "react-dom/client";
    import {flushSync} from "react-dom";
    import {createIcon as reactIcon} from "./src/react.ts";
    import {createIcon as nativeIcon} from "./src/react-native.ts";
    import {createIcon as vanillaIcon} from "./src/vanilla.ts";
    const icons = ${JSON.stringify(icons.map(({ name, nodes, source }) => ({ name, nodes, source })))};
    const root = createRoot(document.querySelector("#root"));
    globalThis.renderIcon = (index, props = {}, defaults = ${JSON.stringify(defaults)}, testNodes) => {
      document.querySelectorAll('[data-platform="vanilla"]').forEach(element => element.remove());
      const icon = icons[index];
      const nodes = testNodes ?? icon.nodes;
      const ReactIcon = reactIcon(icon.name, nodes, defaults);
      const NativeIcon = nativeIcon(icon.name, nodes, defaults);
      const reactRef = createRef(), nativeRef = createRef();
      flushSync(() => root.render(createElement("div", {},
        createElement(ReactIcon, {...props, ref: reactRef, "data-platform":"react"}),
        createElement(NativeIcon, {...props, ref: nativeRef, "data-platform":"native"})
      )));
      const vanilla = vanillaIcon(icon.name, nodes, defaults)({...props, "data-platform":"vanilla"});
      document.querySelector("#root>div").append(vanilla);
      return {
        reactRef: reactRef.current === document.querySelector('[data-platform="react"]'),
        nativeRef: nativeRef.current === document.querySelector('[data-platform="native"]'),
        svgs: Array.from(document.querySelectorAll("svg"), el => el.outerHTML),
      };
    };
    globalThis.comparePixels = async (index) => {
      const raster = async source => {
        const image = new Image();
        image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 24;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, 24, 24);
        return ctx.getImageData(0,0,24,24).data;
      };
      const reference = icons[index].source
        .replace('width="64" height="64"','width="24" height="24"')
        .replace('stroke-width="2"','stroke-width="${(defaults.strokeWidth * 64) / 24}"');
      const expected = await raster(reference);
      for (const svg of document.querySelectorAll("svg")) {
        const clone = svg.cloneNode(true);
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        const actual = await raster(clone.outerHTML);
        if (!actual.every((value,i) => value === expected[i])) return false;
      }
      return true;
    };
    globalThis.ready = true;
  `,
    [nativeBoundary],
  );
  const instance = await browser();
  t.after(async () => {
    await instance.close();
    await new Promise((resolve) => served.server.close(resolve));
  });
  const page = await instance.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(served.url);
  await page.waitForFunction(() => globalThis.ready);

  for (const [index, icon] of icons.entries()) {
    await t.test(`${icon.name}: 24x24 pixels match the original`, async () => {
      const result = await page.evaluate(
        (index) =>
          globalThis.renderIcon(index, {
            size: 24,
            color: "currentColor",
            absoluteStrokeWidth: false,
          }),
        index,
      );
      assert(result.reactRef && result.nativeRef);
      assert.equal(await page.evaluate((index) => globalThis.comparePixels(index), index), true);
      for (const svg of result.svgs) {
        assert.match(svg, /width="24"/);
        assert.match(svg, /height="24"/);
        assert.match(svg, /stroke-width="2"/);
      }
    });
  }
  await t.test("default stroke scales normally and stays constant in absolute mode", async () => {
    for (const absoluteStrokeWidth of [false, true]) {
      const result = await page.evaluate(
        (absoluteStrokeWidth) => globalThis.renderIcon(0, { size: 48, absoluteStrokeWidth }),
        absoluteStrokeWidth,
      );
      for (const svg of result.svgs) {
        assert(svg.includes(`stroke-width="${absoluteStrokeWidth ? 1 : 2}"`));
      }
    }
  });
  await t.test("props, color, absolute stroke and filled parts", async () => {
    const result = await page.evaluate(() =>
      globalThis.renderIcon(24, {
        size: 48,
        color: "#e11d48",
        strokeWidth: 3,
        absoluteStrokeWidth: true,
        className: "custom",
        "aria-label": "Player",
        tabIndex: 0,
      }),
    );
    for (const svg of result.svgs) {
      assert.match(svg, /width="48"/);
      assert.match(svg, /height="48"/);
      assert.match(svg, /stroke-width="4"/);
      assert.match(svg, /class="custom"/);
      assert.match(svg, /aria-label="Player"/);
      assert.doesNotMatch(svg, /aria-hidden="true"/);
      assert.match(svg, /stroke="none"/);
      assert.match(svg, /fill-rule="evenodd"/);
    }
    const colors = await page.locator("svg").evaluateAll((svgs) =>
      svgs.map((svg) => ({
        color: getComputedStyle(svg).color,
        fill: getComputedStyle(svg.querySelector("path")).fill,
      })),
    );
    for (const { color, fill } of colors) {
      assert.equal(color, "rgb(225, 29, 72)");
      assert.equal(fill, "rgb(225, 29, 72)");
    }
  });
  await t.test("regular stroke scales with size and zero stroke is retained", async () => {
    const regular = await page.evaluate(() =>
      globalThis.renderIcon(0, { size: 48, strokeWidth: 2, absoluteStrokeWidth: false }),
    );
    for (const svg of regular.svgs) assert.match(svg, /stroke-width="5\.333333333333333"/);
    const zero = await page.evaluate(() =>
      globalThis.renderIcon(22, { strokeWidth: 0, color: "currentColor" }),
    );
    for (const svg of zero.svgs) {
      assert.match(svg, /stroke-width="0"/);
      assert.match(svg, /fill="currentColor"/);
      assert.match(svg, /stroke="none"/);
    }
  });
  await t.test("all platforms use configured defaults and explicit props win", async () => {
    const configured = { size: 40, color: "#123456", strokeWidth: 3, absoluteStrokeWidth: true };
    const result = await page.evaluate(
      (settings) => globalThis.renderIcon(0, {}, settings),
      configured,
    );
    for (const svg of result.svgs) {
      assert.match(svg, /width="40" height="40"/);
      assert.match(svg, /color="#123456"/);
      assert.match(svg, /stroke-width="4\.8"/);
    }
    const overridden = await page.evaluate(
      (settings) =>
        globalThis.renderIcon(
          0,
          {
            size: 48,
            color: "red",
            strokeWidth: 0,
            absoluteStrokeWidth: false,
          },
          settings,
        ),
      configured,
    );
    for (const svg of overridden.svgs) {
      assert.match(svg, /width="48" height="48"/);
      assert.match(svg, /color="red"/);
      assert.match(svg, /stroke-width="0"/);
    }
    const relative = await page.evaluate(
      (settings) =>
        globalThis.renderIcon(
          0,
          {
            absoluteStrokeWidth: false,
          },
          settings,
        ),
      configured,
    );
    for (const svg of relative.svgs) assert.match(svg, /stroke-width="8"/);
  });
  await t.test("nonScalingStroke keeps a 2px contour through viewBox and CSS scaling", async () => {
    for (const size of [24, 48]) {
      await page.evaluate(
        (size) =>
          globalThis.renderIcon(
            0,
            {
              size,
              color: "black",
              strokeWidth: 2,
              absoluteStrokeWidth: true,
              nonScalingStroke: true,
            },
            undefined,
            [["path", { d: "M8 32H56" }]],
          ),
        size,
      );
      for (const svg of await page.locator("svg").all()) {
        await svg.evaluate((element) => {
          element.style.width = "96px";
          element.style.height = "96px";
          element.style.backgroundColor = "white";
        });
        assert.equal(await svg.getAttribute("stroke-width"), "2");
        assert.equal(await svg.locator("path").getAttribute("vector-effect"), "non-scaling-stroke");
        assert.equal(await svg.getAttribute("non-scaling-stroke"), null);
        const screenshot = await svg.screenshot({ scale: "css" });
        const rows = await page.evaluate(async (png) => {
          const image = new Image();
          image.src = `data:image/png;base64,${png}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 96;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(48, 0, 1, 96).data;
          return Array.from({ length: 96 }, (_, y) => pixels[y * 4]).filter((red) => red < 128)
            .length;
        }, screenshot.toString("base64"));
        assert.equal(rows, 2);
      }
    }
    const filled = await page.evaluate(() =>
      globalThis.renderIcon(22, {
        size: "2em",
        strokeWidth: 2,
        nonScalingStroke: true,
        color: "currentColor",
      }),
    );
    for (const svg of filled.svgs) {
      assert.match(svg, /fill="currentColor"/);
      assert.match(svg, /stroke="none"/);
    }
  });
  assert.deepEqual(errors, []);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { preview } from "vite";
import { root } from "../scripts/catalog.mjs";
import { waitForExample } from "./example-start.mjs";
import { browser, config, names } from "./helpers.mjs";

async function startExample(script, t) {
  const grouped = process.platform !== "win32";
  const child = spawn("npm", ["run", script], {
    cwd: root,
    env: { ...process.env, PORT: "0" },
    detached: grouped,
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    const closed =
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => child.once("close", resolve));
    function kill(signal) {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    kill("SIGTERM");
    const timer = setTimeout(() => kill("SIGKILL"), 5000);
    try {
      await closed;
    } finally {
      clearTimeout(timer);
      if (grouped) kill("SIGKILL");
    }
  });
  return waitForExample(child);
}

async function exercise(page, url, react) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url);
  await page.waitForSelector(`#icons figure:nth-child(${names.length})`);
  assert.deepEqual((await page.locator("figcaption").allTextContents()).sort(), [...names].sort());
  assert.equal(await page.locator("#icons svg").count(), names.length);
  assert.equal(await page.locator("#size").inputValue(), String(config.defaults.size));
  assert.equal(await page.locator("#color").inputValue(), config.defaults.color);
  assert.equal(await page.locator("#stroke").inputValue(), String(config.defaults.strokeWidth));
  assert.equal(
    await page.locator('#icons svg[width="24"][stroke-width="2"]').count(),
    names.length,
  );
  await page.locator("#size").fill("48");
  await page.locator("#stroke").fill("3");
  await page.locator("#color").fill("#ff0000");
  const width = (3 * 64) / (config.defaults.absoluteStrokeWidth ? 48 : 24);
  assert.equal(
    await page.locator(`#icons svg[width="48"][height="48"][stroke-width="${width}"]`).count(),
    names.length,
  );
  const colors = await page
    .locator("#icons svg")
    .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).color));
  assert(colors.every((color) => color === "rgb(255, 0, 0)"));
  if (react)
    assert.equal(await page.locator('#icons svg.icon[color="currentColor"]').count(), names.length);
  await page.locator("#background").selectOption("dark");
  assert.equal(await page.locator('[data-background="dark"]').count(), 1);
  await page.locator("#background").selectOption("light");
  assert.equal(await page.locator('[data-background="light"]').count(), 1);
  await page.setViewportSize({ width: 375, height: 800 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.deepEqual(errors, []);
}

test("both npm example commands start and render every catalog icon with working controls", async (t) => {
  const instance = await browser();
  t.after(() => instance.close());
  for (const platform of ["vanilla", "react"]) {
    await t.test(platform, async (t) => {
      const url = await startExample(`example:${platform}`, t);
      const page = await instance.newPage();
      t.after(() => page.close());
      await exercise(page, url, platform === "react");
    });
  }
});

test("React production build renders the public package in the browser", async (t) => {
  const server = await preview({
    root: join(root, "example/react"),
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  const instance = await browser();
  t.after(async () => {
    await instance.close();
    await new Promise((resolve) => server.httpServer.close(resolve));
  });
  const page = await instance.newPage();
  await exercise(page, server.resolvedUrls.local[0], true);
});

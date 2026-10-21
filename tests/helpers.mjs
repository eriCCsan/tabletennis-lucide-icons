import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import { loadConfig } from "../scripts/config.ts";
import { listen } from "../scripts/server.mjs";

export const config = await loadConfig();
export const defaults = config.defaults;

export const names = [
  "Paddle",
  "Ball",
  "PaddlePair",
  "Table",
  "BallOverNet",
  "Topspin",
  "Backspin",
  "Sidespin",
  "FastBall",
  "Serve",
  "Direction",
  "Irregular",
  "Player",
  "WinnerPose",
  "Trophy",
  "Podium",
  "Medal",
  "Umpire",
  "BallRobot",
  "BallBasket",
  "Rubber",
  "Wood",
  "PipsRubber",
  "Scoreboard",
  "PlayerInAction",
];

export async function browser() {
  // macOS 13 cannot run current bundled Chromium; a locally installed Chrome still can.
  return chromium.launch({
    ...(!existsSync(chromium.executablePath()) ? { channel: "chrome" } : {}),
    headless: true,
  });
}

export async function fixture(source, plugins = []) {
  const output = await build({
    stdin: { contents: source, resolveDir: process.cwd(), loader: "js" },
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    plugins,
  });
  const server = createServer((request, response) => {
    if (request.url === "/test.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(output.outputFiles[0].text);
    } else {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        '<!doctype html><html lang="en"><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>',
      );
    }
  });
  return { server, url: await listen(server) };
}

export const nativeBoundary = {
  name: "native-renderer-boundary",
  setup(build) {
    build.onResolve({ filter: /^react-native-svg$/ }, () => ({ path: "svg", namespace: "native" }));
    build.onLoad({ filter: /.*/, namespace: "native" }, () => ({
      contents: `import {createElement, forwardRef} from "react";
        export const Svg = forwardRef((props, ref) => createElement("svg", {...props, ref}));
        export const Path = forwardRef((props, ref) => createElement("path", {...props, ref}));
        export const Circle = forwardRef((props, ref) => createElement("circle", {...props, ref}));`,
      resolveDir: process.cwd(),
      loader: "js",
    }));
  },
};

import assert from "node:assert/strict";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { catalog, root } from "../scripts/catalog.mjs";
import { bin, run } from "../scripts/run.mjs";
import { names } from "./helpers.mjs";

const tarball = process.env.ICON_TARBALL;
assert(tarball, "This test belongs to npm run build");

async function installPacked(t) {
  const directory = await mkdtemp(join(tmpdir(), "tabletennis-consumer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "package.json"),
    '{"name":"isolated-icon-consumer","private":true,"type":"module"}',
  );
  await run(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--omit=optional",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    { cwd: directory, capture: true },
  );
  return directory;
}

test("actual tarball contents, optional peer isolation and standalone vanilla import", async (t) => {
  const listing = (await run("tar", ["-tzf", tarball], { capture: true })).trim().split("\n");
  assert(
    listing.every((file) => /^package\/(dist\/|README\.md$|LICENSE$|package\.json$)/.test(file)),
  );
  const icons = await catalog();
  for (const icon of icons) assert(listing.includes(`package/dist/icons/${icon.file}`));
  for (const file of ["LICENSE", "README.md", "sprite.svg", "sheet.svg", "sheet.png"]) {
    assert(
      listing.includes(
        `package/${file.includes(".") && file !== "README.md" ? `dist/${file}` : file}`,
      ),
    );
  }
  const directory = await installPacked(t);
  for (const peer of ["react", "react-native", "react-native-svg"]) {
    await assert.rejects(access(join(directory, "node_modules", peer)));
  }
  const output = await run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import * as icons from "tabletennis-lucide-icons/vanilla";
    console.log(JSON.stringify(Object.keys(icons)));
    for (const file of ${JSON.stringify(icons.map(({ file }) => file))}) {
      import.meta.resolve("tabletennis-lucide-icons/icons/" + file);
    }
  `,
    ],
    { cwd: directory, capture: true },
  );
  assert.deepEqual(JSON.parse(output).sort(), [...names].sort());
  const installed = JSON.parse(
    await readFile(join(directory, "node_modules/tabletennis-lucide-icons/package.json"), "utf8"),
  );
  const source = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(installed.version, source.version);
});

test("packed declaration resolution with NodeNext and bundler consumers", async (t) => {
  const directory = await installPacked(t);
  for (const dependency of [
    "react",
    "react-dom",
    "react-native",
    "react-native-svg",
    "@types",
    "vite",
  ]) {
    await symlink(
      join(root, "node_modules", dependency),
      join(directory, "node_modules", dependency),
      "dir",
    );
  }
  const consumer = join(directory, "consumer.mts");
  const readme = await readFile(join(root, "README.md"), "utf8");
  const snippets = [];
  for (const [index, match] of [...readme.matchAll(/^```(tsx|js)\n([\s\S]*?)^```/gm)].entries()) {
    const file = join(directory, `readme-${index}.${match[1]}`);
    await writeFile(file, match[2]);
    snippets.push(file);
  }
  assert(
    snippets.some((file) => file.endsWith(".tsx")),
    "Missing README component examples",
  );
  assert(
    snippets.some((file) => file.endsWith(".js")),
    "Missing README browser examples",
  );
  await writeFile(
    consumer,
    `
    import {createElement, createRef} from "react";
    import type {Svg} from "react-native-svg";
    import {Paddle, type IconProps} from "tabletennis-lucide-icons/react";
    import {Paddle as NativePaddle} from "tabletennis-lucide-icons/react-native";
    import {Paddle as VanillaPaddle} from "tabletennis-lucide-icons/vanilla";
    const props: IconProps = {size:24, strokeWidth:2, absoluteStrokeWidth:true};
    createElement(Paddle, {...props, ref:createRef<SVGSVGElement>(), className:"icon"});
    createElement(NativePaddle, {size:24, ref:createRef<Svg>(), accessibilityLabel:"Paddle"});
    const el: SVGSVGElement = VanillaPaddle({color:"red"});
    // @ts-expect-error Unknown icon must fail to import.
    import {MissingIcon} from "tabletennis-lucide-icons/react";
    // @ts-expect-error Invalid props must fail.
    createElement(Paddle, {size:{}});
  `,
  );
  for (const [module, resolution] of [
    ["NodeNext", "NodeNext"],
    ["ESNext", "Bundler"],
  ]) {
    await run(bin("tsc"), [
      "--ignoreConfig",
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--allowJs",
      "--checkJs",
      "--jsx",
      "react-jsx",
      "--types",
      "vite/client",
      "--target",
      "ES2022",
      "--lib",
      "ES2022,DOM",
      "--module",
      module,
      "--moduleResolution",
      resolution,
      consumer,
      ...snippets,
    ]);
  }
  const app = join(directory, "example/react");
  await mkdir(app, { recursive: true });
  for (const file of ["index.html", "main.tsx", "tsconfig.json"]) {
    await cp(join(root, "example/react", file), join(app, file));
  }
  await cp(join(root, "example/style.css"), join(directory, "example/style.css"));
  await cp(join(root, "icons.config.json"), join(directory, "icons.config.json"));
  await run(bin("tsc"), ["--project", join(app, "tsconfig.json")], { cwd: directory });
  await run(bin("vite"), ["build", app], { cwd: directory });
  const assets = join(app, "dist/assets");
  const javascript = (
    await Promise.all(
      (
        await readdir(assets)
      )
        .filter((file) => file.endsWith(".js"))
        .map((file) => readFile(join(assets, file), "utf8")),
    )
  ).join("\n");
  for (const icon of await catalog()) {
    assert(
      javascript.includes(icon.nodes.find(([tag]) => tag === "path")[1].d),
      `${icon.name} missing from packed consumer build`,
    );
  }
});

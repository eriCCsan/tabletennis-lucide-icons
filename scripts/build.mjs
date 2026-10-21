import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { build } from "esbuild";
import { optimize } from "svgo";
import { sheetSvg, spriteSvg } from "./assets.mjs";
import { assetSvg, catalog, root } from "./catalog.mjs";
import { loadConfig } from "./config.ts";
import { bin, run } from "./run.mjs";

const config = await loadConfig();
await run("npm", ["run", "check"]);
const icons = await catalog();
const stage = join(root, ".cache", "build");
const dist = join(root, "dist");
// These are generated directories owned exclusively by this builder.
await rm(stage, { recursive: true, force: true });
await rm(dist, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await mkdir(join(dist, "icons"), { recursive: true });
for (const file of await readdir(join(root, "src"))) {
  const source = await readFile(join(root, "src", file), "utf8");
  await writeFile(join(stage, file), source.replace(/(from ["']\.[^"']*)\.ts(["'])/g, "$1.js$2"));
}
await mkdir(join(stage, "nodes"));
await writeFile(
  join(stage, "defaults.ts"),
  `import type { IconDefaults } from "./core.js";\nexport const defaults: IconDefaults = ${JSON.stringify(config.defaults)};\n`,
);
for (const icon of icons) {
  await writeFile(
    join(stage, "nodes", `${icon.slug}.ts`),
    `import type { IconNode } from "../core.js";\nexport const nodes: IconNode = ${JSON.stringify(icon.nodes)};\n`,
  );
}

const entryPoints = ["core", "defaults", "react", "react-native", "vanilla"].map((name) =>
  join(stage, `${name}.ts`),
);
entryPoints.push(...icons.map(({ slug }) => join(stage, "nodes", `${slug}.ts`)));
for (const platform of ["react", "react-native", "vanilla"]) {
  await mkdir(join(stage, platform));
  const type = platform === "vanilla" ? "IconFunction" : "IconComponent";
  for (const icon of icons) {
    const file = join(stage, platform, `${icon.slug}.ts`);
    await writeFile(
      file,
      `import { createIcon, type ${type} } from "../${platform}.js";\n` +
        `import { nodes } from "../nodes/${icon.slug}.js";\n` +
        `import { defaults } from "../defaults.js";\n` +
        `export const ${icon.name}: ${type} = /* @__PURE__ */ createIcon("${icon.name}", nodes, defaults);\n`,
    );
    entryPoints.push(file);
  }
  const index = join(stage, platform, "index.ts");
  await writeFile(
    index,
    `export type { IconProps, ${type} } from "../${platform}.js";\n` +
      icons.map(({ name, slug }) => `export { ${name} } from "./${slug}.js";`).join("\n"),
  );
  entryPoints.push(index);
}
await writeFile(
  join(stage, "tsconfig.json"),
  JSON.stringify({
    extends: "../../tsconfig.json",
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      rootDir: ".",
      outDir: "../../dist",
    },
    include: ["**/*.ts"],
  }),
);
await run(bin("tsc"), ["-p", join(stage, "tsconfig.json")]);
await build({
  entryPoints,
  outdir: dist,
  outbase: stage,
  bundle: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: true,
  treeShaking: true,
  legalComments: "eof",
});

for (const icon of icons) {
  const result = optimize(assetSvg(icon, config.defaults), {
    plugins: ["removeComments", "removeMetadata", "removeXMLProcInst", "removeDoctype"],
  });
  await writeFile(join(dist, "icons", icon.file), result.data);
}
await writeFile(join(dist, "sprite.svg"), spriteSvg(icons, config.defaults));
const sheet = sheetSvg(icons, config.sheet);
await writeFile(join(dist, "sheet.svg"), sheet);
await writeFile(join(dist, "sheet.png"), new Resvg(sheet).render().asPng());

await run(bin("tsc"), ["--project", "example/react/tsconfig.json"]);
await run(bin("vite"), ["build", "example/react"]);
await run(process.execPath, ["--test", "tests/built.test.mjs", "tests/examples.test.mjs"]);
const dryRun = JSON.parse(await run("npm", ["pack", "--dry-run", "--json"], { capture: true }));
assert(
  dryRun[0].files.every(({ path }) => /^(dist\/|README\.md$|LICENSE$|package\.json$)/.test(path)),
  "Unexpected package files",
);
await mkdir(join(root, "artifacts"), { recursive: true });
const packed = JSON.parse(
  await run("npm", ["pack", "--json", "--pack-destination", "artifacts"], { capture: true }),
);
const tarball = join(root, "artifacts", packed[0].filename);
await run(bin("publint"), ["--strict", tarball]);
// ATTW analyzes JS/types; raw SVG/PNG exports are validated by the artifact tests.
await run(bin("attw"), [
  tarball,
  "--profile",
  "esm-only",
  "--entrypoints",
  "react",
  "react-native",
  "vanilla",
]);
await run(process.execPath, ["--test", "tests/package.test.mjs"], {
  env: { ...process.env, ICON_TARBALL: tarball },
});
assert.deepEqual(
  (await catalog()).map(({ hash }) => hash),
  icons.map(({ hash }) => hash),
  "Original SVGs changed during build",
);
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
console.log(`Build complete: ${metadata.name}@${metadata.version}\nTarball: ${tarball}`);

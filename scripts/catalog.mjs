import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SaxesParser } from "saxes";
import { strokeWidthFor } from "../src/core.ts";

export const root = fileURLToPath(new URL("../", import.meta.url));
const namespace = "http://www.w3.org/2000/svg";
const rootAttributes = new Set([
  "xmlns",
  "width",
  "height",
  "viewBox",
  "color",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
]);
const shapeAttributes = {
  path: new Set(["d", "fill", "stroke", "fill-rule"]),
  circle: new Set(["cx", "cy", "r", "fill", "stroke"]),
};

export function parseSvg(source) {
  assert(
    !/<!|<\?/.test(source),
    "SVG declarations, entities and processing instructions are forbidden",
  );
  const parser = new SaxesParser({ xmlns: true });
  const nodes = [];
  let depth = 0;
  let svg;
  parser.on("error", (error) => {
    throw error;
  });
  parser.on("text", (text) => assert(!text.trim(), "Unexpected SVG text"));
  parser.on("opentag", (element) => {
    assert.equal(element.uri, namespace, "Invalid SVG namespace");
    const attributes = Object.fromEntries(
      Object.values(element.attributes).map(({ name, value }) => [name, value]),
    );
    const allowed = depth === 0 ? rootAttributes : shapeAttributes[element.name];
    assert(depth < 2 && allowed, "Unsupported or nested SVG element");
    for (const [name, value] of Object.entries(attributes)) {
      assert(allowed.has(name), `Unsupported SVG attribute: ${name}`);
      assert(!/url\s*\(|[<>]/i.test(value), "Unsafe SVG attribute value");
      if (name === "fill" || name === "stroke") {
        assert(value === "none" || value === "currentColor", "Unsupported SVG paint");
      }
    }
    if (depth === 0) {
      assert.equal(element.name, "svg");
      assert.equal(attributes.xmlns, namespace);
      assert.equal(attributes.viewBox, "0 0 64 64");
      assert.equal(attributes.width, "64");
      assert.equal(attributes.height, "64");
      assert.equal(attributes["stroke-width"], "2");
      assert.equal(attributes.fill, "none");
      assert.equal(attributes.stroke, "currentColor");
      assert.equal(attributes.color, "#000000");
      assert.equal(attributes["stroke-linecap"], "round");
      assert.equal(attributes["stroke-linejoin"], "round");
      svg = attributes;
    } else {
      if (element.name === "path") assert(attributes.d?.trim(), "Empty SVG path");
      if (element.name === "circle") {
        for (const name of ["cx", "cy", "r"]) {
          assert(
            attributes[name]?.trim() && Number.isFinite(Number(attributes[name])),
            "Invalid circle",
          );
        }
        assert(Number(attributes.r) > 0, "Invalid circle radius");
      }
      if (attributes["fill-rule"]) assert.equal(attributes["fill-rule"], "evenodd");
      nodes.push([element.name, attributes]);
    }
    depth++;
  });
  parser.on("closetag", () => {
    depth--;
  });
  parser.write(source).close();
  assert(svg && nodes.length && depth === 0, "Incomplete SVG");
  return nodes;
}

export async function catalog(directory = new URL("../icons/", import.meta.url)) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".svg")).sort();
  assert.equal(files.length, 25, "Expected exactly 25 original SVGs");
  return Promise.all(
    files.map(async (file, index) => {
      assert(file.startsWith(`${String(index + 1).padStart(2, "0")}-`), "Invalid icon numbering");
      const source = await readFile(new URL(file, directory), "utf8");
      const slug = file.replace(/^\d+-|\.svg$/g, "");
      return {
        file,
        slug,
        name: slug
          .split("-")
          .map((word) => word[0].toUpperCase() + word.slice(1))
          .join(""),
        source,
        nodes: parseSvg(source),
        hash: createHash("sha256").update(source).digest("hex"),
      };
    }),
  );
}

export function escapeXml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}

export function shapes(nodes) {
  return nodes
    .map(
      ([tag, attributes]) =>
        `<${tag} ${Object.entries(attributes)
          .map(([name, value]) => `${name}="${escapeXml(value)}"`)
          .join(" ")}/>`,
    )
    .join("");
}

export function assetSvg(icon, defaults) {
  return `<svg xmlns="${namespace}" width="${defaults.size}" height="${defaults.size}" viewBox="0 0 64 64" color="${escapeXml(defaults.color)}" fill="none" stroke="currentColor" stroke-width="${strokeWidthFor({}, defaults)}" stroke-linecap="round" stroke-linejoin="round">${shapes(icon.nodes)}</svg>`;
}

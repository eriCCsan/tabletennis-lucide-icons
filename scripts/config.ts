import { readFile } from "node:fs/promises";
import type { IconDefaults } from "../src/core.ts";

export interface IconsConfig {
  defaults: IconDefaults;
  sheet: { iconSize: number; strokeWidth: number; color: string; background: string };
  example: { theme: "light" | "dark" };
}

function invalid(field: string, expected: string): never {
  throw new Error(`icons.config.json: ${field} ${expected}`);
}

function object(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(field, "must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) invalid(`${field}.${key}`, "is not a supported field");
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) invalid(`${field}.${key}`, "is required");
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, field: string, positive: boolean): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) {
    invalid(field, `must be a finite ${positive ? "positive" : "non-negative"} number`);
  }
  return value;
}

function color(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || /[<>&"']|\p{Cc}|url\s*\(/iu.test(value)) {
    invalid(field, "must be a non-empty color string without XML or external resources");
  }
  return value.trim();
}

export function validateConfig(value: unknown): IconsConfig {
  const root = object(value, "config", ["defaults", "sheet", "example"]);
  const defaults = object(root.defaults, "defaults", [
    "size",
    "color",
    "strokeWidth",
    "absoluteStrokeWidth",
  ]);
  const sheet = object(root.sheet, "sheet", ["iconSize", "strokeWidth", "color", "background"]);
  const example = object(root.example, "example", ["theme"]);
  if (typeof defaults.absoluteStrokeWidth !== "boolean") {
    invalid("defaults.absoluteStrokeWidth", "must be a boolean");
  }
  if (example.theme !== "light" && example.theme !== "dark") {
    invalid("example.theme", 'must be "light" or "dark"');
  }
  return {
    defaults: {
      size: number(defaults.size, "defaults.size", true),
      color: color(defaults.color, "defaults.color"),
      strokeWidth: number(defaults.strokeWidth, "defaults.strokeWidth", false),
      absoluteStrokeWidth: defaults.absoluteStrokeWidth,
    },
    sheet: {
      iconSize: number(sheet.iconSize, "sheet.iconSize", true),
      strokeWidth: number(sheet.strokeWidth, "sheet.strokeWidth", false),
      color: color(sheet.color, "sheet.color"),
      background: color(sheet.background, "sheet.background"),
    },
    example: { theme: example.theme },
  };
}

export async function loadConfig(
  file: URL = new URL("../icons.config.json", import.meta.url),
): Promise<IconsConfig> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`icons.config.json: cannot read valid JSON from ${file.pathname}`, {
      cause: error,
    });
  }
  return validateConfig(value);
}

export interface IconOptions {
  size?: number | string;
  color?: string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  nonScalingStroke?: boolean;
}

export interface IconDefaults {
  size: number;
  color: string;
  strokeWidth: number;
  absoluteStrokeWidth: boolean;
}

export type IconNode = readonly (readonly ["path" | "circle", Readonly<Record<string, string>>])[];

export function strokeWidthFor(options: IconOptions, defaults: IconDefaults): number {
  const {
    size = defaults.size,
    strokeWidth = defaults.strokeWidth,
    absoluteStrokeWidth = defaults.absoluteStrokeWidth,
    nonScalingStroke = false,
  } = options;
  const width = Number(strokeWidth);
  if (!Number.isFinite(width) || width < 0) {
    throw new RangeError("strokeWidth must be a finite, non-negative number");
  }
  if (nonScalingStroke) return width;
  if (absoluteStrokeWidth && (!Number.isFinite(Number(size)) || Number(size) <= 0)) {
    throw new RangeError("absoluteStrokeWidth requires a positive numeric size");
  }
  return (width * 64) / (absoluteStrokeWidth ? Number(size) : 24);
}

export function camelAttribute(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function svgAttribute(name: string): string {
  if (name === "className") return "class";
  if (name === "viewBox" || name.startsWith("aria-") || name.startsWith("data-")) {
    return name;
  }
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

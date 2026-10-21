import { createElement, createRef } from "react";
import { PlatformColor } from "react-native";
import type { Svg } from "react-native-svg";
import { loadConfig } from "../scripts/config.ts";
import { createIcon as reactIcon } from "../src/react.ts";
import { createIcon as nativeIcon } from "../src/react-native.ts";
import { createIcon as vanillaIcon } from "../src/vanilla.ts";

const nodes = [["circle", { cx: "32", cy: "32", r: "10" }]] as const;
const { defaults } = await loadConfig();
const ReactIcon = reactIcon("Example", nodes, defaults);
const NativeIcon = nativeIcon("Example", nodes, defaults);
const VanillaIcon = vanillaIcon("Example", nodes, defaults);
createElement(ReactIcon, {
  size: 24,
  color: "red",
  strokeWidth: 2,
  absoluteStrokeWidth: true,
  nonScalingStroke: true,
  ref: createRef<SVGSVGElement>(),
  className: "icon",
  "aria-label": "Example",
  onClick: (event) => event.currentTarget.focus(),
});
createElement(NativeIcon, {
  color: PlatformColor("labelColor"),
  size: 48,
  ref: createRef<Svg>(),
  accessibilityLabel: "Example",
  testID: "icon",
  onPress: (event) => event.preventDefault(),
});
const svg: SVGSVGElement = VanillaIcon({ size: 24, className: "icon", "aria-label": "Example" });
void svg;
// @ts-expect-error Icons reject object-valued sizes.
createElement(ReactIcon, { size: {} });
// @ts-expect-error Native refs must point to a native Svg instance.
createElement(NativeIcon, { ref: createRef<HTMLElement>() });
// @ts-expect-error Vanilla takes attributes, not event handler callbacks.
VanillaIcon({ onClick: () => {} });

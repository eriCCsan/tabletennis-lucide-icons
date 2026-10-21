import type { ForwardRefExoticComponent, RefAttributes } from "react";
import { createElement, forwardRef } from "react";
import type { SvgProps } from "react-native-svg";
import { Circle, Path, Svg } from "react-native-svg";
import {
  camelAttribute,
  type IconDefaults,
  type IconNode,
  type IconOptions,
  strokeWidthFor,
} from "./core.ts";

export type IconProps = Omit<SvgProps, keyof IconOptions> &
  Omit<IconOptions, "color"> &
  Pick<SvgProps, "color">;
export type IconComponent = ForwardRefExoticComponent<IconProps & RefAttributes<Svg>>;

export function createIcon(name: string, nodes: IconNode, defaults: IconDefaults): IconComponent {
  const Icon = forwardRef<Svg, IconProps>(function Icon(
    {
      size = defaults.size,
      color = defaults.color,
      strokeWidth = defaults.strokeWidth,
      absoluteStrokeWidth = defaults.absoluteStrokeWidth,
      nonScalingStroke = false,
      children,
      ...props
    },
    ref,
  ) {
    return createElement(
      Svg,
      {
        width: size,
        height: size,
        viewBox: "0 0 64 64",
        fill: "none",
        color,
        stroke: color,
        strokeWidth: strokeWidthFor(
          { size, strokeWidth, absoluteStrokeWidth, nonScalingStroke },
          defaults,
        ),
        strokeLinecap: "round",
        strokeLinejoin: "round",
        ...props,
        ref,
      },
      ...nodes.map(([tag, attributes], key) =>
        createElement(tag === "path" ? Path : Circle, {
          ...(nonScalingStroke ? { vectorEffect: "non-scaling-stroke" } : {}),
          ...Object.fromEntries(
            Object.entries(attributes).map(([attribute, value]) => [
              camelAttribute(attribute),
              value === "currentColor" ? color : value,
            ]),
          ),
          key,
        }),
      ),
      children,
    );
  });
  Icon.displayName = name;
  return Icon;
}

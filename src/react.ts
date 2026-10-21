import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";
import { createElement, forwardRef } from "react";
import {
  camelAttribute,
  type IconDefaults,
  type IconNode,
  type IconOptions,
  strokeWidthFor,
} from "./core.ts";

export type IconProps = Omit<SVGProps<SVGSVGElement>, keyof IconOptions> & IconOptions;
export type IconComponent = ForwardRefExoticComponent<
  Omit<IconProps, "ref"> & RefAttributes<SVGSVGElement>
>;

export function createIcon(name: string, nodes: IconNode, defaults: IconDefaults): IconComponent {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
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
    const labeled = props["aria-label"] || props["aria-labelledby"] || props.role;
    return createElement(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        width: size,
        height: size,
        viewBox: "0 0 64 64",
        fill: "none",
        color,
        stroke: "currentColor",
        strokeWidth: strokeWidthFor(
          { size, strokeWidth, absoluteStrokeWidth, nonScalingStroke },
          defaults,
        ),
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": labeled || children ? undefined : true,
        ...props,
        ref,
      },
      ...nodes.map(([tag, attributes], key) =>
        createElement(tag, {
          ...(nonScalingStroke ? { vectorEffect: "non-scaling-stroke" } : {}),
          ...Object.fromEntries(
            Object.entries(attributes).map(([attribute, value]) => [
              camelAttribute(attribute),
              value,
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

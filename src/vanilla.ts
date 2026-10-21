import {
  type IconDefaults,
  type IconNode,
  type IconOptions,
  strokeWidthFor,
  svgAttribute,
} from "./core.ts";

export interface IconProps extends IconOptions {
  [attribute: string]: string | number | boolean | undefined;
}

export type IconFunction = (props?: IconProps) => SVGSVGElement;

export function createIcon(_name: string, nodes: IconNode, defaults: IconDefaults): IconFunction {
  return function icon({
    size = defaults.size,
    color = defaults.color,
    strokeWidth = defaults.strokeWidth,
    absoluteStrokeWidth = defaults.absoluteStrokeWidth,
    nonScalingStroke = false,
    ...props
  }: IconProps = {}): SVGSVGElement {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(namespace, "svg");
    const attributes: Record<string, string | number | boolean | undefined> = {
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
      "aria-hidden":
        props["aria-label"] || props["aria-labelledby"] || props.role ? undefined : true,
      ...props,
    };
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== undefined) svg.setAttribute(svgAttribute(name), String(value));
    }
    for (const [tag, attributes] of nodes) {
      const element = document.createElementNS(namespace, tag);
      if (nonScalingStroke) element.setAttribute("vector-effect", "non-scaling-stroke");
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      svg.append(element);
    }
    return svg;
  };
}

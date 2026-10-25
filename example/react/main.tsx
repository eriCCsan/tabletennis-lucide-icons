import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { IconProps } from "tabletennis-lucide-icons/react";
import * as icons from "tabletennis-lucide-icons/react";
import config from "../../icons.config.json";
import "../style.css";

function App() {
  const [size, setSize] = useState(config.defaults.size);
  const [color, setColor] = useState(config.defaults.color);
  const [strokeWidth, setStrokeWidth] = useState(config.defaults.strokeWidth);
  const [theme, setTheme] = useState(config.example.theme);
  const firstIcon = useRef<SVGSVGElement>(null);
  const props: IconProps = { size, color: "currentColor", strokeWidth, className: "icon" };

  return (
    <div data-background={theme}>
      <main>
        <h1>Table-tennis icons · React</h1>
        <form onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="size">
            Size
            <input
              id="size"
              type="range"
              min={Math.min(16, size)}
              max={Math.max(96, size)}
              step="any"
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
            />
            <output htmlFor="size">{size}</output>
          </label>
          <label htmlFor="color">
            Color
            <input
              id="color"
              type="text"
              value={color}
              onChange={(event) => {
                const value = event.target.value;
                event.target.setCustomValidity(
                  CSS.supports("color", value) ? "" : "Enter a CSS color or currentColor.",
                );
                setColor(value);
              }}
            />
          </label>
          <label htmlFor="stroke">
            Stroke
            <input
              id="stroke"
              type="range"
              min="0"
              max={Math.max(4, strokeWidth)}
              step="any"
              value={strokeWidth}
              onChange={(event) => setStrokeWidth(Number(event.target.value))}
            />
            <output htmlFor="stroke">{strokeWidth}</output>
          </label>
          <label htmlFor="background">
            Background
            <select
              id="background"
              value={theme}
              onChange={(event) => setTheme(event.target.value)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </form>
        <p>Adjust the controls to inspect icon outlines and filled details.</p>
        <div id="icons" style={{ color }}>
          {Object.entries(icons).map(([name, Icon], index) => (
            <figure key={name}>
              <Icon {...props} ref={index === 0 ? firstIcon : undefined} />
              <figcaption>{name}</figcaption>
            </figure>
          ))}
        </div>
      </main>
    </div>
  );
}

const element = document.getElementById("root");
if (!element) throw new Error("Missing React root element");
createRoot(element).render(<App />);

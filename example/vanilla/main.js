import * as icons from "/dist/vanilla/index.js";

const controls = document.querySelector("#controls");
const gallery = document.querySelector("#icons");

function render() {
  const size = Number(controls.querySelector("#size").value);
  const strokeWidth = Number(controls.querySelector("#stroke").value);
  const color = controls.querySelector("#color").value;
  const colorInput = controls.querySelector("#color");
  colorInput.setCustomValidity(
    CSS.supports("color", color) ? "" : "Enter a CSS color or currentColor.",
  );
  if (!colorInput.reportValidity()) return;
  const absoluteStrokeWidth = controls.querySelector("#absolute").checked;
  document.body.dataset.background = controls.querySelector("#background").value;
  controls.querySelector('output[for="size"]').value = size;
  controls.querySelector('output[for="stroke"]').value = strokeWidth;
  gallery.replaceChildren();
  for (const [name, icon] of Object.entries(icons)) {
    const card = document.createElement("figure");
    const caption = document.createElement("figcaption");
    caption.textContent = name;
    card.append(icon({ size, color, strokeWidth, absoluteStrokeWidth }), caption);
    gallery.append(card);
  }
}

try {
  const response = await fetch("/icons.config.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot load icons.config.json (${response.status})`);
  const { defaults, example } = await response.json();
  if (!CSS.supports("color", defaults.color)) {
    throw new Error("icons.config.json: defaults.color must be a valid CSS color");
  }
  const sizeInput = controls.querySelector("#size");
  sizeInput.min = Math.min(Number(sizeInput.min), defaults.size);
  sizeInput.max = Math.max(Number(sizeInput.max), defaults.size);
  sizeInput.value = defaults.size;
  const strokeInput = controls.querySelector("#stroke");
  strokeInput.max = Math.max(Number(strokeInput.max), defaults.strokeWidth);
  strokeInput.value = defaults.strokeWidth;
  controls.querySelector("#color").value = defaults.color;
  controls.querySelector("#absolute").checked = defaults.absoluteStrokeWidth;
  controls.querySelector("#background").value = example.theme;
  controls.addEventListener("input", render);
  controls.addEventListener("submit", (event) => event.preventDefault());
  render();
} catch (error) {
  document.querySelector("#status").textContent = `Example could not start: ${error.message}`;
}

# tabletennis-lucide-icons

Lucide-style table-tennis icons with a consistent, minimalist SVG design for modern web and mobile apps.
Use them with React, React Native or vanilla JavaScript, and make them yours with adjustable sizes, colors and strokes.

## Installation

### npm

```sh
npm install tabletennis-lucide-icons
```

### Local

Run `npm ci` and `npm run build` in this repository, then install the generated
`.tgz` from `artifacts/` in your app with `npm install <path-to-tarball>`.

## React

```tsx
import { Paddle } from "tabletennis-lucide-icons/react";

export function Equipment() {
  return <Paddle size={32} color="tomato" aria-label="Paddle" />;
}
```

React SVG props, children, `className` and refs are supported.

## React Native / Expo

Install `react-native-svg` alongside your application's React and React Native
dependencies. In Expo, use `npx expo install react-native-svg`.

```tsx
import { View } from "react-native";
import { Paddle } from "tabletennis-lucide-icons/react-native";

export function Equipment() {
  return (
    <View>
      <Paddle size={32} color="tomato" accessibilityLabel="Paddle" />
    </View>
  );
}
```

Native `SvgProps` and refs are supported. Prefer an explicit native color;
inheritance differs from browser CSS. Device rendering requires platform testing.

## Vanilla JavaScript

### DOM icons

```js
import { Paddle } from "tabletennis-lucide-icons/vanilla";

document.body.append(Paddle({ size: 32, color: "tomato", "aria-label": "Paddle" }));
```

Each function returns an `SVGSVGElement`. Pass SVG attributes or attach listeners
with `addEventListener`. No React dependency is required. Without a bundler, serve
the built ESM files and import from `dist/vanilla/index.js`.

### Individual SVGs

With a bundler that imports SVG files as asset URLs:

```js
import paddleUrl from "tabletennis-lucide-icons/icons/01-paddle.svg";

const image = new Image();
image.src = paddleUrl;
image.alt = "Paddle";
document.body.append(image);
```

Inline SVGs inherit `currentColor`; images loaded through `<img>` do not inherit
the containing page's color.

### Sprite

Copy the package's `sprite.svg` to your public asset directory:

```html
<svg width="24" height="24" role="img" aria-label="Paddle" style="color: tomato">
  <use href="/sprite.svg#paddle"></use>
</svg>
```

Symbol IDs use the SVG filename without its number or extension.

### Sheets

The package exports `tabletennis-lucide-icons/sheet.svg` and
`tabletennis-lucide-icons/sheet.png`: labeled previews of the available icons.
Import them as asset URLs with your bundler, or copy them to your public directory.

## Properties & Stroke Behavior

| Property | Default | Behavior |
| --- | --- | --- |
| `size` | `24` | Width and height; number or size string |
| `color` | `currentColor` | CSS color on the web; native color value on React Native |
| `strokeWidth` | `0.75` | Non-negative number or numeric string, measured at size 24 |
| `absoluteStrokeWidth` | `false` | Keep the visible stroke constant when numeric `size` changes |
| `nonScalingStroke` | `false` | Use SVG vector effects to keep stroke constant through scaling; overrides absolute mode |

`currentColor` inherits the surrounding text color in browsers. Existing filled
details are preserved and do not thicken with stroke width. Absolute mode requires
a positive numeric size; CSS dimensions or transforms can override its calculation.
Web icons without an accessible label are decorative.

## How to Add SVGs

Run all commands below from this repository's root. First run `npm ci`.

### SVG requirements

Use this exact outer SVG structure and replace the path with your artwork:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" color="#000000" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 32H48"/>
</svg>
```

- Draw in a **64 × 64** coordinate system; changing only `viewBox` does not resize artwork.
- Place shapes directly inside `<svg>`. Use at least one `<path>`; additional
  `<path>` and `<circle>` elements are supported. Convert other shapes and flatten
  groups/transforms before saving.
- Paths accept `d`, `fill`, `stroke` and `fill-rule="evenodd"`. Circles accept
  `cx`, `cy`, a positive `r`, `fill` and `stroke`.
- Shape colors must be `currentColor` or `none`. For filled details, use
  `fill="currentColor" stroke="none"`.
- Remove styles, IDs, editor metadata, XML declarations, comments, scripts,
  images, external references, masks and clipping paths.

Keep `stroke-width="2"` in the source template. The library's display default
of `0.75` is applied during generation, accounting for the viewBox.

### Add and verify the icon

1. **Save the file in `icons/`.** Use the next consecutive number, a hyphen and
   a lowercase hyphen-separated name: `NN-your-icon.svg`. Do not rename or edit
   existing SVGs. The generated export will be `YourIcon`.
2. **Update the expected file count.** In `scripts/catalog.mjs`, find
   `assert.equal(files.length, ...)`. Its second argument is the expected total
   number of SVG files, not an icon ID. Increase that number by one for each new
   file and update the number in its error message. This is only a completeness
   check; you do not register icons or add imports here.
3. **Get the generated name and checksum.** Run:

   ```sh
   node --input-type=module -e 'import { catalog } from "./scripts/catalog.mjs"; for (const { file, name, hash } of await catalog()) console.log(file, name, hash)'
   ```

   Find your file's output line. Append its `name` as a quoted string to the
   `names` array in `tests/helpers.mjs`, and its `hash` as a quoted string to the
   `hashes` array in `tests/source.test.mjs`. Keep the same numbered-file order
   and leave existing names/checksums unchanged.
4. **Update the tests that count icons.** In `tests/built.test.mjs` and
   `tests/examples.test.mjs`, increase the expected totals in SVG/card count
   assertions and `figure:nth-child(...)` selectors to the new file total.
   Do not change dimensions, colors or stroke expectations. In the sheet test in
   `tests/built.test.mjs`, make the expected height follow the number of rows:

   ```text
   const height = Math.ceil(icons.length / 5) * (config.sheet.iconSize + 64);
   ```

   Remove or update any fixed icon-count text in the two example pages as well.
5. **Check and build.** Run `npm run check`, then `npm run build`. Both must pass.
   The build creates the platform exports, SVG assets, sprite and sheets
   automatically; never edit `dist/` by hand.
6. **Inspect the result.** Start an example below, find `YourIcon`, and try
   different sizes, colors and strokes before committing your changes.

## Examples

Browser checks require Playwright Chromium
(`npx --no-install playwright install chromium`) or system Google Chrome.
Start either example from the repository root:

```sh
npm run example-react
npm run example-vanilla
```

The examples display the available icons and provide size, color, stroke and theme
controls. Each command builds missing or outdated library output before serving.

## Release

Review `icons.config.json` before building: `defaults` controls library props,
`sheet` controls preview rendering, and `example` controls the initial theme.
Explicit icon props override library defaults. Rebuild after configuration changes.

`npm run build` validates and creates a locally inspected package in `artifacts/`.
It does not publish. Release automation is not implemented.

## License

[Apache-2.0](./LICENSE).

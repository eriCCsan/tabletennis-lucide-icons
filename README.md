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

Run `npm ci` once in the repository root. Use this SVG template for your artwork:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" color="#000000" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 32H48"/>
</svg>
```

- Draw at **64 × 64** and keep the template's root attributes, including
  `stroke-width="2"`. The build applies the library's display stroke default.
- Put only `<path>` and `<circle>` shapes directly inside `<svg>`. Use
  `currentColor` or `none` for fills and strokes; filled details can use
  `fill="currentColor" stroke="none"`. Circles need `cx`, `cy` and a positive `r`;
  paths need `d` and may use `fill-rule="evenodd"`.
- Flatten groups and transforms. Remove styles, IDs, metadata, comments, XML
  declarations, images, scripts, external references, masks and clipping paths.

1. **Add one SVG to `icons/`.** Use the next consecutive number and a lowercase,
   hyphen-separated name: `NN-your-icon.svg`. Its export becomes `YourIcon`.
2. **Record its checksum.** For the newly appended icon, run:

   ```sh
   node --input-type=module -e 'import { catalog } from "./scripts/catalog.mjs"; console.log(JSON.stringify((await catalog()).at(-1).hash) + ",")'
   ```

   In `tests/source.test.mjs`, find `const hashes = [` and paste the output
   after the last checksum, before `];`. This protects the source artwork from
   accidental changes. Leave existing checksums unchanged.
3. **Run `npm run build`.** It runs all checks and generates the library, SVGs,
   sprite and sheets. Names, exports and examples update automatically.

Repeat these steps one SVG at a time when adding multiple icons.

## Examples

Start either example from the repository root to inspect icons at different sizes,
colors and strokes:

```sh
npm run example:react
npm run example:vanilla
```

Both include light/dark backgrounds and build missing or outdated library output.
Browser tests require Playwright Chromium
(`npx --no-install playwright install chromium`) or system Google Chrome.

## Release

Review `icons.config.json` before building: `defaults` controls library props,
`sheet` controls preview rendering, and `example` controls the initial theme.
Explicit icon props override library defaults. Rebuild after configuration changes.

`npm run build` validates and creates a locally inspected package in `artifacts/`;
it does not publish.

```sh
npm run release:dry-run
npm run release
```

Install GitHub CLI (`gh`) and use `gh auth login` and `npm login` first. Releases
require an interactive terminal, a clean `main` synchronized with `origin/main`,
npm publishing 2FA (`auth-and-writes`), and permission to push and publish. Missing
GitHub authentication can also be established through an explicitly approved browser
login during a release.

Conventional Commits determine the next version: `fix:` is a patch, `feat:` a minor,
and `!` or `BREAKING CHANGE` a major. The initial release retains the manifest
version. Commits without release-relevant changes do not create a new version.

Dry runs validate a temporary copy without publishing or changing Git references.
Missing remote/authentication checks are reported and cause a nonzero exit.
Real releases require explicit preparation and publication confirmations; npm
handles interactive 2FA/passkey approval. Review dependency security findings before
confirming. Local publishing does not generate CI provenance.

After a failure, fix the reported prerequisite and rerun `npm run release` to resume
the same version. Recovery metadata and the checked tarball remain under Git's
administrative directory. Do not delete that state, rewrite history or remove tags
to retry. Published artifacts are verified and never blindly republished; conflicting
state requires manual investigation. No automatic rollback is performed.

## License

[Apache-2.0](./LICENSE).

# tabletennis-lucide-icons

Minimal, customizable table-tennis SVG icons in the Lucide style for React, React Native and vanilla JavaScript.

## Installation

```sh
npm install tabletennis-lucide-icons
```

## React

```tsx
import { Paddle } from "tabletennis-lucide-icons/react";

export function Equipment() {
  return <Paddle size={32} color="tomato" />;
}
```

## React Native / Expo

Install `react-native-svg` in your React Native app; for Expo, use `npx expo install react-native-svg`.

```tsx
import { Paddle } from "tabletennis-lucide-icons/react-native";

export function Equipment() {
  return <Paddle size={32} color="tomato" />;
}
```

## Vanilla JavaScript

```js
import { Paddle } from "tabletennis-lucide-icons/vanilla";

document.body.append(Paddle({ size: 32, color: "tomato" }));
```

## Add Icons

Add consecutively numbered SVGs to `icons/`, then run:

```sh
npm run icons:add
```

Exports and examples update automatically. See [SVG requirements](https://github.com/eriCCsan/tabletennis-lucide-icons/blob/main/CONTRIBUTING.md#svg-requirements).

## Examples

```sh
npm run example:react
npm run example:vanilla
```

## Release

From a clean, synchronized `main`:

```sh
npm run release
```

Checks, versioning and publishing run locally, without GitHub Actions. Sign in with
`gh auth login` and `npm login`; npm may request 2FA approval.
[Setup and recovery](https://github.com/eriCCsan/tabletennis-lucide-icons/blob/main/CONTRIBUTING.md#releases).

## License

[Apache-2.0](LICENSE).

# Package compatibility

Pretable's public packages support current applications and older build systems
through package-name imports. The compatibility contract is intentionally about
published entry points, not files inside a package's `dist` directory.

## Module formats

All four public packages ship first-class ESM and CommonJS entry points:

```ts
import { createPretable } from "@pretable/core";
```

```js
const { createPretable } = require("@pretable/core");
```

The same package-name import contract applies to `@pretable/react`,
`@pretable/ui`, and `@pretable/stream-adapter`. Package JavaScript is emitted
with ES2018 syntax. Generic legacy resolvers can use `main`, `module`, the
CommonJS build, and package-root CSS exports without understanding every modern
conditional-export convention.

Webpack 4 is not installed in this repository and is not a tested, supported, or
certified integration. The compatibility harness instead tests the package
metadata paths used by older bundlers with modern Webpack while conditional
exports are disabled. This proves those published paths resolve; it does not
make a broader claim about Webpack 4 itself.

Import only documented package paths. Private paths such as
`@pretable/core/dist/index.mjs` are unsupported and may change in any release.

## React versions

`@pretable/react` supports matching React and ReactDOM 18 or 19 releases:

```sh
npm install @pretable/react @pretable/ui react@18 react-dom@18
```

```sh
npm install @pretable/react @pretable/ui react@19 react-dom@19
```

React 18.0.0 is the tested floor. React 17 and earlier are unsupported because
the adapter relies on React 18 APIs such as `useId` and
`useSyncExternalStore`.

## Runtime APIs

ES2018 describes the syntax level of the published JavaScript, not every runtime
API used by Pretable. Applications must provide these APIs natively or through
appropriate polyfills:

- `AbortController`
- `BigInt`
- `Object.fromEntries`
- `ResizeObserver`
- `cancelAnimationFrame`
- `queueMicrotask`
- `requestAnimationFrame`
- `structuredClone`

Browser-only APIs are needed when the associated rendering behavior runs, not
merely when a framework-neutral package is imported in Node.js. Pretable does
not bundle global polyfills because the application owns its browser and server
runtime targets.

## CSS imports

Import public CSS from the package root:

```css
@import "@pretable/ui/themes/pretable.css";
@import "@pretable/ui/grid.css";
```

These package-root paths are the stable contract. Importing CSS from `dist` is a
private deep import and is unsupported.

# @pretable/ui

CSS theme + a small JS helper for [pretable](https://pretable.dev/). Pair with [`@pretable/react`](../react) for the full surface, or use the JS helper standalone in non-React adapters.

## Install

```sh
npm install @pretable/ui
# or pnpm add @pretable/ui, yarn add @pretable/ui
```

## Minimal usage

Import the CSS once at the root of your app:

```ts
import "@pretable/ui/grid.css";
```

Optionally layer a theme:

```ts
import "@pretable/ui/themes/excel.css";
import "@pretable/ui/grid.css";
```

For tailwind users, swap `grid.css` for `tailwind.css` (both work; `tailwind.css` reads from your tailwind tokens).

## CSS API (v1 contract)

`@pretable/ui` ships five CSS entrypoints. Their selectors and CSS variables form the v1 styling contract — pretable's React components (`<Pretable>`, `<PretableSurface>`, `<InspectionGrid>`, `<LabeledGridSurface>`) emit the data attributes these stylesheets target.

### Entrypoints

- `@pretable/ui/grid.css` — the default styles. Imports `tokens.css`. Use this in a vanilla CSS or Sass setup.
- `@pretable/ui/tailwind.css` — same grid styles authored against tailwind tokens. Use this in a tailwind app.
- `@pretable/ui/tokens.css` — the CSS-variable definitions only. Imported by `grid.css` automatically; use directly only when you want tokens without grid styles.
- `@pretable/ui/themes/excel.css` — Excel-flavored theme. Layer on top of `grid.css`.
- `@pretable/ui/themes/material.css` — Material-flavored theme. Layer on top of `grid.css`.

### Density CSS variables

The two density-related variables `getDensityHeights()` reads:

| Variable                   | Default (in `tokens.css`) | Purpose            |
| -------------------------- | ------------------------- | ------------------ |
| `--pretable-row-height`    | `32px`                    | Body row height.   |
| `--pretable-header-height` | `36px`                    | Header row height. |

The full token set lives in [`src/tokens.css`](./src/tokens.css). Override any token at `:root` or on a scoped element to change the look.

### Data-attribute hooks

Pretable surfaces emit a stable set of data attributes on rendered DOM. The CSS files in this package target them; your custom styles can too. The full set lives in `grid.css` — common ones include `[data-pretable-cell]`, `[data-pretable-row]`, `[data-pretable-header]`, `[data-pretable-cell][data-pretable-focused="true"]`, `[data-pretable-cell][data-pretable-selected="true"]`, `[data-pretable-cell][data-pretable-pinned="left"]`, and `[data-pretable-cell][data-pretable-numeric="true"]`. Renaming or removing these attributes is a breaking change.

### Cascade layer

`grid.css` ships inside a single `@layer pretable` cascade layer, and every
selector is wrapped in `:where()` (specificity `(0,0,0)`). Consumer CSS wins by
layer order or specificity without `!important`. In a Tailwind v4 app declare:

```css
@layer theme, base, pretable, components, utilities;
```

Token files (`tokens.css`, `themes/*.css`) are intentionally **unlayered** —
override tokens after importing the theme. See the website's "Cascade &
overrides" theming page for the full contract.

## JS API

```ts
import { getDensityHeights } from "@pretable/ui";

const { rowHeight, headerHeight } = getDensityHeights();
```

`getDensityHeights()` is a synchronous snapshot of `--pretable-row-height` and `--pretable-header-height` on `document.documentElement`, with fallbacks of 32 / 36. SSR-safe (returns fallback values when `document` is undefined).

See **[`ui.api.md`](./ui.api.md)** for the generated public-API report.

## License

MIT — see [LICENSE](../../LICENSE).

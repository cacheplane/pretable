# @pretable/ui

CSS theme + a small JS helper for [pretable](https://pretable.ai/). Pair with [`@pretable/react`](../react) for the full surface, or use the JS helper standalone in non-React adapters.

## Install

```sh
npm install @pretable/ui
# or pnpm add @pretable/ui, yarn add @pretable/ui
```

## Minimal usage

Two imports at the root of your app — a theme, then `grid.css`:

```ts
import "@pretable/ui/themes/pretable.css";
import "@pretable/ui/grid.css";
```

`pretable.css` is the house theme and the default. Both imports are load-bearing: `grid.css` imports nothing and declares no token values of its own, so without a theme underneath it its colors, type, and spacing all resolve against variables no one has set.

Tailwind v4 users import the same two files, plus the opt-in bridge:

```css
@import "tailwindcss";
@import "@pretable/ui/themes/pretable.css";
@import "@pretable/ui/grid.css";
@import "@pretable/ui/tailwind.css";
```

`tailwind.css` is additive — it adds utility shortcuts for styling _your_ UI in the grid's palette. It is not a substitute for `grid.css`.

## CSS API (v1 contract)

`@pretable/ui` ships six CSS entrypoints. The `[data-pretable-*]` selectors `grid.css` targets and the 50 `--pretable-*` tokens the theme files define are the v1 styling contract — pretable's React components (`<Pretable>`, `<PretableSurface>`, `<LabeledGridSurface>`) emit the data attributes these stylesheets target.

### Entrypoints

Nothing here imports anything else; you compose them yourself, in this order.

- `@pretable/ui/grid.css` — the grid rules, and the only file in the package that styles a grid element. Its selectors target the `[data-pretable-*]` attributes; every themeable value reads a `--pretable-*` token, so it needs a theme underneath it. Ships inside the `pretable` cascade layer.
- `@pretable/ui/themes/pretable.css` — the house theme, and the default. Defines all 50 tokens at `:root`, with dark-mode and per-density-tier overrides.
- `@pretable/ui/themes/excel.css` — Excel compatibility skin. Same 50 tokens; light only, with density tiers.
- `@pretable/ui/themes/material.css` — Material compatibility skin. Same 50 tokens, with dark mode and density tiers.
- `@pretable/ui/tailwind.css` — opt-in Tailwind v4 bridge: an `@theme inline` block that re-exports 17 of the 50 tokens as `--color-pt-*` / `--font-pt-*` utility shortcuts (`bg-pt-bg-grid`, `text-pt-accent`, `font-pt-mono`). It contains **no grid rules** — importing it instead of `grid.css` leaves the grid unstyled.
- `@pretable/ui/tokens.css` — **not part of the grid contract.** A legacy `--pt-*` palette that predates this package's `--pretable-*` namespace; it defines no `--pretable-*` token and styles no grid element. Only pretable's own website consumes it. Consumer apps want a theme file, not this.

Pick exactly one theme file. The theme files are unlayered and all declare at `:root`, so loading two resolves by source order token by token — and the two do not necessarily ship the same blocks (Excel has no dark mode), so the result is not "the second theme" either.

### Density CSS variables

The two variables `getDensityHeights` reads:

| Variable                   | Purpose            | JS fallback |
| -------------------------- | ------------------ | ----------- |
| `--pretable-row-height`    | Body row height.   | `32px`      |
| `--pretable-header-height` | Header row height. | `36px`      |

The fallbacks are hard-coded in [`src/density.ts`](./src/density.ts) and apply only when a variable is unset or is not a `<number>px` value — they are not a theme's values. Every shipped theme sets both at every density tier: `pretable` is `48px` / `52px` at standard, Excel `20px` / `24px` at its compact default.

`@pretable/react` reads a third token in JS, `--pretable-group-panel-height`, and only while the drag-to-group panel is enabled. `getDensityHeights` does not cover it; the remaining 47 tokens never enter JavaScript at all.

The full 50-token set is defined by the theme files in [`src/themes/`](./src/themes/); the [token reference](https://pretable.ai/docs/theming/token-reference) lists every name with its per-theme value. Override any token at `:root` or on a scoped element to change the look.

### Data-attribute hooks

Pretable surfaces emit a stable set of data attributes on rendered DOM. The CSS files in this package target them; your custom styles can too. The full set lives in `grid.css` — common ones include `[data-pretable-cell]`, `[data-pretable-row]`, `[data-pretable-header-cell]`, `[data-pretable-cell][data-pretable-focused="true"]`, `[data-pretable-cell][data-pretable-selected="true"]`, `[data-pretable-cell][data-pretable-pinned="left"]`, `[data-pretable-cell][data-pretable-column-type="number"]`, and `[data-pretable-cell][data-pretable-column-align="end"]`. Renaming or removing these attributes is a breaking change.

`data-pretable-column-align` is omitted entirely for start-aligned columns — the default — and only written when a column resolves to `"end"` or `"center"`, or sets `align: "start"` explicitly. So style the start case off the attribute's _absence_ (`[data-pretable-cell]:not([data-pretable-column-align])`); a `[data-pretable-column-align="start"]` rule silently misses every column that is start-aligned by default.

### Cascade layer

`grid.css` ships inside a single `@layer pretable` cascade layer, and every
selector is wrapped in `:where()` (specificity `(0,0,0)`). Consumer CSS wins by
layer order or specificity without `!important`. In a Tailwind v4 app declare:

```css
@layer theme, base, pretable, components, utilities;
```

Theme files (`themes/*.css`) are intentionally **unlayered** — override tokens
after importing the theme. See the website's "Cascade & overrides" theming page
for the full contract.

## JS API

```ts
import { getDensityHeights } from "@pretable/ui";

// Reads the document root.
const { rowHeight, headerHeight } = getDensityHeights();

// Reads whatever `element` paints under.
const scoped = getDensityHeights(element);
```

`getDensityHeights(element?: Element | null): DensityHeights` is a synchronous
snapshot of `--pretable-row-height` and `--pretable-header-height`, with
fallbacks of 32 / 36.

The tokens are inherited custom properties, so the element you pass decides the
answer: it resolves the values that element actually paints under, which is what
a `data-density` scoped to a wrapper sets — the root's own computed style never
sees it. Pass nothing and it reads `document.documentElement`, which is right
when the attribute lives on `<html>`. `@pretable/react` passes the grid's scroll
viewport, so a wrapper-scoped grid measures at the density it paints at. A
detached element resolves nothing in most browsers; read after mount.

SSR-safe (returns fallback values when `document` is undefined).

See **[`ui.api.md`](./ui.api.md)** for the generated public-API report.

## License

MIT — see [LICENSE](../../LICENSE).

# @pretable/ui

Public theming for the Pretable React grid. Two prebuilt themes (Excel default, Material 3 light + dark), runtime-switchable density (compact / standard / spacious), and an opt-in Tailwind v4 bridge.

> **Status: 0.0.1 — pre-1.0 experimental.** Token names may rename or remove in any patch release. Override at your own risk. See [the design spec](../../docs/superpowers/specs/2026-05-01-pretable-theming-architecture-design.md) for the full architecture.

## Install

```bash
npm install @pretable/ui
```

This package has no peer dependencies; it ships pure CSS plus one tiny TypeScript helper.

## Themes

Two prebuilt themes ship in this package:

- **Excel** (`@pretable/ui/themes/excel.css`) — gray, technical, dense. Aptos Narrow at 11pt, Excel-green active-cell border, no row hover. Light-only by design. Default density: compact.
- **Material 3** (`@pretable/ui/themes/material.css`) — M3 baseline scheme (seed `#6750A4`). Light at `:root`; dark at `[data-theme="dark"]`. Default density: standard.

## Recipes

### Vanilla CSS, drop-in (Excel default)

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";
```

```tsx
import { PretableGrid } from "@pretable/react";

<PretableGrid rows={rows} columns={columns} />;
```

### Override individual tokens

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";

:root {
  --pretable-accent: #ff5722;
  --pretable-rule: #cccccc;
}
```

Cascade specificity: consumer overrides at `:root` land at the same level as the theme's `:root`, but the consumer's stylesheet imports later — last write wins.

### Material with runtime light/dark switching

```css
@import "@pretable/ui/themes/material.css";
@import "@pretable/ui/grid.css";
```

```tsx
function App() {
  const [mode, setMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    document.documentElement.dataset.theme = mode === "dark" ? "dark" : "";
  }, [mode]);
  // ...
}
```

OS-respect variant: derive `mode` from `matchMedia('(prefers-color-scheme: dark)')`.

### Runtime density switching

```tsx
function DensityPicker() {
  const setDensity = (mode: "compact" | "standard" | "spacious") => {
    document.documentElement.dataset.density = mode;
  };
  return (
    <div role="radiogroup" aria-label="Row density">
      <button onClick={() => setDensity("compact")}>Compact</button>
      <button onClick={() => setDensity("standard")}>Standard</button>
      <button onClick={() => setDensity("spacious")}>Spacious</button>
    </div>
  );
}
```

The grid auto-updates row positioning when the attribute changes (via `@pretable/react`'s built-in `useResolvedHeights` hook). Composes with `data-theme="dark"` independently.

### Tailwind v4

```css
@import "tailwindcss";
@import "@pretable/ui/themes/material.css";
@import "@pretable/ui/grid.css";
@import "@pretable/ui/tailwind.css";
```

```tsx
<aside className="bg-pt-bg-toolbar text-pt-text-dim p-4 border-b border-pt-rule">
  <p className="font-pt-mono text-pt-accent">Filter active</p>
</aside>
```

### CSS-in-JS

```tsx
const Toolbar = styled.div`
  background: var(--pretable-bg-toolbar);
  color: var(--pretable-text-dim);
  border-bottom: 1px solid var(--pretable-rule);
`;
```

CSS custom properties work in any CSS-emitting tool because they're a runtime feature.

### Read density values in JS (tests, custom virtualizers, vanilla JS)

```ts
import { getDensityHeights } from "@pretable/ui";

const { rowHeight, headerHeight } = getDensityHeights();
const visibleRows = Math.floor(viewportHeight / rowHeight);
```

`getDensityHeights()` is a synchronous snapshot. SSR-safe (returns fallback values when `document` is undefined). For React consumers, the reactive `useResolvedHeights` hook in `@pretable/react` is preferable — it subscribes to attribute changes and re-renders.

## Token contract (24 tokens)

All tokens are `--pretable-*` prefixed.

| Group | Tokens |
|---|---|
| Surfaces | `bg-grid`, `bg-grid-alt`, `bg-header`, `bg-toolbar`, `bg-tooltip` |
| Text | `text-cell`, `text-header`, `text-dim` |
| Lines | `rule`, `rule-strong`, `radius` |
| State | `bg-hover`, `bg-selected`, `text-selected`, `focus-ring` |
| Accent | `accent` |
| Density | `row-height`, `header-height`, `cell-padding-x`, `cell-padding-y`, `font-size-cell`, `font-size-header` |
| Typography | `font-sans`, `font-mono` |

The engine reads `--pretable-row-height` and `--pretable-header-height` directly from CSS at JS time. The other 22 tokens are CSS-only.

## Visual regression

Visual regression testing is deferred. The token contract smoke test catches missing tokens, unresolved `var()` references, and non-px density tiers. It does NOT catch tokens resolving to wrong values or unintended visual differences. When we onboard a non-internal consumer or otherwise need stronger guarantees, we add a Playwright reference scene rendering a 10-row × 5-column grid in each (theme × density × mode) combination.

## License

See repository root.

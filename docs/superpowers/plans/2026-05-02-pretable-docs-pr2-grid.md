# Pretable Docs PR 2: Grid Section + PR 1 Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Grid section (5 pages) documenting the actual public surface of `@pretable/react`: the `<Pretable>` drop-in component, the `usePretable` / `usePretableModel` hooks for custom rendering, and the `[data-pretable-*]` attribute contract. Plus fix three references to a non-existent `<PretableGrid>` component in PR 1's pages.

**Architecture:** Pure content authoring + a small cleanup. 5 new MDX files in `apps/website/app/docs/grid/`, plus extension of `_nav.ts` (add Grid section with 5 entries), plus edits to 3 existing PR 1 files (rename `<PretableGrid>` → `<Pretable>`, remove a fictional prop-override example). All content uses existing `<CodeBlock>` MDX component for code highlighting; markdown blockquotes for callouts; no new components.

**Tech Stack:** Next.js 16 app router, `@next/mdx`, shiki via existing `<CodeBlock>` server component. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-02-pretable-docs-architecture-design.md](../specs/2026-05-02-pretable-docs-architecture-design.md) — see "Per-page content outlines" Grid section.

**Starting state:** Clean working tree on branch `feat/docs-grid` based on `origin/main` at `519ef1b` or later (after Docs PR 1 #60 merged). Worktree at `/Users/blove/repos/pretable/.worktrees/docs-grid`. Baseline: `pnpm --filter @pretable/app-website test` passes 51/51.

---

## File structure

**Files CREATED (5 new MDX pages):**

- `apps/website/app/docs/grid/page.mdx` — Grid Overview (concept page covering the two consumer paths + data-attribute contract)
- `apps/website/app/docs/grid/pretable-component/page.mdx` — `<Pretable>` drop-in component (recipe)
- `apps/website/app/docs/grid/custom-rendering/page.mdx` — Custom rendering with `usePretableModel` (recipe)
- `apps/website/app/docs/grid/density-helpers/page.mdx` — `useResolvedHeights` and `getDensityHeights` (reference)
- `apps/website/app/docs/grid/api-reference/page.mdx` — PretableGrid model methods + type reference (reference)

**Files MODIFIED:**

- `apps/website/app/docs/_nav.ts` — extend from 2 sections (Getting Started, Theming) to 3 (add Grid with 5 entries)
- `apps/website/app/docs/page.mdx` — refresh "Coming soon" section: remove Grid from the deferred list (move it to documented), keep Streaming/API Reference/Examples deferred
- `apps/website/app/docs/theming/density/page.mdx` — remove the fictional `<PretableGrid rowHeight={56} headerHeight={64} />` example and the surrounding "pass props to override" paragraph; the engine bridge runs via `useResolvedHeights` with no consumer-facing prop
- `apps/website/app/docs/theming/light-dark/page.mdx` — change one in-prose reference from `<PretableGrid>` to `<Pretable>`

---

## Decisions baked in

- **`<Pretable>` is the only public component.** `<PretableSurface>` lives at `@pretable-internal/react-surface` (private package, `"private": true`). It is not re-exported from `@pretable/react`. The bench and website's playground import it via the internal path; external consumers do not have access.
- **`usePretable` and `usePretableModel` are the public escape hatch.** Consumers who need sort/filter/selection/focus use the hooks to drive their own rendering, applying `[data-pretable-*]` data attributes so `@pretable/ui/grid.css` styles the result correctly.
- **Custom-rendering example is minimal but correct.** The Custom rendering page shows ~50 lines of code that handle viewport, header, body, and a click-to-select pattern. It does NOT cover virtualization fine details (scroll-position dispatch, pinned columns, focus keyboard nav) — those are deferred to "see `packages/react-surface/src/pretable-surface.tsx` for the full reference implementation." Honest about pre-1.0 doc scope.
- **No new MDX components.** Markdown blockquotes for "API in flux" callouts. Plain markdown tables for type/method references. Existing `<CodeBlock>` for syntax-highlighted code.
- **PR 1 cleanup is bundled into PR 2.** The fictional `<PretableGrid>` references mislead consumers. Fixing them requires the Grid section to exist (so we have a place to redirect readers). PR 2 does both.
- **Density-helpers page is reference-only.** The recipe-style usage (when to wire which) was already covered in `theming/density/page.mdx`. This page documents the API surfaces objectively: signatures, return types, fallback values, SSR behavior.
- **Voice and prettier discipline match PR 1.** Third-person conversational, code-first recipes, prettier `--write` before every commit.

---

## Task 1: PR 1 cleanup — fix `<PretableGrid>` references

**Files:**

- Modify: `apps/website/app/docs/page.mdx`
- Modify: `apps/website/app/docs/theming/density/page.mdx`
- Modify: `apps/website/app/docs/theming/light-dark/page.mdx`

- [ ] **Step 1: Fix `apps/website/app/docs/page.mdx`.**

The "Coming soon" section currently says `**API Reference** — `PretableGrid` props, column types, theme token contract, density helpers.` That mentions a component name that doesn't exist. Use the Edit tool:

- old_string: `- **API Reference** — \`PretableGrid\` props, column types, theme token contract, density helpers.`
- new_string: `- **API Reference** — \`Pretable\` component props, hook signatures, type contract.`

Also: the Grid section is no longer "Coming soon" after this PR. Remove it from the deferred list. Use the Edit tool again:

- old_string:

  ```
  ### Coming soon

  The rest of the docs surface lands in subsequent releases:

  - **Grid** — the engine API: columns, rows, selection, focus, sort, filter, density helpers.
  - **Streaming** — transactions API and JSON streaming.
  - **API Reference** — `Pretable` component props, hook signatures, type contract.
  - **Examples** — live, copy-pasteable patterns: basic table, light/dark switcher, density picker.
  ```

- new_string:

  ```
  ### Grid

  [Grid](/docs/grid) covers the engine API: the `<Pretable>` drop-in component, the `usePretable` / `usePretableModel` hooks for custom rendering, the `[data-pretable-*]` attribute contract, density helpers, and the full type reference.

  ### Coming soon

  The rest of the docs surface lands in subsequent releases:

  - **Streaming** — transactions API and JSON streaming.
  - **API Reference** — consolidated reference (currently per-section in Theming and Grid).
  - **Examples** — live, copy-pasteable patterns: basic table, light/dark switcher, density picker.
  ```

- [ ] **Step 2: Fix `apps/website/app/docs/theming/density/page.mdx`.**

The current page has a fictional prop-override example. Remove it. Use the Edit tool:

- old_string:

  ````
  The engine reads these via the `useResolvedHeights` hook (in `@pretable/react`), which subscribes to attribute changes on `<html>` via `MutationObserver`. When you flip `data-density`, the engine re-renders the grid with new heights automatically — no need to pass `rowHeight` or `headerHeight` props from your component.

  If you want to override the heights at the component level (e.g., a single grid uses spacious while the rest of the app respects user preference), pass props:

  ```tsx
  <PretableGrid rows={rows} columns={columns} rowHeight={56} headerHeight={64} />
  ````

  Numeric props win over CSS-resolved values. See [Density helpers](/docs/grid/density-helpers) for the full hook API (lands in PR 2 of the docs).

  ```

  ```

- new_string:

  ```
  The engine reads these via the `useResolvedHeights` hook (in `@pretable/react`), which subscribes to attribute changes on `<html>` via `MutationObserver`. When you flip `data-density`, the engine re-renders the grid with new heights automatically.

  See [Density helpers](/docs/grid/density-helpers) for the full hook API.
  ```

(Removes the fictional `<PretableGrid>` example and the "pass props" claim. The hook does accept optional numeric overrides as arguments — `useResolvedHeights(36, 40)` — but that's a JS-side override, not a component prop. The Density helpers page documents the actual signature.)

- [ ] **Step 3: Fix `apps/website/app/docs/theming/light-dark/page.mdx`.**

The page has one in-prose `<PretableGrid>` reference. Use the Edit tool:

- old_string: `Wrap your app with this provider. Anywhere a \`<PretableGrid>\` renders inside, the grid responds to the mode change automatically.`
- new_string: `Wrap your app with this provider. Anywhere a \`<Pretable>\` renders inside, the grid responds to the mode change automatically.`

- [ ] **Step 4: Verify build.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -5
```

Expected: build succeeds. The `/docs/grid/density-helpers` link is a forward-reference but Next.js doesn't validate href targets at build time.

- [ ] **Step 5: Run prettier on the modified files.**

```bash
pnpm exec prettier --write apps/website/app/docs/page.mdx apps/website/app/docs/theming/density/page.mdx apps/website/app/docs/theming/light-dark/page.mdx
```

- [ ] **Step 6: Commit.**

```bash
git add apps/website/app/docs/page.mdx apps/website/app/docs/theming/density/page.mdx apps/website/app/docs/theming/light-dark/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): fix PR 1 references to non-existent <PretableGrid>

Three PR 1 pages reference a `<PretableGrid>` component that does
not exist. The actual public component is `<Pretable>` (3 props:
rows, columns, getRowId). `PretableGrid` is a TYPE export from
@pretable/core (the internal grid model), not a component.

Three fixes:
- /docs/page.mdx: rename "PretableGrid props" to "Pretable component
  props" in the deferred-section list. Also moves Grid from "Coming
  soon" to a documented section, since this PR ships /docs/grid.
- /docs/theming/density/page.mdx: remove the fictional
  `<PretableGrid rowHeight={56} headerHeight={64} />` example. The
  `<Pretable>` component does not accept rowHeight/headerHeight
  props. The engine bridge runs via the useResolvedHeights hook
  reading CSS values; consumers who need JS-side numeric overrides
  pass them to the hook directly.
- /docs/theming/light-dark/page.mdx: change one in-prose
  `<PretableGrid>` reference to `<Pretable>`.

Part 1 of pretable docs PR 2.

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extend `_nav.ts` with Grid section

**Files:**

- Modify: `apps/website/app/docs/_nav.ts`

- [ ] **Step 1: Read current state.**

```bash
cat apps/website/app/docs/_nav.ts
```

Confirm 2 sections (Getting Started, Theming).

- [ ] **Step 2: Replace `_nav.ts` content using the Write tool.**

```ts
export interface DocsNavItem {
  title: string;
  href: string;
}

export interface DocsNavSection {
  title: string;
  items: DocsNavItem[];
}

export const docsNav: DocsNavSection[] = [
  {
    title: "Getting Started",
    items: [
      { title: "Install + first grid", href: "/docs/getting-started" },
      { title: "Concepts", href: "/docs/getting-started/concepts" },
    ],
  },
  {
    title: "Theming",
    items: [
      { title: "Overview", href: "/docs/theming" },
      { title: "Pick a theme", href: "/docs/theming/pick-a-theme" },
      { title: "Override tokens", href: "/docs/theming/override-tokens" },
      { title: "Light / dark", href: "/docs/theming/light-dark" },
      { title: "Density", href: "/docs/theming/density" },
      { title: "Custom themes", href: "/docs/theming/custom-themes" },
      {
        title: "Tailwind + CSS-in-JS",
        href: "/docs/theming/tailwind-css-in-js",
      },
      { title: "Token reference", href: "/docs/theming/token-reference" },
    ],
  },
  {
    title: "Grid",
    items: [
      { title: "Overview", href: "/docs/grid" },
      {
        title: "<Pretable> component",
        href: "/docs/grid/pretable-component",
      },
      {
        title: "Custom rendering",
        href: "/docs/grid/custom-rendering",
      },
      { title: "Density helpers", href: "/docs/grid/density-helpers" },
      { title: "API reference", href: "/docs/grid/api-reference" },
    ],
  },
];
```

- [ ] **Step 3: Verify build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/_nav.ts
git add apps/website/app/docs/_nav.ts
git commit -m "$(cat <<'EOF'
docs(website): extend nav with Grid section (5 entries)

Adds the Grid section to the docs sidebar with 5 entries pointing
at pages that subsequent commits in this PR create:

- Overview (/docs/grid)
- <Pretable> component (/docs/grid/pretable-component)
- Custom rendering (/docs/grid/custom-rendering)
- Density helpers (/docs/grid/density-helpers)
- API reference (/docs/grid/api-reference)

The build passes here because Next.js doesn't validate href
targets at build time.

Part 2 of pretable docs PR 2.

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write Grid Overview page

**Files:**

- Create: `apps/website/app/docs/grid/page.mdx`

- [ ] **Step 1: Write the file using the Write tool.**

Path: `apps/website/app/docs/grid/page.mdx`

Content (verbatim):

````mdx
---
title: Grid Overview
description: Two paths for using Pretable's grid engine — the drop-in <Pretable> component, or the usePretable / usePretableModel hooks for custom rendering.
---

# Grid Overview

Pretable's React engine ships two consumer paths. Pick the one that matches what you're building.

## The two paths

### Path 1: `<Pretable>` drop-in

```tsx
import { Pretable } from "@pretable/react";

<Pretable rows={rows} columns={columns} />;
```

A 3-prop component that renders a basic grid. Internally it wraps the engine with sensible defaults — monospace cells, label-above-value layout, 320px viewport. Use this when you want a working grid with one import and don't need sort UI, filter UI, selection state in your component tree, or custom cell rendering.

What `<Pretable>` does NOT support out of the box:

- Sort/filter UI (the engine handles state, but `<Pretable>` doesn't render the controls)
- Selection state controlled from your component
- Custom cell rendering
- Pinned columns (controlled rendering)
- Density-prop overrides (CSS-driven only via `[data-density]` on `<html>`)

If you need any of the above, jump to Path 2.

### Path 2: `usePretable` / `usePretableModel` hooks (custom rendering)

```tsx
import { usePretableModel } from "@pretable/react";

function MyGrid({ rows, columns }) {
  const { grid, snapshot, renderSnapshot, telemetry } = usePretableModel({
    columns,
    rows,
    viewportHeight: 480,
  });

  // Render your own JSX, applying [data-pretable-*] attributes for styling
  return /* ... */;
}
```

The hooks return the grid model and the virtualized render snapshot. You write your own JSX, applying the data-attribute contract so `@pretable/ui/grid.css` styles your output. You wire interaction by calling `grid.setSort`, `grid.replaceFilters`, `grid.selectRow`, `grid.setFocus` — the engine maintains the state, you render the UI.

Use this when:

- You need a real production grid with sort/filter/selection/focus
- You want custom cell rendering (different per-column React components)
- You're building a wrapper around the engine for your design system

See [Custom rendering](/docs/grid/custom-rendering) for the recipe with a working example.

## The data-attribute contract

Both paths emit the same `[data-pretable-*]` data attributes on grid elements. `@pretable/ui/grid.css` styles those attributes. The contract:

| Attribute                         | Element                               | Purpose                                        |
| --------------------------------- | ------------------------------------- | ---------------------------------------------- |
| `[data-pretable-scroll-viewport]` | the scrollable container              | Outer chrome, focus ring, fixed height         |
| `[data-pretable-scroll-content]`  | the absolute-positioned content layer | Total scroll height for virtualization         |
| `[data-pretable-header-row]`      | the sticky header row                 | Header background, bottom border               |
| `[data-pretable-header-cell]`     | each header column button             | Header text, sort indicator                    |
| `[data-pretable-row]`             | each body row                         | Row positioning (`position: absolute` + `top`) |
| `[data-pretable-cell]`            | each body cell                        | Cell background, padding, font, gridlines      |
| `[data-pretable-wrap]`            | wrapping cells                        | `"true"` for cells with `column.wrap`          |
| `[data-pinned]="left"`            | pinned cells (header + body)          | Sticky left positioning, distinct background   |
| `[data-selected]="true"`          | selected cells                        | Selection background and text color            |
| `[data-focused]="true"`           | focused cells                         | Focus outline                                  |

Path 1 (`<Pretable>`) emits these automatically. Path 2 (custom rendering) requires you to apply them yourself — `@pretable/ui/grid.css` only styles elements that match these selectors. See [Custom rendering](/docs/grid/custom-rendering) for examples.

## Engine reads two CSS variables in JS

For row virtualization, the engine needs `rowHeight` and `headerHeight` as numbers (to compute row `top` positions and the body viewport height). It reads `--pretable-row-height` and `--pretable-header-height` from `<html>`'s computed style via the `useResolvedHeights` hook. When you flip `data-density="..."` on `<html>`, the engine re-renders with new heights automatically.

The other 22 tokens in [the theming contract](/docs/theming/token-reference) are CSS-only — they style the data-attribute selectors but don't enter JavaScript.

See [Density helpers](/docs/grid/density-helpers) for the hook API and SSR considerations.

## What's not yet documented

The engine has more capabilities than this section covers:

- **Column autosize** — the `autosize` option on `usePretable` and `usePretableModel`; resizes columns to content. Not yet documented as a recipe.
- **Streaming and transactions** — `grid.applyTransaction({add, update, remove})` for live row updates. See [Streaming Overview](/docs/streaming) (currently a stub).
- **Per-row measured heights** — pass `measuredHeights: Record<string, number>` to `usePretableModel` for content-aware row sizing. The bench's `pretable-adapter.tsx` shows this pattern.

These ship as part of `@pretable/react` today; full doc coverage lands in subsequent releases.

## Where to go next

- [\<Pretable\> component](/docs/grid/pretable-component) — drop-in recipe with the 3-prop API.
- [Custom rendering](/docs/grid/custom-rendering) — `usePretableModel` walkthrough with code.
- [Density helpers](/docs/grid/density-helpers) — `useResolvedHeights` and `getDensityHeights`.
- [API reference](/docs/grid/api-reference) — model methods + types.
- [Theming Overview](/docs/theming) — how the data-attribute contract gets styled.
````

- [ ] **Step 2: Verify build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/grid/page.mdx
git add apps/website/app/docs/grid/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Grid Overview (concept page)

Documents the two consumer paths for @pretable/react:

1. <Pretable> drop-in component (3 props: rows, columns, getRowId).
   Wraps the engine with sensible defaults; basic display only.

2. usePretable / usePretableModel hooks for custom rendering.
   Power-user escape hatch; consumers write their own JSX,
   apply [data-pretable-*] data attributes for styling, wire
   interaction via the grid model.

PretableSurface lives in @pretable-internal/react-surface (private)
and is not part of the public API — bench and website's playground
use it via the internal path; external consumers use the hooks.

Documents the [data-pretable-*] attribute contract that both paths
emit (and that @pretable/ui/grid.css targets), and the two CSS
variables the engine reads in JS (--pretable-row-height,
--pretable-header-height) via useResolvedHeights.

Honest about what's not yet documented: autosize, streaming /
transactions, per-row measured heights.

Part 3 of pretable docs PR 2.

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Write `<Pretable>` component page

**Files:**

- Create: `apps/website/app/docs/grid/pretable-component/page.mdx`

- [ ] **Step 1: Write the file.**

Path: `apps/website/app/docs/grid/pretable-component/page.mdx`

Content (verbatim):

````mdx
---
title: The Pretable component
description: A 3-prop drop-in React component that renders a basic grid. For sort, filter, selection, or custom cell rendering, use the hooks instead.
---

# The Pretable component

`<Pretable>` is the simplest way to render a grid. Three props, sensible defaults, working in one import.

```tsx
import { Pretable, type PretableColumn } from "@pretable/react";

interface Person extends Record<string, unknown> {
  id: string;
  name: string;
  role: string;
  city: string;
}

const columns: PretableColumn<Person>[] = [
  { id: "name", header: "Name", getValue: (r) => r.name },
  { id: "role", header: "Role", getValue: (r) => r.role },
  { id: "city", header: "City", getValue: (r) => r.city },
];

const rows: Person[] = [
  { id: "1", name: "Ada", role: "Engineer", city: "London" },
  { id: "2", name: "Grace", role: "Admiral", city: "New York" },
  { id: "3", name: "Linus", role: "Maintainer", city: "Helsinki" },
];

export function People() {
  return <Pretable rows={rows} columns={columns} />;
}
```

## Props

| Prop       | Type                                   | Required | Description                                                                                          |
| ---------- | -------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `columns`  | `PretableColumn<TRow>[]`               | yes      | Column definitions. See [API reference](/docs/grid/api-reference#pretablecolumn) for the full shape. |
| `rows`     | `TRow[]`                               | yes      | Row data. Generic over your row type (defaults to `Record<string, unknown>`).                        |
| `getRowId` | `(row: TRow, index: number) => string` | no       | Custom row key. Defaults to `row.id` if it's a string or number; otherwise the row's index.          |

## Defaults

`<Pretable>` wraps the engine with these hardcoded defaults:

- **Viewport height:** 320px (the scrollable container)
- **Cell rendering:** monospace, label-above-value layout (column header in a small dim line, value in the body)
- **Header rendering:** column header label + sort-direction indicator (`Newest` / `Oldest` / `Sort`)
- **No interaction UI** — no sort buttons rendered with click handlers, no filter inputs, no selection toggles. The engine's interaction state is initialized but not wired to user events.

If any of these defaults don't fit your use case, switch to [Custom rendering](/docs/grid/custom-rendering).

## Theming

`<Pretable>` emits the standard `[data-pretable-*]` data attributes, so `@pretable/ui/grid.css` styles the output. Drop in a theme + grid.css to skin it:

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";
```

The grid renders with Excel's surface tones, gridlines, accent. Toggle `data-density` on `<html>` to switch density tiers (compact / standard / spacious); the engine re-renders with new heights via `useResolvedHeights`. See [Theming Overview](/docs/theming) for the full theming model.

## Limitations

`<Pretable>` is the simplest possible surface. It is intentionally thin. For:

- **Sort UI** — handle clicks on header buttons to call `grid.setSort(id, direction)`. Use [custom rendering](/docs/grid/custom-rendering).
- **Filter UI** — render input fields and call `grid.replaceFilters(...)` or `grid.setFilter(id, value)`.
- **Selection state in your component tree** — wire `grid.selectRow(id)` and read `snapshot.selection.rowIds[0]`.
- **Focus / keyboard navigation** — wire `grid.setFocus(rowId, columnId)` and `grid.moveFocus(delta)` to keyboard handlers.
- **Custom cell components** — replace the default monospace label/value layout. Custom rendering lets you render any React tree per cell.
- **Pinned columns rendered as sticky** — set `column.pinned: "left"` and render with the data-pinned attribute.
- **Per-row measured heights** — provide `measuredHeights: Record<string, number>` to `usePretableModel`.

All of the above are available with `usePretable` or `usePretableModel`. The drop-in component just doesn't expose the API surface for it.

## Where to go next

- [Custom rendering](/docs/grid/custom-rendering) — `usePretableModel` walkthrough with code.
- [Density helpers](/docs/grid/density-helpers) — `useResolvedHeights` and `getDensityHeights`.
- [API reference](/docs/grid/api-reference) — `PretableColumn`, `PretableGrid`, etc.
- [Theming Overview](/docs/theming) — how to skin the grid.
````

- [ ] **Step 2: Verify build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/grid/pretable-component/page.mdx
git add apps/website/app/docs/grid/pretable-component/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Grid > <Pretable> component (recipe)

Documents the 3-prop drop-in component: columns, rows, getRowId.
Includes a complete code example with PretableColumn typing and
the rendered output's theming via @pretable/ui.

Honest about limitations: no sort UI, no filter UI, no selection
state in component tree, no custom cell rendering, no pinned
columns, no measured-height passthrough. All of those require
custom rendering with usePretable / usePretableModel hooks.

Lists the hardcoded defaults (320px viewport, monospace cells,
label/value layout, sort-direction indicator) so consumers know
what they're getting.

Part 4 of pretable docs PR 2.

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Write Custom rendering page

**Files:**

- Create: `apps/website/app/docs/grid/custom-rendering/page.mdx`

- [ ] **Step 1: Write the file.**

Path: `apps/website/app/docs/grid/custom-rendering/page.mdx`

Content (verbatim):

````mdx
---
title: Custom rendering with usePretableModel
description: Build your own grid UI on top of the engine — full control over cell rendering, sort UI, filter UI, selection, focus, and pinned columns.
---

# Custom rendering with `usePretableModel`

`usePretableModel` returns the engine's full state: the grid model (with interaction methods), the snapshot (sort, filters, selection, focus), the render snapshot (which rows to render at what positions), and telemetry. You write your own JSX on top, applying the `[data-pretable-*]` attribute contract so `@pretable/ui/grid.css` styles the result.

This page walks through a minimal-but-complete example.

## When to use it

- You need real sort/filter/selection UI in your app
- You want custom cell rendering (different React components per column)
- You're wrapping the engine for your design system
- You need pinned columns rendered as sticky elements

If none of these apply, the [\<Pretable\> drop-in](/docs/grid/pretable-component) is simpler.

## The hook

```ts
import { usePretableModel } from "@pretable/react";

const { grid, snapshot, renderSnapshot, telemetry } = usePretableModel({
  columns,
  rows,
  viewportHeight,
  // optional:
  viewportWidth,
  overscan,
  interactionOverrides,
  measuredHeights,
});
```

What you get back:

- **`grid`** — the grid model. Methods: `setSort(columnId, direction)`, `setFilter(columnId, value)`, `clearFilters()`, `replaceFilters(map)`, `selectRow(id)`, `setFocus(rowId, columnId)`, `moveFocus(delta)`, `setViewport({scrollTop, scrollLeft, height, width})`, `applyTransaction({add, update, remove})`.
- **`snapshot`** — current state. Shape: `{viewport, sort, filters, selection, focus, totalRowCount, visibleRows, visibleRange}`.
- **`renderSnapshot`** — what to render right now. Shape: `{columns: PlannedColumn[], rows: PretableRenderRow[], nodeCount, totalHeight, totalWidth}`. Each `PretableRenderRow` has `{id, row, rowIndex, top, height}`.
- **`telemetry`** — `{focusedRowId, rowModelRowCount, renderedRowCount, selectedRowId, totalRowCount, ...}`.

See [API reference](/docs/grid/api-reference) for the full type signatures.

## A minimal working example

```tsx
import { useResolvedHeights, usePretableModel } from "@pretable/react";
import type { PretableColumn, PretableRow } from "@pretable/react";

interface Person extends PretableRow {
  id: string;
  name: string;
  role: string;
  city: string;
}

const columns: PretableColumn<Person>[] = [
  { id: "name", header: "Name", getValue: (r) => r.name, widthPx: 200 },
  { id: "role", header: "Role", getValue: (r) => r.role, widthPx: 200 },
  { id: "city", header: "City", getValue: (r) => r.city, widthPx: 160 },
];

export function MyGrid({ rows }: { rows: Person[] }) {
  const { headerHeight } = useResolvedHeights();
  const viewportHeight = 480;

  const { grid, snapshot, renderSnapshot } = usePretableModel({
    columns,
    rows,
    viewportHeight,
  });

  const sortedColumn = snapshot.sort.columnId;
  const sortedDirection = snapshot.sort.direction;

  return (
    <div
      data-pretable-scroll-viewport=""
      style={{
        height: viewportHeight,
        overflow: "auto",
        position: "relative",
      }}
      onScroll={(e) => {
        const el = e.currentTarget;
        grid.setViewport({
          scrollTop: el.scrollTop,
          scrollLeft: el.scrollLeft,
          height: viewportHeight,
          width: el.clientWidth,
        });
      }}
    >
      {/* Header row */}
      <div
        data-pretable-header-row=""
        style={{
          position: "sticky",
          top: 0,
          zIndex: 3,
          display: "flex",
          height: headerHeight,
          minWidth: renderSnapshot.totalWidth,
        }}
      >
        {renderSnapshot.columns.map((col) => {
          const isSorted = sortedColumn === col.id;
          const next =
            isSorted && sortedDirection === "asc"
              ? "desc"
              : isSorted && sortedDirection === "desc"
                ? null
                : "asc";

          return (
            <button
              key={col.id}
              data-pretable-header-cell=""
              data-pinned={col.pinned === "left" ? "left" : undefined}
              onClick={() => grid.setSort(col.id, next)}
              style={{
                position: "absolute",
                left: col.left,
                width: col.width,
                top: 0,
                height: "100%",
                border: 0,
                background: "transparent",
                textAlign: "left",
              }}
            >
              {columns.find((c) => c.id === col.id)?.header}
              {isSorted ? (sortedDirection === "asc" ? " ▲" : " ▼") : ""}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div
        data-pretable-scroll-content=""
        style={{
          position: "relative",
          height: renderSnapshot.totalHeight,
          minWidth: renderSnapshot.totalWidth,
        }}
      >
        {renderSnapshot.rows.map((row) => {
          const isSelected = snapshot.selection.rowIds.includes(row.id);
          const isFocused = snapshot.focus.rowId === row.id;

          return (
            <div
              key={row.id}
              data-pretable-row=""
              style={{
                position: "absolute",
                top: row.top,
                height: row.height,
                left: 0,
                right: 0,
                display: "flex",
              }}
              onClick={() => {
                grid.selectRow(row.id);
                grid.setFocus(row.id, columns[0]?.id ?? null);
              }}
            >
              {renderSnapshot.columns.map((col) => {
                const column = columns.find((c) => c.id === col.id);
                const value = column?.getValue?.(row.row) ?? "";

                return (
                  <div
                    key={col.id}
                    data-pretable-cell=""
                    data-pinned={col.pinned === "left" ? "left" : undefined}
                    data-selected={isSelected ? "true" : "false"}
                    data-focused={
                      isFocused && snapshot.focus.columnId === col.id
                        ? "true"
                        : "false"
                    }
                    style={{
                      position: "absolute",
                      left: col.left,
                      width: col.width,
                      height: "100%",
                      boxSizing: "border-box",
                    }}
                  >
                    {String(value)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

This renders a working sortable grid with click-to-select. Wire `@pretable/ui/themes/excel.css` + `@pretable/ui/grid.css` and the data attributes get styled automatically — gridlines, header bg, selection background, sort indicator color.

## What this example does NOT cover

The minimal example above is a starting point. For production grids, you'll likely also need:

- **Keyboard navigation** — listen for `ArrowUp` / `ArrowDown` on the viewport and call `grid.moveFocus(±1)`.
- **Pinned columns sticky positioning** — apply `position: sticky; left: ${pinnedOffset}px` to pinned cells. The bench's adapter computes pinned offsets via the `getPinnedLeftOffsets` utility (re-exported as part of the internal API).
- **Per-row measured heights** — use `useLayoutEffect` to measure rendered row heights and pass `measuredHeights: Record<string, number>` to `usePretableModel` for content-aware sizing.
- **Filter inputs** — render a row of `<input>` elements above the body, debounce changes, and call `grid.setFilter(columnId, value)` per change.
- **Telemetry instrumentation** — use the `telemetry` return value to track visible row counts, frame budget overruns, etc.

For the full reference implementation, see `packages/react-surface/src/pretable-surface.tsx` in the repository — that's what the bench's pretable adapter and the website's playground use internally. It's marked private (lives at `@pretable-internal/react-surface`), but reading its source is the canonical reference for the patterns above.

## Where to go next

- [API reference](/docs/grid/api-reference) — `PretableGrid` model methods, hook return types.
- [Density helpers](/docs/grid/density-helpers) — `useResolvedHeights` and `getDensityHeights`.
- [Theming Overview](/docs/theming) — how the `[data-pretable-*]` attributes get styled.
- [Token reference](/docs/theming/token-reference) — the 24 CSS variables that drive the look.
````

- [ ] **Step 2: Verify build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/grid/custom-rendering/page.mdx
git add apps/website/app/docs/grid/custom-rendering/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Grid > Custom rendering (recipe)

Documents usePretableModel as the public API for custom grid
rendering. Covers when to use it vs <Pretable> drop-in, the hook
signature, the four return values (grid, snapshot, renderSnapshot,
telemetry), and a minimal-but-complete working example
(~80 lines of JSX).

The example shows: scrollable viewport with [data-pretable-*]
attributes, sticky header with sort-on-click, virtualized body
with absolute-positioned rows, click-to-select wiring via
grid.selectRow + grid.setFocus.

Honest about gaps: keyboard navigation, pinned column sticky
positioning, per-row measured heights, filter inputs, and
telemetry instrumentation are NOT covered in the example —
points readers at packages/react-surface/src/pretable-surface.tsx
in the repo as the canonical reference (private API path, but
readable source).

Part 5 of pretable docs PR 2.

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Write Density helpers page

**Files:**

- Create: `apps/website/app/docs/grid/density-helpers/page.mdx`

- [ ] **Step 1: Write the file.**

Path: `apps/website/app/docs/grid/density-helpers/page.mdx`

Content (verbatim):

````mdx
---
title: Density helpers
description: useResolvedHeights (React hook) and getDensityHeights (vanilla JS) — read --pretable-row-height and --pretable-header-height into JavaScript.
---

# Density helpers

Two functions read density values into JavaScript. They live in different packages because they target different consumers.

## `useResolvedHeights` — React hook

Lives in `@pretable/react`. Reads `--pretable-row-height` and `--pretable-header-height` from `<html>`'s computed style. Subscribes to attribute changes via `MutationObserver` so the values stay reactive when consumers flip `data-density` or `data-theme`.

```ts
import { useResolvedHeights } from "@pretable/react";

const { rowHeight, headerHeight } = useResolvedHeights();
```

Both return values are numbers (not strings). The hook re-renders the component when either CSS variable changes.

### Optional numeric overrides

If you want JS-side control (e.g., reading from a settings store), pass numbers as arguments:

```ts
const { rowHeight, headerHeight } = useResolvedHeights(
  rowHeightOverride,
  headerHeightOverride,
);
```

Numeric arguments win over CSS-resolved values. Pass `undefined` to defer to CSS for that value.

### Fallback values

If neither argument nor CSS variable resolves to a `<number>px` value, the hook returns built-in fallbacks:

| Variable                   | Fallback |
| -------------------------- | -------- |
| `--pretable-row-height`    | `32`     |
| `--pretable-header-height` | `52`     |

The header-height fallback matches the legacy `HEADER_HEIGHT` constant the engine used before the theming bridge landed, so unmigrated apps see no behavior change. The row-height fallback is conservative (between Excel's 20px compact and Material's 48px standard).

### SSR safety

The hook is SSR-safe. On the server (where `document` is undefined), the snapshot returns the fallback values without DOM access. After hydration on the client, the `MutationObserver` subscribes and the hook returns CSS-resolved values.

### Used internally

`<Pretable>` and `<PretableSurface>` (private) both use `useResolvedHeights` to compute the body viewport height (`viewportHeight - headerHeight`) and to size the sticky header. When you render with `usePretableModel`, you typically call `useResolvedHeights()` yourself to compute the same — see the example in [Custom rendering](/docs/grid/custom-rendering).

## `getDensityHeights` — vanilla JS snapshot

Lives in `@pretable/ui`. A non-React snapshot — same read logic but without `useSyncExternalStore` or `MutationObserver`.

```ts
import { getDensityHeights } from "@pretable/ui";

const { rowHeight, headerHeight } = getDensityHeights();
```

Returns the same `{rowHeight, headerHeight}` shape as `useResolvedHeights` but does NOT subscribe to changes. Call it once to read current values.

Use this when:

- You're not in a React component (e.g., a vanilla TypeScript utility, a non-React framework, a Node script that needs the values from a DOM snapshot)
- You only need a one-shot read at a specific moment (e.g., page load)
- You want to avoid the React hook's subscription cost (microscopic, but real)

## Which to use

| Situation                                                     | Use                                               |
| ------------------------------------------------------------- | ------------------------------------------------- |
| React component that should re-render on density/theme change | `useResolvedHeights` from `@pretable/react`       |
| Vanilla JS / non-React utility                                | `getDensityHeights` from `@pretable/ui`           |
| One-shot read at component mount (no reactivity needed)       | Either; `getDensityHeights` is slightly leaner    |
| Custom rendering with `usePretableModel`                      | `useResolvedHeights` (matches the engine's reads) |

## Where to go next

- [Theming > Density switching](/docs/theming/density) — recipe for wiring `data-density` from React state.
- [Custom rendering](/docs/grid/custom-rendering) — using `useResolvedHeights` with `usePretableModel`.
- [API reference](/docs/grid/api-reference) — full type signatures.
````

- [ ] **Step 2: Verify build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/grid/density-helpers/page.mdx
git add apps/website/app/docs/grid/density-helpers/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Grid > Density helpers (reference)

Documents the two functions for reading density values into JS:

- useResolvedHeights (React hook, in @pretable/react): reactive
  via useSyncExternalStore + MutationObserver, optional numeric
  overrides as arguments, fallbacks 32/52, SSR-safe.

- getDensityHeights (vanilla snapshot, in @pretable/ui): same
  read logic without subscription. For non-React utilities or
  one-shot reads.

Includes a when-to-use table comparing the two and a note that
<Pretable> and the internal <PretableSurface> use
useResolvedHeights internally to compute viewport math.

Part 6 of pretable docs PR 2.

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Write API reference page

**Files:**

- Create: `apps/website/app/docs/grid/api-reference/page.mdx`

- [ ] **Step 1: Write the file.**

Path: `apps/website/app/docs/grid/api-reference/page.mdx`

Content (verbatim):

````mdx
---
title: Grid API reference
description: Type signatures for PretableColumn, PretableRow, PretableGrid model methods, and the usePretableModel return shape.
---

# Grid API reference

Type signatures for the public API of `@pretable/react`. Hand-authored from the source at `packages/core/src/types.ts` and `packages/react-surface/src/use-pretable.ts`. Pre-1.0 — names may rename or remove in patch releases.

## `PretableColumn<TRow>`

A column definition. Generic over your row type.

| Field        | Type                     | Required | Description                                                                                        |
| ------------ | ------------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| `id`         | `string`                 | yes      | Unique column identifier. Used as React key, sort target, filter target, focus target.             |
| `header`     | `string`                 | no       | Column header label. Defaults to the column `id` if omitted.                                       |
| `wrap`       | `boolean`                | no       | If `true`, cells in this column wrap content vertically (sets `[data-pretable-wrap="true"]`).      |
| `widthPx`    | `number`                 | no       | Fixed pixel width. Defaults to 220 for wrapping columns, 140 for non-wrapping.                     |
| `pinned`     | `"left"`                 | no       | Pinned positioning. Currently only `"left"` is supported. Sets `[data-pinned="left"]` on the cell. |
| `sortable`   | `boolean`                | no       | Whether the column can be sorted. Defaults to `true` if a `getValue` is provided.                  |
| `filterable` | `boolean`                | no       | Whether the column can be filtered. Defaults to `true` if a `getValue` is provided.                |
| `getValue`   | `(row: TRow) => unknown` | no       | Extract the cell value from the row. If omitted, the column has no sortable/filterable value.      |

## `PretableRow`

```ts
type PretableRow = Record<string, unknown>;
```

Your row type extends this. The engine treats rows as opaque records; only `getRowId` and `getValue` access fields.

## `PretableGrid<TRow>` — model methods

The `grid` returned by `usePretable` and `usePretableModel`.

| Method                                                                        | Description                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `getSnapshot(): PretableGridSnapshot<TRow>`                                   | Read the current state.                                                              |
| `subscribe(listener: () => void): () => void`                                 | Subscribe to state changes. Returns an unsubscribe fn.                               |
| `setSort(columnId: string \| null, direction: "asc" \| "desc" \| null): void` | Set the sort state. Pass `null` to clear.                                            |
| `setFilter(columnId: string, value: string): void`                            | Set a filter value for one column.                                                   |
| `clearFilters(): void`                                                        | Remove all filters.                                                                  |
| `replaceFilters(map: Record<string, string>): void`                           | Replace all filters with a new map.                                                  |
| `selectRow(rowId: string \| null): void`                                      | Set the selected row (single-selection model). Pass `null` to clear.                 |
| `setFocus(rowId: string \| null, columnId: string \| null): void`             | Set the focused cell.                                                                |
| `moveFocus(delta: number): void`                                              | Shift focus by N rows. Negative for up, positive for down. Wraps at boundaries.      |
| `setViewport({scrollTop, scrollLeft, height, width}): void`                   | Update viewport metrics. Wire to your scroll container's `onScroll`.                 |
| `applyTransaction({add?, update?, remove?}): void`                            | Live-update rows. `add` appends, `update` patches by `id`, `remove` deletes by `id`. |
| `autosizeColumns(opts?): void`                                                | Resize columns to content. Optional `AutosizeOptions` controls the algorithm.        |

## `PretableGridSnapshot<TRow>`

```ts
interface PretableGridSnapshot<TRow> {
  viewport: {
    scrollTop: number;
    scrollLeft: number;
    height: number;
    width: number;
  };
  sort: { columnId: string | null; direction: "asc" | "desc" | null };
  filters: Record<string, string>;
  selection: { rowIds: string[]; anchorRowId: string | null };
  focus: { rowId: string | null; columnId: string | null };
  totalRowCount: number;
  visibleRows: { id: string; row: TRow; sourceIndex: number }[];
  visibleRange: { start: number; end: number };
}
```

Read via `grid.getSnapshot()` or directly from the `usePretableModel` return value.

## `UsePretableOptions<TRow>` — `usePretable` arguments

```ts
interface UsePretableOptions<TRow> {
  columns: PretableColumn<TRow>[];
  rows: TRow[];
  getRowId?: (row: TRow, index: number) => string;
  autosize?: boolean | AutosizeOptions;
}
```

`usePretable` returns just the `grid` model. Use it when you only need interaction state, not virtualization.

## `UsePretableModelOptions<TRow>` — `usePretableModel` arguments

```ts
interface UsePretableModelOptions<TRow> extends UsePretableOptions<TRow> {
  viewportHeight: number;
  viewportWidth?: number;
  overscan?: number; // default 6
  interactionOverrides?: PretableInteractionOverrides | null;
  measuredHeights?: Record<string, number>;
}
```

`usePretableModel` returns `{grid, snapshot, renderSnapshot, telemetry}`. Use it when you need virtualization metadata for custom rendering.

## `PretableModel<TRow>` — `usePretableModel` return

```ts
interface PretableModel<TRow> {
  grid: PretableGrid<TRow>;
  snapshot: PretableGridSnapshot<TRow>;
  renderSnapshot: PretableRenderSnapshot<TRow>;
  telemetry: PretableTelemetry;
}
```

## `PretableRenderSnapshot<TRow>`

Tells you which rows to render and where to position them.

```ts
interface PretableRenderSnapshot<TRow> {
  columns: PlannedColumn[];
  rows: PretableRenderRow<TRow>[];
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
}

interface PretableRenderRow<TRow> {
  id: string;
  row: TRow;
  rowIndex: number;
  top: number;
  height: number;
}

interface PlannedColumn {
  id: string;
  index: number;
  left: number;
  width: number;
  pinned?: "left";
}
```

`renderSnapshot.rows` is the slice of rows currently visible in the viewport (plus overscan). Each has `top` (the absolute Y position) and `height` (the row's height — measured if you provided `measuredHeights`, otherwise estimated). Use these to position your row JSX with `position: absolute; top: ${row.top}px; height: ${row.height}px`.

`renderSnapshot.columns` is the column layout — left offset and width per column, accounting for pinned positioning.

## `PretableTelemetry`

```ts
interface PretableTelemetry {
  focusedRowId: string | null;
  rowModelRowCount: number;
  renderedRowCount: number;
  selectedRowId: string | null;
  totalRowCount: number;
  totalHeight: number;
  visibleRowCount: number;
  visibleRowRange: { firstId: string; lastId: string } | null;
}
```

Useful for instrumentation (frame budget tracking, visible-row counts, focus survival across filters).

## Hook signatures

```ts
function usePretable<TRow>(opts: UsePretableOptions<TRow>): PretableGrid<TRow>;

function usePretableModel<TRow>(
  opts: UsePretableModelOptions<TRow>,
): PretableModel<TRow>;

function useResolvedHeights(
  rowHeightProp?: number,
  headerHeightProp?: number,
): { rowHeight: number; headerHeight: number };

function measureRenderedRowHeight(node: HTMLElement): number;
```

## Where to go next

- [Custom rendering](/docs/grid/custom-rendering) — uses every type listed above in a runnable example.
- [Density helpers](/docs/grid/density-helpers) — `useResolvedHeights` and `getDensityHeights` deeper dive.
- [Theming Overview](/docs/theming) — the `[data-pretable-*]` attribute contract that pairs with this engine.
````

- [ ] **Step 2: Verify build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/grid/api-reference/page.mdx
git add apps/website/app/docs/grid/api-reference/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Grid > API reference (reference)

Hand-authored type reference for @pretable/react's public API:

- PretableColumn<TRow> field table (id, header, wrap, widthPx,
  pinned, sortable, filterable, getValue)
- PretableRow type alias
- PretableGrid model methods table (getSnapshot, subscribe,
  setSort, setFilter, clearFilters, replaceFilters, selectRow,
  setFocus, moveFocus, setViewport, applyTransaction,
  autosizeColumns)
- PretableGridSnapshot interface
- UsePretableOptions / UsePretableModelOptions interfaces
- PretableModel return type (grid, snapshot, renderSnapshot,
  telemetry)
- PretableRenderSnapshot / PretableRenderRow / PlannedColumn
  interfaces
- PretableTelemetry interface
- Hook signatures: usePretable, usePretableModel,
  useResolvedHeights, measureRenderedRowHeight

Pre-1.0 disclaimer at the top — names may rename in patch
releases.

Part 7 of pretable docs PR 2.

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final verification

**Files:** none touched.

- [ ] **Step 1: Verify the website builds clean.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -10
```

Expected: Next.js production build succeeds. Routes prerender for the 5 new Grid pages plus all PR 1 pages.

- [ ] **Step 2: Verify website tests pass.**

```bash
pnpm --filter @pretable/app-website test 2>&1 | tail -5
```

Expected: 51 tests pass (no regression).

- [ ] **Step 3: Verify typecheck.**

```bash
pnpm --filter @pretable/app-website typecheck 2>&1 | tail -3
```

Expected: exit 0.

- [ ] **Step 4: Verify all touched files pass prettier.**

```bash
pnpm exec prettier --check apps/website/app/docs
```

Expected: all files compliant.

- [ ] **Step 5: Confirm clean working tree and commit list.**

```bash
git status
git log --oneline origin/main..HEAD
```

Expected: 9 commits (1 plan + 7 implementation + 1 PR-1 cleanup):

1. `<sha>` `docs(plans): pretable docs PR 2 — grid section + PR 1 cleanup` (already committed at plan time)
2. `<sha>` `docs(website): fix PR 1 references to non-existent <PretableGrid>`
3. `<sha>` `docs(website): extend nav with Grid section (5 entries)`
4. `<sha>` `docs(website): add Grid Overview (concept page)`
5. `<sha>` `docs(website): add Grid > <Pretable> component (recipe)`
6. `<sha>` `docs(website): add Grid > Custom rendering (recipe)`
7. `<sha>` `docs(website): add Grid > Density helpers (reference)`
8. `<sha>` `docs(website): add Grid > API reference (reference)`

- [ ] **Step 6: Verify forward-references still resolve correctly.**

```bash
grep -rh "/docs/grid" apps/website/app/docs/ | grep -oE "/docs/grid[a-z/-]*" | sort -u
```

Expected: a subset of:

- `/docs/grid` (overview)
- `/docs/grid/pretable-component`
- `/docs/grid/custom-rendering`
- `/docs/grid/density-helpers`
- `/docs/grid/api-reference`

No 404s — every URL points at a page that exists in this PR.

- [ ] **Step 7: Verify no `<PretableGrid>` references remain in the docs.**

```bash
grep -rn "PretableGrid" apps/website/app/docs/
```

Expected: matches inside backticks (in the API reference page, where `PretableGrid<TRow>` is documented as a TYPE export, not a component) — that's correct usage. No JSX usage like `<PretableGrid />` should remain.

```bash
grep -rn "<PretableGrid" apps/website/app/docs/
```

Expected: empty (no JSX-style references).

---

## Self-review checklist

After completing all tasks:

- [ ] All 5 new MDX pages exist under `apps/website/app/docs/grid/`.
- [ ] `_nav.ts` lists 3 sections (Getting Started, Theming, Grid).
- [ ] `pnpm --filter @pretable/app-website build` succeeds.
- [ ] `pnpm --filter @pretable/app-website test` passes 51/51.
- [ ] `pnpm typecheck` passes workspace-wide.
- [ ] `pnpm exec prettier --check apps/website/app/docs` passes.
- [ ] No `<PretableGrid>` JSX references remain in any page (only documented as a TYPE in API reference).
- [ ] The PR 1 fictional density-prop example (`<PretableGrid rowHeight={56} headerHeight={64} />`) is removed.
- [ ] The 9 commits show a coherent narrative: plan + cleanup + nav + 5 grid pages.

---

## What this PR does NOT do

- **Streaming section** — lands in Docs PR 3 (1 stub page).
- **Examples gallery** — lands in Docs PR 3 (3 example pages with live demos).
- **Polish + READMEs** — lands in Docs PR 4.
- **`<Pretable>` API expansion** — out of scope. The component stays minimal; the hooks remain the escape hatch. If/when the public component grows, docs follow.
- **Promoting `<PretableSurface>` to public** — out of scope. It stays in `@pretable-internal/react-surface` (private). Consumers use the hooks.

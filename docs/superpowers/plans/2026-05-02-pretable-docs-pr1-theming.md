# Pretable Docs PR 1: Theming Section + Concepts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Theming section (8 pages), the Getting Started → Concepts page (1 page), the navigation extension to all 6 sections, and the refreshed /docs index hub. After this PR lands, `pretable.ai/docs` has a real Theming section that documents the override story plus the wider theming surface.

**Architecture:** Pure content authoring. 9 new MDX files in `apps/website/app/docs/`, plus modifications to `_nav.ts` (extend from 1 section to 6) and `app/docs/page.mdx` (turn into section-card hub). One inline SVG diagram on the Theming Overview page (hand-rolled, ~30 lines). All content uses existing `<CodeBlock>` MDX component for code highlighting; markdown blockquotes for callouts; no new components.

**Tech Stack:** Next.js 16 app router, `@next/mdx`, shiki (via existing `<CodeBlock>` server component). No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-02-pretable-docs-architecture-design.md](../specs/2026-05-02-pretable-docs-architecture-design.md) — see "Per-page content outlines" and "Implementation decomposition" PR 1.

**Starting state:** Clean working tree on branch `feat/docs-architecture` based on `origin/main` at `a3adb18` or later. Worktree at `/Users/blove/repos/pretable/.worktrees/docs-architecture`. Spec already committed in this worktree. Baseline: `pnpm --filter @pretable/app-website test` passes 51/51.

---

## File structure

**Files CREATED (9 new MDX pages + 1 SVG):**

- `apps/website/app/docs/getting-started/concepts/page.mdx` — Concepts page (mental-model overview)
- `apps/website/app/docs/theming/page.mdx` — Theming Overview (concept page, includes inline SVG)
- `apps/website/app/docs/theming/pick-a-theme/page.mdx` — Pick a theme (recipe)
- `apps/website/app/docs/theming/override-tokens/page.mdx` — Override tokens (recipe)
- `apps/website/app/docs/theming/light-dark/page.mdx` — Light / dark switching (recipe)
- `apps/website/app/docs/theming/density/page.mdx` — Density switching (recipe)
- `apps/website/app/docs/theming/custom-themes/page.mdx` — Custom themes (recipe)
- `apps/website/app/docs/theming/tailwind-css-in-js/page.mdx` — Tailwind v4 + CSS-in-JS (recipe)
- `apps/website/app/docs/theming/token-reference/page.mdx` — Token reference (24-token table)

**Files MODIFIED:**

- `apps/website/app/docs/_nav.ts` — extend from 1 section to 6 sections (Getting Started, Theming, Grid, Streaming, API Reference, Examples). Grid/Streaming/API Reference/Examples have empty `items` arrays for now; they get populated in PR 2 / PR 3.
- `apps/website/app/docs/page.mdx` — turn into a section-card hub linking to all 6 sections.

---

## Decisions baked in

- **Markdown blockquotes for callouts** — no `<Callout>` component to create. `> ` syntax for "Note", "Warning", "Tip" blocks.
- **`<CodeBlock>` for syntax-highlighted code** — already exists in apps/website, MDX-registered.
- **Frontmatter is minimal** — only `title` and `description`. Type tag (`recipe`, `concept`, etc.) deferred until we need visual sidebar tags.
- **Section root pages live at `/docs/{section}` route** — matches the URL structure decided in the spec.
- **Empty sections in nav** — Grid, Streaming, API Reference, Examples appear in nav as section headers with empty item lists. PR 2-3 fill them in. This is intentional: makes the nav feel "complete" from PR 1, even though most sections are stubbed.

  Actually no — empty sections in the sidebar look broken. Better to add only the sections that ship. The nav goes from 1 to 2 sections in PR 1 (Getting Started + Theming), expands to 3 in PR 2, etc. The `/docs` index hub explains the full structure even when sidebar only shows 2.

- **Voice:** third-person conversational. Code-first recipes. Honest about pre-1.0 status.
- **Cross-references inline:** every page links to its siblings in-prose where useful, plus a "Next" pointer at the bottom.
- **Prettier discipline:** every commit step ends with `pnpm exec prettier --write` on the touched files BEFORE staging.

---

## Task 1: Extend `_nav.ts` and refresh `/docs` index hub

**Files:**

- Modify: `apps/website/app/docs/_nav.ts`
- Modify: `apps/website/app/docs/page.mdx`

- [ ] **Step 1: Read the current files to confirm starting state.**

```bash
cat apps/website/app/docs/_nav.ts
cat apps/website/app/docs/page.mdx
```

Confirm `_nav.ts` has one "Getting Started" section with one item; `page.mdx` is an 8-line stub.

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
];
```

- [ ] **Step 3: Replace `apps/website/app/docs/page.mdx` content using the Write tool.**

```mdx
# Documentation

Pretable is a React grid built around a deterministic engine. Selection survives filters; scroll stays at 60fps with 500k rows.

## Sections

### Getting Started

[Install + first grid](/docs/getting-started) walks you through `npm install` to a rendered three-column, five-row grid in five minutes. [Concepts](/docs/getting-started/concepts) is a one-page mental-model overview of the engine + theming + streaming layers — read it before diving into customization.

### Theming

[Theming](/docs/theming) covers the full customization surface: pick a prebuilt theme (Excel or Material 3), override individual `--pretable-*` tokens, switch light/dark and density at runtime, and author your own themes from a template. The [token reference](/docs/theming/token-reference) is the canonical 24-token table.

### Coming soon

The rest of the docs surface lands in subsequent releases:

- **Grid** — the engine API: columns, rows, selection, focus, sort, filter, density helpers.
- **Streaming** — transactions API and JSON streaming.
- **API Reference** — `PretableGrid` props, column types, theme token contract, density helpers.
- **Examples** — live, copy-pasteable patterns: basic table, light/dark switcher, density picker.

## Source

The codebase, including this site, lives at [github.com/cacheplane/pretable](https://github.com/cacheplane/pretable).
```

- [ ] **Step 4: Verify the website builds.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -8
```

Expected: Next.js build succeeds. The new nav items don't have target pages yet, so navigation links to those URLs would 404 — but the build itself doesn't validate href targets, so it passes.

- [ ] **Step 5: Run prettier on the modified files.**

```bash
pnpm exec prettier --write apps/website/app/docs/_nav.ts apps/website/app/docs/page.mdx
```

- [ ] **Step 6: Commit.**

```bash
git add apps/website/app/docs/_nav.ts apps/website/app/docs/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): extend nav + refresh /docs hub for theming section

Extends apps/website/app/docs/_nav.ts from one section (Getting
Started) to two (Getting Started, Theming). Adds the 8 theming
nav entries pointing at pages that subsequent commits in this PR
create. Also adds the Concepts entry under Getting Started.

Refreshes apps/website/app/docs/page.mdx from the prior 8-line
stub into a section-card hub. The hub describes the documented
sections (Getting Started, Theming) + the deferred ones (Grid,
Streaming, API Reference, Examples — landing in subsequent docs
PRs). Honest about coverage rather than promising more than ships.

Part 1 of pretable docs PR 1 (theming section + concepts). The
content pages land in subsequent commits in this PR; the build
passes here because Next.js doesn't validate href targets at
build time.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Write the Concepts page

**Files:**

- Create: `apps/website/app/docs/getting-started/concepts/page.mdx`

- [ ] **Step 1: Create the directory and write the file using the Write tool.**

File path: `apps/website/app/docs/getting-started/concepts/page.mdx`

Content (verbatim):

```mdx
---
title: Concepts
description: The mental model behind Pretable — a headless engine, a theming layer, and a streaming pipeline that compose through CSS variables and React hooks.
---

# Concepts

Pretable is built around three layers. Understanding their boundaries makes the rest of the docs easier to navigate.

## The engine + theming split

`@pretable/react` is the **engine**. It handles row virtualization, column layout, focus and selection state, sort and filter dispatch, and the data attributes (`[data-pretable-*]`) that mark every interactive element. The engine is structurally pure — its inline styles handle position, height, and z-index, but no colors, padding, fonts, or borders.

`@pretable/ui` is the **theming layer**. It ships CSS files: theme files (`themes/excel.css`, `themes/material.css`) declare `--pretable-*` design tokens at `:root`; `grid.css` is a selector-based skin that targets the engine's data attributes and resolves the tokens. There's no JavaScript theme builder; everything is CSS.

The two packages cooperate through a documented contract: the engine emits known data attributes, the theming layer styles them. Either side can be replaced without forking the other — you can ship `@pretable/ui` with a different design system, or use `@pretable/react` with hand-rolled CSS, and both still work.

## Two CSS-variable namespaces

Pretable uses one CSS-variable namespace exclusively: `--pretable-*`. All 24 public tokens live there. See the [token reference](/docs/theming/token-reference) for the full list.

Your application has its own namespace — whatever brand tokens you already use, like `--brand-*`, `--app-*`, or your design system's prefix. The two never collide because they're prefix-disjoint. You can theme the grid with Material 3 while your surrounding marketing site uses your own brand tokens, and there's no leakage either direction.

## Three runtime axes

Pretable's theming surface has three axes that can change at runtime:

- **Theme** — pick `excel.css` or `material.css` at build time by importing one. Switch between themes by swapping which CSS file is active (or by setting CSS variables manually if you want a hybrid).
- **Density** — toggle `data-density="compact"`, `data-density="standard"`, or `data-density="spacious"` on `<html>` to switch row heights, padding, and font sizes. The engine reads the new heights from CSS via `MutationObserver` and re-renders.
- **Light / dark** — toggle `data-theme="dark"` on `<html>` to activate Material's dark variant. Excel is light-only by design.

All three compose. `<html data-theme="dark" data-density="spacious">` gives you Material dark in spacious density. CSS specificity handles the cascade; no JavaScript coordination needed beyond the attribute toggles.

## Streaming

Pretable can render rows that arrive over the network — JSON streams, transactions API, server-sent events. The streaming pipeline is implemented but the public API is in flux for v0.0.x. See [Streaming Overview](/docs/streaming) for the current state, or browse `apps/streaming-demo/` in the repo for working code.

## Pre-1.0 caveat

> Pretable ships at version 0.0.x. Token names in `@pretable/ui` may rename or remove in any patch release. The engine API in `@pretable/react` is more stable but not frozen. Check the changelog before upgrading.

## Where to go next

- [Theming Overview](/docs/theming) — the customization surface, in detail.
- [Override tokens](/docs/theming/override-tokens) — change individual `--pretable-*` values without forking a theme.
- [Token reference](/docs/theming/token-reference) — the canonical list of all 24 tokens.

For the architectural rationale (why CSS variables, why density-coupled-to-theme, etc.), the design spec at `docs/superpowers/specs/2026-05-02-pretable-docs-architecture-design.md` has the why behind the what.
```

- [ ] **Step 2: Verify website builds.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -5
```

Expected: build succeeds, the new page is prerendered as static.

- [ ] **Step 3: Run prettier.**

```bash
pnpm exec prettier --write apps/website/app/docs/getting-started/concepts/page.mdx
```

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/docs/getting-started/concepts/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Getting Started > Concepts page

One-page mental-model overview of pretable's three-layer architecture:
engine (@pretable/react), theming layer (@pretable/ui), streaming
(deferred for v0.0.x). Documents the two-namespace coexistence
pattern, the three runtime axes (theme, density, light/dark), and
the pre-1.0 instability caveat.

Cross-links to Theming Overview, Override tokens, Token reference,
and the streaming overview (lands in PR 3 of the docs arc).

Part 2 of pretable docs PR 1.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write the Theming Overview page (with inline SVG diagram)

**Files:**

- Create: `apps/website/app/docs/theming/page.mdx`

- [ ] **Step 1: Write the file using the Write tool.**

File path: `apps/website/app/docs/theming/page.mdx`

Content (verbatim):

````mdx
---
title: Theming Overview
description: How Pretable's theming layers compose — theme files declare tokens, grid.css resolves them, your CSS overrides anything you want.
---

# Theming Overview

Pretable's theming is built around three cooperating layers. Each owns one thing.

## The three layers

```
┌─────────────────────────────────────┐
│  Your CSS                           │   Layer 3 (consumer override)
│  :root { --pretable-accent: red; }  │   Highest specificity (last loaded)
└─────────────────────────────────────┘
                 ▼ overrides
┌─────────────────────────────────────┐
│  @pretable/ui/grid.css              │   Layer 2 (chrome)
│  [data-pretable-cell] {             │   Targets engine attributes
│    background: var(--pretable-...); │
│    ...                              │
│  }                                  │
└─────────────────────────────────────┘
                 ▼ resolves vars from
┌─────────────────────────────────────┐
│  @pretable/ui/themes/excel.css      │   Layer 1 (theme tokens)
│  :root {                            │
│    --pretable-bg-grid: #ffffff;     │
│    --pretable-accent: #107C41;      │   24 tokens defined
│    ...                              │
│  }                                  │
└─────────────────────────────────────┘
                 ▼ writes to
┌─────────────────────────────────────┐
│  @pretable/react                    │   Engine (no styling)
│  <div data-pretable-cell="" />      │
│  Reads --pretable-row-height +      │
│  --pretable-header-height for       │
│  virtualization math.               │
└─────────────────────────────────────┘
```

**Layer 1 — theme tokens.** A theme file (`themes/excel.css` or `themes/material.css`) declares all 24 `--pretable-*` tokens at `:root`. This is the single source of truth for what the grid looks like.

**Layer 2 — grid.css.** A selector-based stylesheet (`grid.css`) targets the engine's data attributes (`[data-pretable-scroll-viewport]`, `[data-pretable-cell]`, etc.) and applies `var(--pretable-*)` references. The engine emits the markup; this layer makes it visible.

**Layer 3 — your CSS.** Whatever you put in your application's stylesheet, loaded after the imports. CSS cascade specificity: a redefinition at `:root` in your stylesheet wins over the theme's `:root` because yours loads later. The override story.

## The 24-token contract

Pretable's public token contract has 24 tokens, grouped:

- **Surfaces (5):** `bg-grid`, `bg-grid-alt`, `bg-header`, `bg-toolbar`, `bg-tooltip`
- **Text (3):** `text-cell`, `text-header`, `text-dim`
- **Lines (3):** `rule`, `rule-strong`, `radius`
- **State (4):** `bg-hover`, `bg-selected`, `text-selected`, `focus-ring`
- **Accent (1):** `accent`
- **Density (6):** `row-height`, `header-height`, `cell-padding-x`, `cell-padding-y`, `font-size-cell`, `font-size-header`
- **Typography (2):** `font-sans`, `font-mono`

Each prefixed `--pretable-`. See [Token reference](/docs/theming/token-reference) for descriptions, types, and example values per theme.

> Two of the density tokens (`--pretable-row-height` and `--pretable-header-height`) are read by the engine in JavaScript via the `useResolvedHeights` hook. The other 22 are CSS-only.

## The two attribute axes

Two `data-*` attributes on `<html>` toggle runtime variants:

- **`data-theme="dark"`** — activates the `[data-theme="dark"]` block in the active theme file. Material has a dark variant; Excel is light-only.
- **`data-density="compact|standard|spacious"`** — switches density tokens. Each theme defines its own three tiers; the engine reads the new heights via `MutationObserver` and re-renders.

The two axes compose independently. `<html data-theme="dark" data-density="compact">` gives you Material dark in compact density. CSS specificity handles the rest.

## Composition order

When the cascade resolves, layers compose in this order:

1. Theme file's `:root` block writes initial token values.
2. Theme file's `[data-density]` block (if attribute is set) overrides density tokens.
3. Theme file's `[data-theme="dark"]` block (Material only, if attribute is set) overrides color tokens.
4. Your application's `:root` block (if you redefine any tokens) wins because it loads after the theme.
5. `grid.css` reads `var(--pretable-*)` references and applies them to the engine's data-attribute selectors.

You can mix any of these — for example, swap to Material dark and override only the accent color:

```css
@import "@pretable/ui/themes/material.css";
@import "@pretable/ui/grid.css";

:root {
  --pretable-accent: #ff5722;
}
```

```html
<html data-theme="dark">
  ...
</html>
```

The accent override applies in both light and dark mode (because it's at `:root`, outside the `[data-theme="dark"]` block).

## Where to go next

- [Pick a theme](/docs/theming/pick-a-theme) — Excel vs Material 3, when to use each.
- [Override tokens](/docs/theming/override-tokens) — recipes for redefining `--pretable-*` values.
- [Light / dark switching](/docs/theming/light-dark) — wire up `data-theme="dark"` from React.
- [Density switching](/docs/theming/density) — wire up `data-density` from React.
- [Custom themes](/docs/theming/custom-themes) — author your own from scratch.
````

- [ ] **Step 2: Verify website builds.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -5
```

- [ ] **Step 3: Run prettier.**

```bash
pnpm exec prettier --write apps/website/app/docs/theming/page.mdx
```

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/docs/theming/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Theming Overview (concept page)

The theming model documented as three cooperating CSS layers:
theme tokens (Layer 1), grid.css chrome selectors (Layer 2),
consumer overrides (Layer 3). Includes an ASCII-art layered
diagram (no SVG dependency) showing how the layers compose.

Documents the 24-token contract grouped by purpose, the two
attribute axes (data-theme, data-density), and the cascade order
that resolves when consumer overrides + dark mode + density
combine.

Cross-links to all 7 theming sub-pages plus the Token reference.

Part 3 of pretable docs PR 1.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Write Pick a theme

**Files:**

- Create: `apps/website/app/docs/theming/pick-a-theme/page.mdx`

- [ ] **Step 1: Write the file.**

File path: `apps/website/app/docs/theming/pick-a-theme/page.mdx`

Content (verbatim):

````mdx
---
title: Pick a theme
description: Excel vs Material 3 — visual identity, when to use each, and the import statements that activate them.
---

# Pick a theme

Two prebuilt themes ship with `@pretable/ui`. Pick one that matches your app's audience and aesthetic.

## Excel

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";
```

Gray, technical, dense. The default theme. Aptos Narrow at 11pt (the modern Office default font), Excel-green (`#107C41`) active-cell border, no row hover, sharp 0-radius corners. Default density: compact (20px rows, ~3px padding, light gray gridlines `#D4D4D4`).

Use Excel when:

- Your app is data-heavy and information density matters more than whitespace.
- Your audience is technical (developers, analysts, ops, finance).
- The grid is the primary surface, not embedded chrome around marketing content.
- Your app already feels Excel-adjacent — admin dashboards, log viewers, ticket queues, reports.

Light-only by design. Excel doesn't ship a dark variant in `@pretable/ui` — there's no `[data-theme="dark"]` block in `excel.css`. If you need dark mode, use Material instead, or override Excel's tokens manually.

## Material 3

```css
@import "@pretable/ui/themes/material.css";
@import "@pretable/ui/grid.css";
```

Material 3 baseline scheme (seed `#6750A4`). Roboto Flex (variable font) for body text and labels. M3 surface roles for chrome — `surface` for cells, `surface-container` (one tonal step up) for headers. State layers at `on-surface @ 8%` for hover. `secondary-container` for selection. 12dp medium shape scale (12px rounded corners). Default density: standard (48px rows, 16px horizontal padding).

Light at `:root`; dark at `[data-theme="dark"]`. Toggle the attribute on `<html>` to switch — see [Light / dark switching](/docs/theming/light-dark) for the wiring.

Use Material 3 when:

- Your app is consumer-facing or has a Material design language elsewhere.
- You need both light and dark mode out of the box.
- The grid is one component among many in a designed product, not the focal point.
- Your audience expects polish and motion (Material 3 tonal elevation, ripple-target spacing).

## Switching at build time

Pick one theme by importing its CSS file. To switch, swap the import:

```diff
- @import "@pretable/ui/themes/excel.css";
+ @import "@pretable/ui/themes/material.css";
```

You can also import both and toggle which one's tokens are active via your own CSS — but that's an advanced pattern. For most apps, pick one theme at build time and override individual tokens if you need brand customization. See [Override tokens](/docs/theming/override-tokens) for that pattern.

## Where to go next

- [Override tokens](/docs/theming/override-tokens) — change individual values within a theme.
- [Light / dark switching](/docs/theming/light-dark) — for Material consumers.
- [Density switching](/docs/theming/density) — runtime compact / standard / spacious toggle.
- [Custom themes](/docs/theming/custom-themes) — start from scratch with your own theme file.
````

- [ ] **Step 2: Verify build, run prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/theming/pick-a-theme/page.mdx
git add apps/website/app/docs/theming/pick-a-theme/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Theming > Pick a theme (recipe)

Side-by-side description of Excel and Material 3 themes: visual
identity, when to use each, import statements. Excel: gray/technical/
dense, light-only, Aptos Narrow 11pt, Excel-green active cell.
Material 3: baseline scheme #6750A4, Roboto Flex, light + dark,
12dp medium shape, M3 surface tones.

Build-time switch is a single import swap. Cross-links to override
tokens, light/dark, density, custom themes.

Part 4 of pretable docs PR 1.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Write Override tokens

**Files:**

- Create: `apps/website/app/docs/theming/override-tokens/page.mdx`

- [ ] **Step 1: Write the file.**

Content (verbatim):

````mdx
---
title: Override tokens
description: Customize @pretable/ui by redefining --pretable-* CSS variables in your stylesheet — no rebuild, no fork, cascade-driven.
---

# Override tokens

The override story is plain CSS cascade. Pick a theme, redefine any of its 24 tokens in your own stylesheet, and your values win because they load after the theme.

## The basic pattern

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";

:root {
  --pretable-accent: #ff5722;
  --pretable-rule: #cccccc;
}
```

Both your `:root` block and Excel's `:root` block declare CSS variables at the same specificity. Source order wins: your stylesheet imports after Excel's, so your values override.

## Worked examples

### Tweak the accent color

Most apps want the grid's accent to match their brand. Override one token:

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";

:root {
  --pretable-accent: var(--brand-primary);
}
```

The accent appears on focus rings, sort indicators, and selection highlights. One override, brand-consistent across the grid.

### Swap the entire color palette

Pretable ships Excel and Material as concrete themes, but the token contract works for any palette. Define all the surface/text/line/state tokens to your brand:

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";

:root {
  /* Surfaces */
  --pretable-bg-grid: #0d1117;
  --pretable-bg-grid-alt: #161b22;
  --pretable-bg-header: #161b22;

  /* Text */
  --pretable-text-cell: #c9d1d9;
  --pretable-text-header: #8b949e;

  /* Lines */
  --pretable-rule: #30363d;
  --pretable-rule-strong: #484f58;

  /* State */
  --pretable-bg-hover: #161b22;
  --pretable-bg-selected: rgba(56, 139, 253, 0.15);

  /* Accent */
  --pretable-accent: #58a6ff;
}
```

You're effectively building a third theme on top of Excel as a base. If this is more than a one-off, see [Custom themes](/docs/theming/custom-themes) for the cleaner pattern.

### Change the corner radius

Excel ships with `--pretable-radius: 0` (sharp corners). To round the grid container without writing a new theme:

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";

:root {
  --pretable-radius: 8px;
}
```

The grid container's outer border radius now reflects your value. Cells stay square — the radius applies only to the outermost wrapper.

### Change density values

Density tokens follow the same rule. Override them at `:root` to tweak the dimensions a theme ships:

```css
@import "@pretable/ui/themes/material.css";
@import "@pretable/ui/grid.css";

:root {
  /* Material's standard density is 48px row; tighten to 36px globally */
  --pretable-row-height: 36px;
  --pretable-header-height: 40px;
  --pretable-cell-padding-x: 12px;
  --pretable-cell-padding-y: 6px;
}
```

The engine's `useResolvedHeights` hook reads `--pretable-row-height` and `--pretable-header-height` directly from CSS, so the virtualizer respects your values without you passing props.

## Token groups

The 24 tokens group by purpose. When overriding, think in groups:

- **Surfaces** drive cell, header, and chrome backgrounds.
- **Text** drives readable content color.
- **Lines** drive gridline and container borders.
- **State** drives hover, selection, focus interaction.
- **Accent** is one token used in multiple places — sort indicators, focus rings, active filter tags.
- **Density** drives row heights, padding, and font sizes.
- **Typography** drives font family stacks (sans for chrome, mono for numeric cells).

See [Token reference](/docs/theming/token-reference) for the full list with descriptions, types, and example values.

## Specificity tips

- **Override at `:root`** — matches the theme's specificity, source order decides.
- **Don't use `!important`** unless something else is fighting you. Cascade order should win cleanly.
- **Scope overrides if needed** — to override per-section of your app, scope to a class or attribute: `.dashboard { --pretable-accent: red; } .reports { --pretable-accent: blue; }`. The grid inside each scope reads the locally scoped value.

## Where to go next

- [Token reference](/docs/theming/token-reference) — the canonical 24-token table.
- [Light / dark switching](/docs/theming/light-dark) — runtime variant toggle.
- [Density switching](/docs/theming/density) — runtime density toggle.
- [Custom themes](/docs/theming/custom-themes) — when overrides grow into a full theme, switch to authoring one.
````

- [ ] **Step 2: Build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/theming/override-tokens/page.mdx
git add apps/website/app/docs/theming/override-tokens/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Theming > Override tokens (the override story)

The override pattern explained: redefine --pretable-* values in
your :root, cascade source-order wins because your stylesheet
loads after the theme. No rebuild, no fork.

Four worked examples: tweak one accent (brand alignment), swap
entire palette (effectively a custom theme on top of Excel), change
corner radius, override density values. Plus token-group taxonomy
(surfaces / text / lines / state / accent / density / typography)
and specificity tips.

This is the "override story" the user flagged needs to be in /docs.

Part 5 of pretable docs PR 1.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Write Light / dark switching

**Files:**

- Create: `apps/website/app/docs/theming/light-dark/page.mdx`

- [ ] **Step 1: Write the file.**

Content (verbatim):

````mdx
---
title: Light / dark switching
description: Activate Material 3 dark mode by toggling data-theme="dark" on <html>. Composes independently with density.
---

# Light / dark switching

Material 3's theme file ships both light and dark variants. Switch between them at runtime by toggling `data-theme="dark"` on the root `<html>` element. CSS specificity handles the rest.

> Excel is light-only by design. There's no `[data-theme="dark"]` block in `excel.css`. If you need dark mode, use Material 3 or build your own theme file with both variants. See [Custom themes](/docs/theming/custom-themes).

## React state-driven

Hold the theme mode in React state, sync to the DOM in an effect:

```tsx
import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    if (mode === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
  }, [mode]);

  return (
    <>
      <button onClick={() => setMode(mode === "light" ? "dark" : "light")}>
        Switch to {mode === "light" ? "dark" : "light"}
      </button>
      {children}
    </>
  );
}
```

Wrap your app with this provider. Anywhere a `<PretableGrid>` renders inside, the grid responds to the mode change automatically. The theme file's `[data-theme="dark"]` block declares the dark color overrides; CSS cascade does the rest.

## OS-respect (`prefers-color-scheme`)

For apps that should follow the OS dark-mode setting without asking:

```tsx
import { useEffect, useState } from "react";

function getSystemMode(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function SystemThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<"light" | "dark">(getSystemMode);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setMode(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (mode === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
  }, [mode]);

  return <>{children}</>;
}
```

## Composition with density

`data-theme="dark"` and `data-density` are independent attributes. They compose:

```html
<html data-theme="dark" data-density="spacious">
  ...
</html>
```

Material's `[data-theme="dark"]` block overrides color tokens (cell background, text, accent, gridlines) without touching density tokens. Material's `[data-density="spacious"]` block overrides density tokens without touching colors. Both apply.

The engine's `useResolvedHeights` hook (in `@pretable/react`) listens for either attribute change via `MutationObserver` and re-renders the grid with new heights when density flips. No additional wiring needed.

## SSR considerations

If your app renders on the server, the initial HTML doesn't know the user's mode. Two patterns:

1. **Cookie-driven SSR.** Read a `theme` cookie server-side, set `<html data-theme="dark">` in the initial markup if it's `"dark"`. Avoids a flash of light content.
2. **Client-only.** Don't set `data-theme` server-side; let the React effect set it after hydration. Brief flash of light mode is acceptable for low-traffic apps.

The OS-respect pattern above is client-only by default — `getSystemMode` returns `"light"` server-side because `window` is undefined.

## Where to go next

- [Density switching](/docs/theming/density) — runtime compact/standard/spacious.
- [Override tokens](/docs/theming/override-tokens) — change colors per-mode by overriding inside `[data-theme="dark"]`.
- [Custom themes](/docs/theming/custom-themes) — author your own dark-mode block.
````

- [ ] **Step 2: Build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/theming/light-dark/page.mdx
git add apps/website/app/docs/theming/light-dark/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Theming > Light / dark switching (recipe)

Two patterns: React state-driven (user toggle button) and OS-respect
(prefers-color-scheme media query). Both wire data-theme="dark" on
<html> via a useEffect. Excel is light-only — flagged with a
blockquote pointing at custom themes for consumers who need dark
on Excel.

Documents independent composition with data-density attribute and
SSR considerations (cookie vs client-only).

Part 6 of pretable docs PR 1.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Write Density switching

**Files:**

- Create: `apps/website/app/docs/theming/density/page.mdx`

- [ ] **Step 1: Write the file.**

Content (verbatim):

````mdx
---
title: Density switching
description: Runtime row height, padding, and font size toggle via data-density attribute. Engine reads new values via MutationObserver and re-renders.
---

# Density switching

Pretable supports three density tiers — compact, standard, spacious — selected by the `data-density` attribute on `<html>`. Both Excel and Material define their own values per tier; switching is a single attribute toggle.

## How it composes

Each theme's natural default lives at `:root`:

- **Excel** defaults to compact (20px rows). `[data-density="standard"]` and `[data-density="spacious"]` blocks override for tighter or roomier modes.
- **Material** defaults to standard (48px rows). `[data-density="compact"]` and `[data-density="spacious"]` blocks override.

When the consumer sets `data-density="standard"` on `<html>` while Excel is loaded, the standard block wins (more specific selector than `:root`). When the consumer removes the attribute, the standard block stops matching and the `:root` (compact) values reassert.

> Density values are theme-coupled by design. Excel's "compact" (20px row) is tighter than Material's "compact" (40px row) because each theme's identity includes its own density character. Picking compact in Excel and compact in Material gives you different absolute heights — the relationship is what's preserved across themes.

## React state-driven

Same pattern as light/dark — hold density in state, sync to the DOM:

```tsx
import { useEffect, useState } from "react";

type Density = "compact" | "standard" | "spacious";

export function DensityPicker({
  density,
  onChange,
}: {
  density: Density;
  onChange: (density: Density) => void;
}) {
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  return (
    <div role="radiogroup" aria-label="Row density">
      <button onClick={() => onChange("compact")}>Compact</button>
      <button onClick={() => onChange("standard")}>Standard</button>
      <button onClick={() => onChange("spacious")}>Spacious</button>
    </div>
  );
}
```

Wrap your app with a `<DensityPicker density={...} onChange={...} />` and hold the state in your app's root or persist it to localStorage.

## The engine bridge

Two density tokens are read by the engine in JavaScript, not just by CSS:

- `--pretable-row-height` — used by the row virtualizer to compute `top` positions.
- `--pretable-header-height` — used to position the sticky header and compute body viewport height.

The engine reads these via the `useResolvedHeights` hook (in `@pretable/react`), which subscribes to attribute changes on `<html>` via `MutationObserver`. When you flip `data-density`, the engine re-renders the grid with new heights automatically — no need to pass `rowHeight` or `headerHeight` props from your component.

If you want to override the heights at the component level (e.g., a single grid uses spacious while the rest of the app respects user preference), pass props:

```tsx
<PretableGrid rows={rows} columns={columns} rowHeight={56} headerHeight={64} />
```

Numeric props win over CSS-resolved values. See [Density helpers](/docs/grid/density-helpers) for the full hook API (lands in PR 2 of the docs).

## Composition with light/dark

Density and theme variants are independent. `<html data-theme="dark" data-density="compact">` gives you Material dark in compact density. The cascade resolves cleanly because `[data-theme="dark"]` overrides only colors and `[data-density="compact"]` overrides only density tokens.

## Persisting density across reloads

Most apps persist density to localStorage:

```tsx
import { useEffect, useState } from "react";

type Density = "compact" | "standard" | "spacious";

function readDensity(): Density {
  if (typeof window === "undefined") return "standard";
  const stored = window.localStorage.getItem("pretable-density");
  return stored === "compact" || stored === "spacious" ? stored : "standard";
}

export function useDensity() {
  const [density, setDensity] = useState<Density>(readDensity);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    window.localStorage.setItem("pretable-density", density);
  }, [density]);

  return [density, setDensity] as const;
}
```

Use the hook in your density picker:

```tsx
const [density, setDensity] = useDensity();
return <DensityPicker density={density} onChange={setDensity} />;
```

## Where to go next

- [Override tokens](/docs/theming/override-tokens) — change density values themselves, not just which tier is active.
- [Light / dark switching](/docs/theming/light-dark) — composes with density.
- [Density helpers](/docs/grid/density-helpers) — `useResolvedHeights` and `getDensityHeights` API (PR 2 of the docs).
````

- [ ] **Step 2: Build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/theming/density/page.mdx
git add apps/website/app/docs/theming/density/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Theming > Density switching (recipe)

Three-tier density toggle (compact / standard / spacious) wired via
data-density attribute. Documents the per-theme natural default
(Excel compact, Material standard), the engine bridge through
useResolvedHeights + MutationObserver, prop-level override pattern,
composition with light/dark, and a localStorage persistence example.

Part 7 of pretable docs PR 1.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Write Custom themes

**Files:**

- Create: `apps/website/app/docs/theming/custom-themes/page.mdx`

- [ ] **Step 1: Write the file.**

Content (verbatim):

````mdx
---
title: Custom themes
description: Author a theme file from scratch — define all 24 tokens at :root, optionally add density and dark-mode variants.
---

# Custom themes

When overrides grow beyond a handful of tokens, switch from override-on-top-of-existing to authoring a theme file from scratch. The contract is straightforward: define all 24 `--pretable-*` tokens at `:root`. Optionally add `[data-density="..."]` and `[data-theme="dark"]` blocks for runtime variants.

## Start from a template

Copy `excel.css` or `material.css` from `node_modules/@pretable/ui/themes/` into your project. They're hand-readable CSS — no preprocessing, no build step needed. Rename the file (e.g., `themes/brand.css`) and tweak the values.

```css
/* themes/brand.css */
:root {
  /* Surfaces */
  --pretable-bg-grid: #ffffff;
  --pretable-bg-grid-alt: #fafafa;
  --pretable-bg-header: #f0f0f0;
  --pretable-bg-toolbar: #f0f0f0;
  --pretable-bg-tooltip: #ffffff;

  /* Text */
  --pretable-text-cell: #1a1a1a;
  --pretable-text-header: #404040;
  --pretable-text-dim: #6a6a6a;

  /* Lines */
  --pretable-rule: #d8d8d8;
  --pretable-rule-strong: #a0a0a0;
  --pretable-radius: 4px;

  /* State */
  --pretable-bg-hover: #f5f5f5;
  --pretable-bg-selected: rgba(255, 87, 34, 0.1);
  --pretable-text-selected: #1a1a1a;
  --pretable-focus-ring: #ff5722;

  /* Accent */
  --pretable-accent: #ff5722;

  /* Density */
  --pretable-row-height: 28px;
  --pretable-header-height: 32px;
  --pretable-cell-padding-x: 8px;
  --pretable-cell-padding-y: 4px;
  --pretable-font-size-cell: 14px;
  --pretable-font-size-header: 12px;

  /* Typography */
  --pretable-font-sans:
    "Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --pretable-font-mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
}
```

Import your theme file instead of (or alongside) the prebuilt themes:

```css
@import "./themes/brand.css";
@import "@pretable/ui/grid.css";
```

## Add a dark-mode variant

If your theme should have dark mode, add a `[data-theme="dark"]` block. Override only the color tokens (density and typography typically inherit from light):

```css
[data-theme="dark"] {
  /* Surfaces */
  --pretable-bg-grid: #1a1a1a;
  --pretable-bg-grid-alt: #1f1f1f;
  --pretable-bg-header: #2a2a2a;
  --pretable-bg-toolbar: #2a2a2a;
  --pretable-bg-tooltip: #2a2a2a;

  /* Text */
  --pretable-text-cell: #e8e8e8;
  --pretable-text-header: #c0c0c0;
  --pretable-text-dim: #888888;

  /* Lines */
  --pretable-rule: #3a3a3a;
  --pretable-rule-strong: #585858;

  /* State */
  --pretable-bg-hover: #252525;
  --pretable-bg-selected: rgba(255, 138, 101, 0.15);
  --pretable-text-selected: #ffffff;
  --pretable-focus-ring: #ff8a65;

  /* Accent */
  --pretable-accent: #ff8a65;
}
```

Toggle `data-theme="dark"` on `<html>` to activate. See [Light / dark switching](/docs/theming/light-dark) for the React wiring.

## Add density variants

If you want compact/standard/spacious tiers, add explicit blocks for the non-default tiers. Don't redefine the natural default — let `:root` handle that.

If your `:root` is the standard tier:

```css
[data-density="compact"] {
  --pretable-row-height: 22px;
  --pretable-header-height: 26px;
  --pretable-cell-padding-x: 6px;
  --pretable-cell-padding-y: 2px;
  --pretable-font-size-cell: 13px;
  --pretable-font-size-header: 11px;
}

[data-density="spacious"] {
  --pretable-row-height: 40px;
  --pretable-header-height: 48px;
  --pretable-cell-padding-x: 16px;
  --pretable-cell-padding-y: 12px;
  --pretable-font-size-cell: 14px;
  --pretable-font-size-header: 13px;
}
```

Skip the `[data-density="standard"]` block since `:root` already provides those values. CSS handles the rest — when the user sets `data-density="standard"`, no rule matches and the cascade falls back to `:root`.

## Validate against the contract

Pretable doesn't enforce that custom themes define all 24 tokens — if you skip one, that token resolves to its default value (which depends on the engine's fallback) or to whatever else is in scope. The smoke test in `@pretable/ui` verifies that each shipped theme defines every documented token; if you want similar validation for your custom theme, copy that test pattern.

The full token list is in [Token reference](/docs/theming/token-reference).

## When to ship a custom theme as a separate file vs. override at `:root`

| Approach                                | When to use                                                            |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Override individual tokens at `:root`   | 1-5 tokens differ from a prebuilt theme. Stay close to Excel/Material. |
| Author a custom theme file from scratch | Most or all tokens differ. You want a dedicated brand theme.           |
| Both                                    | Custom theme as the base, occasional overrides for dark-only tweaks.   |

For most apps, overriding individual tokens at `:root` is sufficient. Switch to a custom theme file when the override block grows past ~10 tokens or when you want to share your theme across multiple apps.

## Where to go next

- [Override tokens](/docs/theming/override-tokens) — when single-token overrides are enough.
- [Token reference](/docs/theming/token-reference) — the canonical 24-token list.
- [Light / dark switching](/docs/theming/light-dark) — toggle the dark variant of your custom theme.
- [Density switching](/docs/theming/density) — runtime tier toggle for your custom density blocks.
````

- [ ] **Step 2: Build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/theming/custom-themes/page.mdx
git add apps/website/app/docs/theming/custom-themes/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Theming > Custom themes (recipe)

Authoring a theme file from scratch: copy excel.css or material.css
as a template, define all 24 --pretable-* tokens at :root, optionally
add [data-theme="dark"] for dark mode and [data-density="..."] for
non-default density tiers. Full code example for a custom brand
theme. When-to-use table comparing override-at-:root vs. custom
theme file vs. both.

Part 8 of pretable docs PR 1.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Write Tailwind v4 + CSS-in-JS

**Files:**

- Create: `apps/website/app/docs/theming/tailwind-css-in-js/page.mdx`

- [ ] **Step 1: Write the file.**

Content (verbatim):

````mdx
---
title: Tailwind v4 + CSS-in-JS
description: Use @pretable/ui tokens with Tailwind v4 utility classes (bg-pt-*, text-pt-*) or any CSS-in-JS library via var(--pretable-*).
---

# Tailwind v4 + CSS-in-JS

`@pretable/ui` ships pure CSS, which means it works in any styling toolchain. Two specific integrations are documented below.

## Tailwind v4

`@pretable/ui` includes an opt-in Tailwind v4 bridge. Importing `tailwind.css` registers `--color-pt-*` and `--font-pt-*` shortcuts in Tailwind's `@theme` namespace, giving you utility classes that resolve to the active Pretable tokens.

```css
@import "tailwindcss";
@import "@pretable/ui/themes/material.css";
@import "@pretable/ui/grid.css";
@import "@pretable/ui/tailwind.css";
```

Now you can use Pretable's tokens in Tailwind utilities:

```tsx
<aside className="bg-pt-bg-toolbar text-pt-text-dim p-4 border-b border-pt-rule">
  <p className="font-pt-mono text-pt-accent">Filter active</p>
</aside>
```

The `pt-` prefix avoids collisions with your own design tokens. Available utilities:

- `bg-pt-{token}` — backgrounds (e.g., `bg-pt-bg-grid`, `bg-pt-bg-header`, `bg-pt-bg-toolbar`)
- `text-pt-{token}` — text colors (e.g., `text-pt-text-cell`, `text-pt-accent`)
- `border-pt-{token}` — border colors (e.g., `border-pt-rule`)
- `font-pt-{token}` — font families (e.g., `font-pt-mono`, `font-pt-sans`)

Density tokens and `--pretable-radius` are intentionally NOT exposed as Tailwind utilities — they're consumed by `grid.css` directly and don't have meaningful per-element utility analogs.

## Why the bridge is opt-in

You don't need the bridge to use `@pretable/ui` with Tailwind. The grid renders correctly with just `themes/excel.css` + `grid.css` imported. The bridge is only useful if you want to style your own application's UI using Pretable's token palette — for example, building a sidebar that color-matches the embedded grid.

If you don't want the `pt-*` utilities, skip the `tailwind.css` import. The grid still works.

## CSS-in-JS

CSS-in-JS libraries (styled-components, emotion, vanilla-extract, stitches, panda) all support runtime CSS custom properties. Reference Pretable's tokens directly via `var(--pretable-*)`:

```tsx
import styled from "styled-components";

const Toolbar = styled.div`
  background: var(--pretable-bg-toolbar);
  color: var(--pretable-text-dim);
  border-bottom: 1px solid var(--pretable-rule);
  font-family: var(--pretable-font-sans);
  padding: 12px 16px;
`;
```

Or with emotion's `css` prop:

```tsx
import { css } from "@emotion/react";

<div
  css={css`
    background: var(--pretable-bg-grid);
    color: var(--pretable-text-cell);
  `}
/>;
```

CSS custom properties resolve at runtime, so they reflect whichever theme + density + dark-mode variant is currently active. No build-time wiring needed.

## Composition with both

You can use the Tailwind bridge AND CSS-in-JS in the same app — they both resolve to the same `--pretable-*` source values. The bridge gives you ergonomic utility classes; CSS-in-JS gives you per-component scoped styles. Use whichever fits the surface you're building.

## Where to go next

- [Override tokens](/docs/theming/override-tokens) — change Pretable's token values; both Tailwind utilities and CSS-in-JS automatically reflect the override.
- [Token reference](/docs/theming/token-reference) — the full list of `--pretable-*` tokens you can reference in either approach.
````

- [ ] **Step 2: Build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/theming/tailwind-css-in-js/page.mdx
git add apps/website/app/docs/theming/tailwind-css-in-js/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Theming > Tailwind v4 + CSS-in-JS (recipe)

Two integration paths documented in one page (combined for v0.0.x;
can split later if either grows).

Tailwind v4: opt-in @pretable/ui/tailwind.css import registers
--color-pt-* / --font-pt-* shortcuts via @theme. Utilities like
bg-pt-bg-grid, text-pt-accent, font-pt-mono. Density and radius
intentionally excluded (no per-element utility analog).

CSS-in-JS: var(--pretable-*) works directly in styled-components,
emotion, vanilla-extract, etc. Runtime resolution means tokens
automatically reflect active theme + density + dark mode.

Part 9 of pretable docs PR 1.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Write Token reference

**Files:**

- Create: `apps/website/app/docs/theming/token-reference/page.mdx`

- [ ] **Step 1: Write the file.**

Content (verbatim):

```mdx
---
title: Token reference
description: The canonical 24-token contract for @pretable/ui. Names, descriptions, types, and example values per theme.
---

# Token reference

Pretable's public theming surface is 24 CSS variables, all `--pretable-*` prefixed. Each theme defines all 24 at `:root`. Excel and Material 3 ship preset values; consumers override individual tokens at `:root` in their own stylesheet (see [Override tokens](/docs/theming/override-tokens)).

> Two tokens — `--pretable-row-height` and `--pretable-header-height` — are read by the engine in JavaScript via the `useResolvedHeights` hook. The other 22 are CSS-only.

## Surfaces (5)

| Token                    | Description                                                              | Type  | Excel     | Material 3 (light)              |
| ------------------------ | ------------------------------------------------------------------------ | ----- | --------- | ------------------------------- |
| `--pretable-bg-grid`     | Body cell background                                                     | color | `#ffffff` | `#fef7ff` (`surface`)           |
| `--pretable-bg-grid-alt` | Alternate (zebra) row background; equal to `bg-grid` if no zebra desired | color | `#ffffff` | `#fef7ff`                       |
| `--pretable-bg-header`   | Header row background; pinned cells reuse this                           | color | `#f3f3f3` | `#f3edf7` (`surface-container`) |
| `--pretable-bg-toolbar`  | Toolbar + status/pagination bar background                               | color | `#f3f3f3` | `#f3edf7`                       |
| `--pretable-bg-tooltip`  | Tooltip / column menu / filter popover background                        | color | `#ffffff` | `#f3edf7`                       |

## Text (3)

| Token                    | Description                                                    | Type  | Excel     | Material 3 (light)               |
| ------------------------ | -------------------------------------------------------------- | ----- | --------- | -------------------------------- |
| `--pretable-text-cell`   | Body cell text color                                           | color | `#1f1f1f` | `#1d1b20` (`on-surface`)         |
| `--pretable-text-header` | Header text color                                              | color | `#5c5c5c` | `#49454f` (`on-surface-variant`) |
| `--pretable-text-dim`    | Secondary text (toolbar labels, empty-state body, status text) | color | `#5c5c5c` | `#49454f`                        |

## Lines (3)

| Token                    | Description                                 | Type   | Excel     | Material 3 (light)             |
| ------------------------ | ------------------------------------------- | ------ | --------- | ------------------------------ |
| `--pretable-rule`        | Gridline color (between cells)              | color  | `#d4d4d4` | `#cac4d0` (`outline-variant`)  |
| `--pretable-rule-strong` | Container outer edge + header bottom border | color  | `#a6a6a6` | `#79747e` (`outline`)          |
| `--pretable-radius`      | Container border radius                     | length | `0`       | `12px` (M3 medium shape scale) |

## State (4)

| Token                      | Description                               | Type  | Excel                     | Material 3 (light)                           |
| -------------------------- | ----------------------------------------- | ----- | ------------------------- | -------------------------------------------- |
| `--pretable-bg-hover`      | Row hover background                      | color | `transparent` (no hover)  | `rgba(29, 27, 32, 0.08)` (`on-surface @ 8%`) |
| `--pretable-bg-selected`   | Selected cell/row background              | color | `rgba(16, 124, 65, 0.10)` | `#e8def8` (`secondary-container`)            |
| `--pretable-text-selected` | Selected cell/row text color              | color | `#1f1f1f`                 | `#1d192b` (`on-secondary-container`)         |
| `--pretable-focus-ring`    | Focus outline color (cell focus, kbd nav) | color | `#107c41` (Excel green)   | `#6750a4` (`primary`)                        |

## Accent (1)

| Token               | Description                                                          | Type  | Excel     | Material 3 (light)    |
| ------------------- | -------------------------------------------------------------------- | ----- | --------- | --------------------- |
| `--pretable-accent` | Sort indicator, active filter tag, focus highlights, drag indicators | color | `#107c41` | `#6750a4` (`primary`) |

## Density (6)

The first two are read by the engine in JavaScript. The other four are CSS-only.

| Token                         | Description                  | Type   | Excel  | Material 3 (standard) | Engine reads? |
| ----------------------------- | ---------------------------- | ------ | ------ | --------------------- | ------------- |
| `--pretable-row-height`       | Body row height              | length | `20px` | `48px`                | **yes**       |
| `--pretable-header-height`    | Header row height            | length | `24px` | `52px`                | **yes**       |
| `--pretable-cell-padding-x`   | Body cell horizontal padding | length | `6px`  | `16px`                | —             |
| `--pretable-cell-padding-y`   | Body cell vertical padding   | length | `2px`  | `12px`                | —             |
| `--pretable-font-size-cell`   | Body cell font size          | length | `15px` | `14px`                | —             |
| `--pretable-font-size-header` | Header font size             | length | `13px` | `14px`                | —             |

> Density tokens vary by tier. The values shown above are each theme's natural default (`:root`). When `[data-density="..."]` is set on `<html>`, the corresponding override block adjusts these tokens — see [Density switching](/docs/theming/density).

## Typography (2)

| Token                  | Description                                  | Type | Excel                                                           | Material 3                               |
| ---------------------- | -------------------------------------------- | ---- | --------------------------------------------------------------- | ---------------------------------------- |
| `--pretable-font-sans` | Primary sans-serif family stack              | font | `"Aptos Narrow", "Aptos", "Segoe UI", -apple-system, …`         | `"Roboto Flex", "Roboto", system-ui, …`  |
| `--pretable-font-mono` | Monospace family stack (numeric cells, code) | font | `ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace` | `"Roboto Mono", ui-monospace, monospace` |

## Stability

`@pretable/ui` is at version 0.0.x. Token names may rename or remove in any patch release. Each release's `CHANGELOG.md` describes the deltas. Override at your own risk; the contract solidifies post-1.0.

## Where to go next

- [Override tokens](/docs/theming/override-tokens) — recipes for changing values.
- [Theming Overview](/docs/theming) — the architectural model.
- [Custom themes](/docs/theming/custom-themes) — author your own theme file.
```

- [ ] **Step 2: Build, prettier, commit.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -3
pnpm exec prettier --write apps/website/app/docs/theming/token-reference/page.mdx
git add apps/website/app/docs/theming/token-reference/page.mdx
git commit -m "$(cat <<'EOF'
docs(website): add Theming > Token reference (canonical 24-token table)

Full reference for @pretable/ui's public theming contract. 24
tokens grouped: Surfaces (5), Text (3), Lines (3), State (4),
Accent (1), Density (6), Typography (2). Each row: name,
description, type (color / length / font), example value in Excel
+ Material 3 (light).

Density tokens marked "engine reads?" — only --pretable-row-height
and --pretable-header-height are read by JS; the other 22 are
CSS-only.

Plain markdown table for v0.0.x. If the contract grows past 30+
tokens later, upgrade to a sortable/filterable component.

Stability disclaimer documents the pre-1.0 token-rename freedom.

Part 10 of pretable docs PR 1.

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Final verification

**Files:** none touched.

- [ ] **Step 1: Verify the website builds clean end-to-end.**

```bash
pnpm --filter @pretable/app-website build 2>&1 | tail -10
```

Expected: Next.js production build succeeds. All 9 new pages prerender as static.

- [ ] **Step 2: Verify website tests pass.**

```bash
pnpm --filter @pretable/app-website test 2>&1 | tail -5
```

Expected: 51 tests pass (no regression — content-only PR doesn't add or remove tests).

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

- [ ] **Step 5: Confirm clean working tree and full commit list.**

```bash
git status
git log --oneline origin/main..HEAD
```

Expected status: clean. Expected log: 11 commits (1 plan-doc commit from spec time + 10 implementation commits from this PR):

- `<sha>` `docs(specs): pretable docs architecture design` (already exists from spec phase)
- `<sha>` `docs(plans): pretable docs PR 1 (theming + concepts)` (this plan committed before implementation started)
- `<sha>` `docs(website): extend nav + refresh /docs hub for theming section`
- `<sha>` `docs(website): add Getting Started > Concepts page`
- `<sha>` `docs(website): add Theming Overview (concept page)`
- `<sha>` `docs(website): add Theming > Pick a theme (recipe)`
- `<sha>` `docs(website): add Theming > Override tokens (the override story)`
- `<sha>` `docs(website): add Theming > Light / dark switching (recipe)`
- `<sha>` `docs(website): add Theming > Density switching (recipe)`
- `<sha>` `docs(website): add Theming > Custom themes (recipe)`
- `<sha>` `docs(website): add Theming > Tailwind v4 + CSS-in-JS (recipe)`
- `<sha>` `docs(website): add Theming > Token reference (canonical 24-token table)`

- [ ] **Step 6: Visual sanity (recommended).**

```bash
pnpm --filter @pretable/app-website dev
```

Open `http://localhost:3000/docs` in a browser. Click through:

- The /docs index hub renders with section cards for Getting Started + Theming + "Coming soon" for the rest.
- Sidebar shows two collapsible sections (Getting Started with 2 items, Theming with 8 items).
- Each theming page renders, prose flows, tables format correctly, code blocks have syntax highlighting (shiki-themed).
- The Token reference's 24-row tables are readable; column alignment is correct.
- The Theming Overview's ASCII-art diagram renders monospaced inside its code block.
- Cross-references link to working URLs (no 404s for any page added in this PR).

If anything renders wrong, fix before declaring the PR done.

---

## Self-review checklist

After completing all tasks:

- [ ] All 9 MDX pages exist under `apps/website/app/docs/`.
- [ ] `_nav.ts` lists 2 sections (Getting Started with 2 items, Theming with 8 items). Other sections (Grid, Streaming, API Reference, Examples) are NOT yet added — they appear in PR 2 / PR 3.
- [ ] `/docs` index page is the section-card hub; the prior 8-line stub is gone.
- [ ] `pnpm --filter @pretable/app-website build` succeeds.
- [ ] `pnpm --filter @pretable/app-website test` passes 51/51.
- [ ] `pnpm typecheck` passes workspace-wide.
- [ ] `pnpm exec prettier --check apps/website/app/docs` passes for every page.
- [ ] No broken `<Link>` references in any of the 9 new pages.
- [ ] The override story is in `/docs/theming/override-tokens` with worked examples and proper cross-links.
- [ ] The 11 commits show a coherent narrative: nav extension → concepts → theming overview → 6 theming recipes → token reference.

---

## What this PR does NOT do

- **Grid section** — lands in PR 2 of the docs arc (5 pages: Overview, Columns, Rows/selection/focus, Sort+filter, Density helpers).
- **Streaming section** — lands in PR 3 of the docs arc (1 stub page).
- **API Reference section** — lands in PR 3 of the docs arc (4 pages).
- **Examples gallery** — lands in PR 3 of the docs arc (3 example pages).
- **Polish + READMEs** — lands in PR 4 of the docs arc.

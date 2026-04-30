# Website Phase 1 — Design Spec

**Date:** 2026-04-24
**Status:** Draft for review
**Scope:** Phase 1 of the website pivot — scaffold a new `apps/website` Next.js 16 app with a hero section + live playground grid section directly below, on a retuned cool-slate `@pretable/ui` palette. Bench cosmetically reskins on merge as a side effect of the token retune.
**Parent context:**
- [`2026-04-21-pretable-visual-system-design.md`](./2026-04-21-pretable-visual-system-design.md) — original cream-editorial visual system. **This pivot supersedes its §5 (playground) and palette decisions; the spec stays in the repo as historical context but no longer governs the website surface.**
- Reference repos (read-only inspiration): `~/repos/dawn` and `~/repos/angular-agent-framework`. Both Next.js 16 + Tailwind v4 + MDX + Fraunces + Inter + JetBrains Mono.
- Memory: [`project_website_pivot_after_b.md`](../../../../../.assistant/projects/-Users-blove-repos-pretable/memory/project_website_pivot_after_b.md).
**Dependencies shipped:** `@pretable/ui` (PR #7), playground pitch landing (PR #12, `c29da2b`), bench UI integration (PR #13, `1e5c167`), streaming demo app (PR #14), playground StreamingProof section (PR #16), mobile-responsive surfaces (PR #17). `apps/streaming-demo` has its own `bloomberg.css` theme and does **not** consume `@pretable/ui` tokens — it's out of scope for the rename.

---

## 1. Goal

Pretable's existing `apps/playground` ships a cream-editorial pitch landing with a full-bleed dark live grid in the middle. The user has decided to pivot the public website surface to a cool-slate AI-startup aesthetic modeled on `dawn` and `angular-agent-framework`. The pivot is staged across multiple phases:

- **Phase 1 (this spec):** Scaffold `apps/website` on Next.js 16. Ship a deployable URL with a centered text-only hero + a live interactive playground grid section directly below. Retune `@pretable/ui` tokens to cool-slate as a foundational change — bench reskins automatically.
- **Phase 2 (future spec):** AI-startup body sections (problem / solution / stack / CTA / footer content), ScrollReveal animations, ambient blob narrative, MDX content support. Update the visual system spec to reflect the new aesthetic.
- **Phase 3 (future spec):** Retire `apps/playground` — its pitch landing's role is now `apps/website`'s hero + grid section. Drop the `"playground"` `NavPage` value, delete the app and its tests.

Phase 1 is the foundational kickoff. It establishes:
- The new app, its build pipeline, its deployment shape
- The retuned design system (cool-slate, semantic-not-color token names)
- The hero + grid pattern from which the rest of the landing grows

It deliberately does **not** ship the full AI-startup narrative landing — that's Phase 2's job.

## 2. Scope boundary

**Phase 1 owns:**

- `@pretable/ui` token retune: rename color tokens to semantic-not-color names; revalue to cool-slate; update `components.css` to consume the new names.
- `@pretable/ui`'s `NavPage` type adds `"website"` to its union; internal `LINKS` array gains a `"website"` entry. `"playground"` stays valid until Phase 3.
- `apps/bench/src/app.css` updates its Tailwind `@theme inline` map to consume the renamed tokens. Bench cosmetically reskins from cream/amber to cool-slate/cyan on merge.
- `apps/playground/src/app.css` likewise updates its `@theme inline` map; **and** all playground components that hard-code Tailwind utility class names referencing old token names (`pitch-hero.tsx`, `pitch-grid.tsx`, `receipts-band.tsx`, `copy-command.tsx`, `streaming-proof.tsx`) get class-name updates: `bg-cream` → `bg-bg-page`, `text-ink` → `text-text-primary`, `text-amber-ink` → `text-accent-deep`, etc. Playground reskins to cool-slate as a side effect.
- `apps/streaming-demo` is **untouched** — its `theme/bloomberg.css` is a self-contained design system that does not import `@pretable/ui` tokens.
- New `apps/website/` Next.js 16 app: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, hero + playground-section components, ambient blob component, scroll-anchor helper, copy-command helper.
- Three font families wired via fontsource: Fraunces (display), Inter (sans), JetBrains Mono (mono).
- The interactive grid from `apps/playground/src/pitch-grid.tsx` is **copied** into `apps/website/app/components/PlaygroundSection.tsx` with cool-slate restyling. Phase 3 deletes the playground copy.
- `pnpm-workspace.yaml` already covers `apps/*`; no edit needed. Root scripts grow `dev:website`, `build:website`, `start:website`.
- Manual verification at dev URL.

**Phase 1 does NOT own:**

- AI-startup narrative body sections (problem, solution, stack, comparison, etc.) — Phase 2.
- ScrollReveal animations, multi-blob ambient narrative, parallax effects — Phase 2.
- MDX content pages, content collections, Shiki syntax highlighting — Phase 2.
- Retiring `apps/playground` — Phase 3.
- Updating the visual system design spec text to reflect the pivot — handled in Phase 2 when the full new aesthetic is documented.
- New unit tests for `apps/website` — deferred to Phase 2 when a Next.js + RSC test setup is introduced.
- Vercel project creation, domain wiring, DNS — deferred. Phase 1 ships a Vercel-deployable Next.js app; the user can manually wire deployment when ready.
- Changes to `apps/playground/src/pitch-grid.tsx` itself — it stays as-is until Phase 3 deletes it. Phase 1 has its own copy, restyled.
- `@pretable/react`, `@pretable-internal/*` package source — only `@pretable/ui` changes inside this phase.
- Theming-architecture decisions for external consumers — still tracked separately ([memory](../../../../../.assistant/projects/-Users-blove-repos-pretable/memory/project_theming_architecture_followup.md)).

## 3. Architecture

### Two-PR landing strategy

Phase 1 ships as **two PRs**, in order:

**PR-A — Token retune + bench update**

- Changes:
  - `packages/ui/src/tokens.css` — value retune + token rename
  - `packages/ui/src/components.css` — global rename of `var(--pt-cream)` → `var(--pt-bg-page)`, etc.
  - `packages/ui/src/nav.tsx` — `NavPage` union widens; `LINKS` array adds a `"website"` entry and removes the `"playground"` entry
  - `apps/bench/src/app.css` — `@theme inline` map + bench-specific class rules updated to new names
  - `apps/playground/src/app.css` — same migration as bench
  - `apps/playground/src/pitch-hero.tsx`, `pitch-grid.tsx`, `receipts-band.tsx`, `copy-command.tsx`, `streaming-proof.tsx` — Tailwind class strings (`bg-cream`, `text-ink`, etc.) renamed to new equivalents
  - `apps/playground/src/pitch-grid.css` — `var(--pt-grid-head)` → `var(--pt-grid-raised)`, `var(--pt-amber)` → `var(--pt-accent)`, etc.
  - Bench tests + playground tests stay byte-identical (assertions are behavior-focused, not color-focused — verified during review)
- Mechanical, somewhat broader than initially scoped, but still low-risk per file.
- Bench cosmetically reskins on merge. Bench tests guard runtime behavior.
- Playground (PR #12 already merged) continues to consume the renamed tokens — its `app.css` `@theme inline` map updates as part of PR-A so it doesn't break.
- Wait — playground's `app.css` ALSO has token references. PR-A must update three apps' theme maps: bench, playground, and website-to-be. Playground's update is part of the same blast radius.
- After PR-A: bench + playground both render cool-slate; visual identity is unified.

**PR-B — `apps/website` scaffold + hero + grid**

- Branches off the post-PR-A `main`.
- Adds the `apps/website/` directory with everything in §4-§6.
- No changes to `packages/ui`, `apps/bench`, or `apps/playground` other than what PR-A landed.

This split is the cleanest way to land the foundational rename separately from the new-app work. PR-A is a "nothing should break" change; PR-B is the substantive new surface.

### Component tree (PR-B)

```
apps/website/app/
  layout.tsx                         // <html><body><div ambient><Nav><main>{children}</main><Footer></div>
  page.tsx                           // <Hero /><PlaygroundSection />
  globals.css                        // @import @pretable/ui/tokens.css + components.css + tailwindcss; @theme inline; resets
  components/
    Hero.tsx                         // centered, eyebrow + headline + dek + 2 CTAs
    PlaygroundSection.tsx            // "use client" — InspectionGrid wrapper, restyled for cool-slate
    AmbientBlob.tsx                  // decorative gradient blob, abs-positioned, aria-hidden
    ScrollAnchor.tsx                 // <a href="#grid"> with smooth-scroll JS hook (or pure CSS scroll-behavior)
    CopyCommand.tsx                  // ported from apps/playground/src/copy-command.tsx; client component
```

### State ownership

- `<Hero />` — stateless. Renders eyebrow + headline + dek + two CTAs.
- `<CopyCommand />` — client component. Owns local `copied` boolean for the flash UX. Identical contract to playground's `copy-command.tsx`.
- `<PlaygroundSection />` — client component. Owns `scale` / `interactionState` / `telemetry` exactly like playground's `<PitchGrid />` does. The copy is intentional — Phase 3 deletes the playground original, leaving the website's copy as the canonical source.
- `<AmbientBlob />` — stateless decorative component.
- `app/layout.tsx` — wraps children in `<Nav active="website">` + `<main>` + `<Footer>` from `@pretable/ui`. Layout consumes `process.env`-derived version string for Nav/Footer; client-server boundary clean.

### Type contracts

PR-A:
- `@pretable/ui` exports add no new types — `NavPage` widens its union, that's it. Existing `Nav`, `Footer`, `Receipt`, `CodeBlock`, `Callout` props stay byte-identical.

PR-B:
- `apps/website` consumes `Nav`, `Footer`, `Receipt`, `CopyCommand` (locally), `InspectionGrid`, `PretableTelemetry`, `createInspectionDataset`, `inspectionColumns`, `inspectionDatasetScaleOptions`, `InspectionDatasetScale`. Same surface playground consumes.

## 4. Token rename (PR-A)

### Renaming strategy

Color token names move from "color words" (`--pt-cream`, `--pt-amber`) to "semantic role" (`--pt-bg-page`, `--pt-accent`). Reasons:

1. The cool-slate retune means `--pt-cream` would hold a slate-blue value — confusing.
2. Future re-themings (theming architecture follow-up) become easier when names describe role.
3. Matches dawn's idiom (`--color-bg-primary`, `--color-text-primary`, `--color-accent-amber`).

### New token set

```css
:root {
  /* Page surfaces */
  --pt-bg-page: #0b1120;
  --pt-bg-card: #0f172a;
  --pt-bg-raised: #1e293b;
  --pt-rule: #1e293b;
  --pt-rule-soft: #131b2c;

  /* Text ramp */
  --pt-text-primary: #e2e8f0;
  --pt-text-secondary: #94a3b8;
  --pt-text-muted: #64748b;
  --pt-text-dim: #475569;

  /* Singular accent (cyan family) */
  --pt-accent: #38bdf8;
  --pt-accent-deep: #0284c7;
  --pt-accent-soft: #1e3a52;

  /* Grid surfaces (already-dark family, retuned cooler) */
  --pt-grid-bg: #0a0f1a;
  --pt-grid-raised: #0d1426;
  --pt-grid-rule: #131b2c;
  --pt-grid-text: #cbd5e1;
  --pt-grid-dim: #64748b;

  /* Severity (unchanged — domain colors) */
  --pt-sev-info: #6fa9c9;
  --pt-sev-warn: #d9a44f;
  --pt-sev-err: #d3615a;
  --pt-sev-ok: #7ea86f;

  /* Fonts (Fraunces + Inter + JetBrains Mono via fontsource) */
  --pt-font-serif: "Fraunces Variable", Georgia, "Times New Roman", serif;
  --pt-font-sans: "Inter Variable", ui-sans-serif, -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
  --pt-font-mono: "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

### `components.css` migration

`@pretable/ui/src/components.css` references current names like `var(--pt-cream)`, `var(--pt-ink)`, `var(--pt-amber)`, `var(--pt-amber-soft)`, `var(--pt-cream-rule)`. PR-A globally renames these to the new equivalents. The mapping:

| Old name             | New name                |
| -------------------- | ----------------------- |
| `--pt-cream`         | `--pt-bg-page`          |
| `--pt-cream-hi`      | `--pt-bg-card`          |
| `--pt-cream-lo`      | `--pt-bg-raised`        |
| `--pt-cream-rule`    | `--pt-rule`             |
| `--pt-ink`           | `--pt-text-primary`     |
| `--pt-ink-hover`     | (drop — wasn't in token set, was inline)|
| `--pt-ink-dim`       | `--pt-text-secondary`   |
| `--pt-ink-softer`    | `--pt-text-muted`       |
| `--pt-amber-ink`     | `--pt-accent-deep`      |
| `--pt-amber-ink-dark`| (drop or fold into `--pt-accent-deep`) |
| `--pt-amber`         | `--pt-accent`           |
| `--pt-amber-soft`    | `--pt-accent-soft`      |
| `--pt-grid-head`     | `--pt-grid-raised`      |
| `--pt-grid-bg`       | `--pt-grid-bg`          |
| `--pt-grid-raised`   | `--pt-grid-raised`      |
| `--pt-grid-rule`     | `--pt-grid-rule`        |
| `--pt-grid-text`     | `--pt-grid-text`        |
| `--pt-grid-dim`      | `--pt-grid-dim`         |
| `--pt-sev-*`         | `--pt-sev-*` (unchanged)|
| `--pt-font-serif`    | `--pt-font-serif`       |
| `--pt-font-sans`     | `--pt-font-sans`        |
| `--pt-font-mono`     | `--pt-font-mono`        |

Implementation: a single search-replace pass across `packages/ui/src/components.css` plus the four hex values that change in tokens.css. No restructuring of class rules.

### `Nav.tsx` changes

`packages/ui/src/nav.tsx`:

```tsx
export type NavPage = "playground" | "website" | "bench" | "docs" | "github";

const LINKS: Array<{ id: NavPage; label: string; href: string }> = [
  { id: "website", label: "pretable", href: "/" },
  { id: "bench", label: "bench", href: "/bench" },
  { id: "docs", label: "docs", href: "/docs" },
  { id: "github", label: "github", href: "https://github.com/cacheplane/pretable" },
];
```

The `"playground"` link is **removed from the rendered LINKS array** in PR-A (the user no longer needs a "playground" tab — the website surface absorbs that role). `"playground"` stays in the `NavPage` union so playground's own `<Nav active="playground">` doesn't crash on a typecheck — but no link with `id="playground"` exists in the LINKS array, so `active="playground"` won't visually highlight anything. That's deliberate: playground is now an internal surface that shouldn't be advertised. Phase 3 drops `"playground"` from the union and deletes the app.

The first link's `label` changes from `"playground"` to `"pretable"` — the brand wordmark on the homepage tab. Implementation note: this means the brand cell and the active-page cell both say "pretable" on the homepage, which is fine and matches dawn's behavior (Header's brand is also a home link).

### `apps/bench/src/app.css` migration

The `@theme inline` block in bench's app.css updates:

```css
@theme inline {
  --color-bg-page: var(--pt-bg-page);
  --color-bg-card: var(--pt-bg-card);
  --color-bg-raised: var(--pt-bg-raised);
  --color-rule: var(--pt-rule);
  --color-rule-soft: var(--pt-rule-soft);
  --color-text-primary: var(--pt-text-primary);
  --color-text-secondary: var(--pt-text-secondary);
  --color-text-muted: var(--pt-text-muted);
  --color-accent: var(--pt-accent);
  --color-accent-deep: var(--pt-accent-deep);
  --color-accent-soft: var(--pt-accent-soft);
  --color-grid-bg: var(--pt-grid-bg);
  --color-grid-raised: var(--pt-grid-raised);
  --color-grid-rule: var(--pt-grid-rule);
  --color-grid-text: var(--pt-grid-text);
  --color-grid-dim: var(--pt-grid-dim);
  --color-sev-info: var(--pt-sev-info);
  --color-sev-warn: var(--pt-sev-warn);
  --color-sev-err: var(--pt-sev-err);
  --color-sev-ok: var(--pt-sev-ok);

  --font-display: var(--pt-font-serif);
  --font-sans: var(--pt-font-sans);
  --font-mono: var(--pt-font-mono);
}
```

The bench-specific class rules (`.bench-shell`, `.bench-hero`, `.eyebrow`, `.scenario-panel`, `.preview-panel`, etc.) update their `var(--pt-cream)` / `var(--pt-amber)` references to `var(--pt-bg-page)` / `var(--pt-accent)` etc. Bench also gains `@import "@fontsource-variable/inter/wght.css"` and `@fontsource-variable/jetbrains-mono/wght.css` to align with the new font stack. **Visual outcome:** bench's hero, panels, scenario cards, and run button all reskin to the cool-slate palette. The grid surfaces (`.viewport-card`, `.result-json`) continue to use `--pt-grid-*` and look very similar to before (already-dark-tuned).

### `apps/playground/src/app.css` migration (also part of PR-A)

Playground (PR #12 merged) likewise has `@theme inline` referencing the old token names. Same migration applied. Visual outcome: playground reskins from cream/amber editorial to cool-slate. **The user has signaled the playground will be retired in Phase 3** — so this reskin is short-lived. We do it anyway because:

1. Until Phase 3 actually retires playground, it's a live surface and broken styling on it is bad.
2. The reskin is mechanical (the same `@theme inline` migration as bench).
3. It validates that the token migration is complete (no surface left behind).

### `pnpm-lock.yaml` changes

Adding `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` to bench (and playground) means lockfile churn. Expected.

### PR-A test plan

- All bench unit tests stay green (current count after the latest main).
- All playground unit tests stay green (current count, including the StreamingProof coverage from PR #16).
- `apps/streaming-demo` tests stay green (untouched — not in PR-A's blast radius).
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build` all green.
- Manual: `pnpm --filter @pretable/app-bench dev` shows cool-slate bench. `pnpm --filter @pretable/app-playground dev` shows cool-slate playground (including the StreamingProof section). `pnpm --filter @pretable/app-streaming-demo dev` shows the unchanged Bloomberg-Terminal aesthetic. No `@pretable/ui`-consuming surface remains visually cream.

## 5. `apps/website` scaffold (PR-B)

### Directory layout

```
apps/website/
  app/
    layout.tsx
    page.tsx
    globals.css
    components/
      Hero.tsx
      PlaygroundSection.tsx
      AmbientBlob.tsx
      ScrollAnchor.tsx
      CopyCommand.tsx
  public/
    (empty for Phase 1; Phase 2 may add og-image.png, icons, etc.)
  next.config.ts
  postcss.config.mjs
  tsconfig.json
  package.json
  README.md
  .gitignore
```

### `package.json`

```jsonc
{
  "name": "@pretable/app-website",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "prepare:deps": "pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable/react build && pnpm --filter @pretable/ui build",
    "predev": "pnpm run prepare:deps",
    "dev": "next dev",
    "prebuild": "pnpm run prepare:deps",
    "build": "next build",
    "prestart": "pnpm run prepare:deps",
    "start": "next start",
    "lint": "next lint --dir app",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fontsource-variable/fraunces": "^5.2.9",
    "@fontsource-variable/inter": "^5.x.x",
    "@fontsource-variable/jetbrains-mono": "^5.x.x",
    "@pretable-internal/scenario-data": "workspace:*",
    "@pretable/react": "workspace:*",
    "@pretable/ui": "workspace:*",
    "next": "^16.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.2.4",
    "@types/node": "^25.x.x",
    "@types/react": "^19.x.x",
    "@types/react-dom": "^19.x.x",
    "tailwindcss": "^4.2.4",
    "typescript": "^5.x.x"
  }
}
```

### `next.config.ts`

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // No special webpack/turbopack overrides for Phase 1.
  // MDX support is Phase 2; Shiki/etc. defer until then.
};

export default config;
```

### `postcss.config.mjs`

```mjs
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};
export default config;
```

### `tsconfig.json`

Mirror dawn's tsconfig (Next.js 16 + strict + RSC-aware). Concretely:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### `globals.css`

```css
@import "@fontsource-variable/fraunces/wght.css";
@import "@fontsource-variable/fraunces/wght-italic.css";
@import "@fontsource-variable/inter/wght.css";
@import "@fontsource-variable/jetbrains-mono/wght.css";
@import "@pretable/ui/tokens.css";
@import "@pretable/ui/components.css";
@import "tailwindcss";

@theme inline {
  --color-bg-page: var(--pt-bg-page);
  --color-bg-card: var(--pt-bg-card);
  --color-bg-raised: var(--pt-bg-raised);
  --color-rule: var(--pt-rule);
  --color-rule-soft: var(--pt-rule-soft);
  --color-text-primary: var(--pt-text-primary);
  --color-text-secondary: var(--pt-text-secondary);
  --color-text-muted: var(--pt-text-muted);
  --color-accent: var(--pt-accent);
  --color-accent-deep: var(--pt-accent-deep);
  --color-accent-soft: var(--pt-accent-soft);
  --color-grid-bg: var(--pt-grid-bg);
  --color-grid-raised: var(--pt-grid-raised);
  --color-grid-rule: var(--pt-grid-rule);
  --color-grid-text: var(--pt-grid-text);
  --color-grid-dim: var(--pt-grid-dim);
  --color-sev-info: var(--pt-sev-info);
  --color-sev-warn: var(--pt-sev-warn);
  --color-sev-err: var(--pt-sev-err);
  --color-sev-ok: var(--pt-sev-ok);

  --font-display: var(--pt-font-serif);
  --font-sans: var(--pt-font-sans);
  --font-mono: var(--pt-font-mono);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100vh;
  scroll-behavior: smooth;
}

body {
  font-family: var(--font-sans);
  color: var(--pt-text-primary);
  background: var(--pt-bg-page);
  -webkit-font-smoothing: antialiased;
}

/* Grid section internals — InspectionGrid emits `inspection-*` class names */
#grid [data-pretable-scroll-viewport] {
  background: var(--pt-grid-bg);
  height: 460px;
  overflow: auto;
  position: relative;
  outline: none;
}
#grid [data-pretable-scroll-viewport]:focus-visible {
  box-shadow: inset 0 0 0 2px var(--pt-accent);
}
#grid .inspection-header-row {
  display: grid;
  position: sticky;
  top: 0;
  z-index: 6;
  border-bottom: 1px solid var(--pt-grid-rule);
  background: var(--pt-grid-raised);
}
#grid .inspection-header-cell {
  display: grid;
  gap: 4px;
  align-items: start;
  min-height: 52px;
  border-right: 1px solid var(--pt-grid-rule);
  background: inherit;
  color: var(--pt-grid-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 14px 12px;
  text-align: left;
  cursor: pointer;
}
#grid .inspection-header-cell.is-filtered { border-bottom: 2px solid var(--pt-accent); }
#grid .sort-indicator { color: var(--pt-accent); font-size: 11px; opacity: 0.6; }
#grid .inspection-row {
  display: grid;
  position: absolute;
  inset-inline: 0;
  border-bottom: 1px solid var(--pt-grid-rule);
  cursor: pointer;
}
#grid .inspection-row:hover .inspection-cell { background: var(--pt-grid-raised); }
#grid .inspection-cell {
  display: grid;
  gap: 6px;
  padding: 12px;
  background: var(--pt-grid-bg);
  border-right: 1px solid var(--pt-grid-rule);
  color: var(--pt-grid-text);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.52;
}
#grid .inspection-cell[data-pinned="left"] { z-index: 3; background: var(--pt-grid-raised); }
#grid .inspection-cell[data-selected="true"] {
  background: color-mix(in oklab, var(--pt-accent) 14%, var(--pt-grid-bg));
}
#grid .inspection-cell[data-focused="true"] {
  outline: 1px solid var(--pt-accent);
  outline-offset: -1px;
}
#grid .inspection-cell-label {
  color: var(--pt-grid-dim);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
#grid .inspection-cell-value {
  color: var(--pt-grid-text);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
```

### `app/layout.tsx`

```tsx
import { Footer, Nav } from "@pretable/ui";
import type { Metadata, Viewport } from "next";

import "./globals.css";

const APP_VERSION = process.env.npm_package_version ?? "0.0.0";

export const metadata: Metadata = {
  title: "pretable",
  description: "The grid that treats scroll as a first-class feature.",
};

export const viewport: Viewport = {
  themeColor: "#0b1120",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav active="website" version={APP_VERSION} />
        <main>{children}</main>
        {/* TODO(ci-signal): wire ciStatus to a real source once CI status plumbing exists.
            Hardcoded "green" for now — parity with apps/playground/src/app.tsx. */}
        <Footer version={APP_VERSION} ciStatus="green" />
      </body>
    </html>
  );
}
```

Note: `process.env.npm_package_version` is what Next.js resolves at build time when the build runs via `pnpm run build` (which runs scripts inside the package context). Fallback `"0.0.0"` covers any edge case.

### `app/page.tsx`

```tsx
import { Hero } from "./components/Hero";
import { PlaygroundSection } from "./components/PlaygroundSection";

export default function HomePage() {
  return (
    <>
      <Hero />
      <PlaygroundSection />
    </>
  );
}
```

## 6. Hero + Playground section (PR-B)

### `app/components/Hero.tsx`

Server component (no client hooks).

```tsx
import { AmbientBlob } from "./AmbientBlob";
import { CopyCommand } from "./CopyCommand";

export function Hero() {
  return (
    <section className="relative isolate px-7 py-24 md:py-32 lg:py-40">
      <AmbientBlob className="absolute -top-32 left-1/2 -translate-x-1/2 size-[640px]" />
      <div className="relative mx-auto max-w-[860px] text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          $ pretable — vol. 2 · no. 1
        </p>
        <h1 className="mt-4 font-display text-[40px] leading-[1.02] tracking-[-0.025em] text-text-primary md:text-[56px] md:leading-none">
          The grid that treats{" "}
          <em className="italic text-accent">scroll</em>{" "}
          as a first-class feature.
        </h1>
        <p className="mx-auto mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          500k rows. 60fps scroll. Selection survives filters. Built on a
          deterministic engine you can read.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#grid"
            className="inline-flex items-center gap-2 rounded-[4px] bg-accent px-5 py-2.5 text-[13px] font-semibold text-bg-page hover:bg-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            Try the playground ↓
          </a>
          <CopyCommand command="npm i @pretable/react" />
        </div>
      </div>
    </section>
  );
}
```

### `app/components/AmbientBlob.tsx`

Server-renderable. Pure decoration.

```tsx
interface AmbientBlobProps {
  className?: string;
  color?: string;
}

export function AmbientBlob({
  className,
  color = "rgba(56, 189, 248, 0.12)",
}: AmbientBlobProps) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none rounded-full ${className ?? ""}`}
      style={{
        background: `radial-gradient(circle at center, ${color}, transparent 70%)`,
        filter: "blur(40px)",
      }}
    />
  );
}
```

### `app/components/CopyCommand.tsx`

Client component (uses `useState`). Direct port of `apps/playground/src/copy-command.tsx` with a `"use client"` directive at the top and Tailwind classes updated to consume the new token names. Behavior identical: pill button, copies the command (without `$ `) to clipboard, flashes `✓ copied` for 1.2s.

### `app/components/ScrollAnchor.tsx`

Optional. The hero's primary CTA uses a plain `<a href="#grid">` and the `html { scroll-behavior: smooth }` rule in globals.css handles the smooth scroll natively. No JS needed for Phase 1. This file ships as a placeholder for Phase 2 when more sophisticated scroll behavior may be needed (e.g., scrollspy on body sections). For Phase 1, it's not created.

### `app/components/PlaygroundSection.tsx`

Client component (`"use client"`). Direct port of `apps/playground/src/pitch-grid.tsx` with:

1. `"use client"` directive at the top.
2. The wrapping `<section>` keeps `id="grid"`.
3. Imports `InspectionGrid`, `PretableTelemetry` from `@pretable/react/internal`.
4. Imports scenario data from `@pretable-internal/scenario-data`.
5. Tailwind class strings update to the new token names (`bg-grid-bg` stays, `text-amber` becomes `text-accent`, etc.).
6. Uses the same `useMemo`-stable `rows` pattern (`[...dataset.rows]`) so the engine sees a stable reference.

The grid section renders below the hero at `id="grid"`. Internal class-name styling (`.inspection-header-cell` etc.) is provided by the `#grid {...}` rules in `globals.css` (§5).

**Why a copy and not a shared package:** the long-term plan is to retire `apps/playground` in Phase 3. A short-lived duplicate is cheaper than designing a sharable component API and resolving two consumers. When playground retires, the website's copy is the canonical version and we delete the playground original.

## 7. Testing

### What we test in Phase 1

PR-A:
- `pnpm test` across the entire monorepo stays green. Bench (42), playground (21), package suites all pass.
- `pnpm typecheck` clean.
- `pnpm lint` clean.
- `pnpm format` clean.
- `pnpm build` green.

PR-B:
- `pnpm --filter @pretable/app-website typecheck` clean.
- `pnpm --filter @pretable/app-website lint` clean (Next's built-in linter on `app/`).
- `pnpm --filter @pretable/app-website build` produces a `.next/` output without errors.
- The full `pnpm` repo-wide commands above continue to be green.

### What we explicitly do NOT test in Phase 1

- Unit tests for `Hero`, `PlaygroundSection`, `CopyCommand`, `AmbientBlob`. These would require either:
  - Jest + react-testing-library configured for Next.js + RSC (significant setup), or
  - Vitest with `@testing-library/react` ported to Next's environment (mostly works but has rough edges with server/client boundaries).
  Phase 2 introduces the test setup when the body sections justify it.
- Visual regression / Percy / screenshot tests — out of scope for the entire pivot.
- E2E tests for the website — `apps/bench/tests/bench.spec.ts` is the existing Playwright surface; a website e2e test belongs in Phase 2 or 3.

### Manual verification before each PR merge

PR-A:
- `pnpm --filter @pretable/app-bench dev` boots; bench renders cool-slate; scenario panel + preview panel + run toolbar all functional; clicking through a bench run still works; Nav tab "bench" highlights active.
- `pnpm --filter @pretable/app-playground dev` boots; playground renders cool-slate; hero + grid section + receipts band all visible; CTAs work; Nav tab — note: there's no longer a "playground" tab in `LINKS`, so playground's `<Nav active="playground">` won't visually highlight anything. Acceptable because playground is being retired.

PR-B:
- `pnpm --filter @pretable/app-website dev` boots Next.js dev server; root URL renders hero + grid section; clicking "Try the playground ↓" smooth-scrolls to grid; copy-command flashes `✓ copied` and clipboard contains `npm i @pretable/react`; grid scale change re-derives dataset; row click highlights amber-blue; filter inputs work.
- `pnpm --filter @pretable/app-website build && pnpm --filter @pretable/app-website start` boots a production build; same checklist passes.
- Network tab: Fraunces Variable + Inter Variable + JetBrains Mono Variable WOFF2 files load; no `font-display: block` flash beyond the initial fallback.

## 8. Out of scope / related follow-ups

**Phase 1 explicitly defers:**

- AI-startup body sections (Phase 2): problem section, solution section, the-stack section, comparison table, deploy section, ecosystem section, CTA section. Each modeled on dawn's equivalents but adapted to pretable's product story.
- ScrollReveal entrance animations + multi-blob ambient narrative (Phase 2). Phase 1 has one ambient blob behind the hero; Phase 2 introduces a 4-6 blob narrative across the page.
- MDX content support, content collections, Shiki syntax highlighting (Phase 2 or later).
- Retiring `apps/playground` (Phase 3). The cool-slate reskin happens in PR-A; the deletion happens in Phase 3.
- Dropping `"playground"` from the `NavPage` union (Phase 3 — after the app is gone).
- Updating `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` to reflect the cool-slate pivot. The spec stays as historical context; Phase 2 either updates it or replaces it with a new spec.
- Vercel project / domain wiring. Phase 1 ships a deployable Next.js app; the user wires deployment manually when ready.
- Theming-architecture decisions for external `@pretable/*` consumers (still tracked separately).
- Geist font. Phase 1 uses Inter as the geometric-sans choice; Geist is a future option if Inter feels generic.

**Follow-ups surfaced during brainstorming:**

- The visual-system-design §2 "no competitor uses warm amber" gap argument is now invalidated by the cool-slate pivot. The user has weighed this. When the visual system spec is updated in Phase 2, that gap argument needs to be retired or replaced (e.g., "no competitor pairs Fraunces serif emphasis on a cool-slate base").
- `playground`'s `<Nav active="playground">` will not highlight any link in the LINKS array after PR-A (because the link is removed). Acceptable as a transitional state until Phase 3 retires playground entirely.
- The existing `apps/playground/src/pitch-grid.tsx` and `apps/website/app/components/PlaygroundSection.tsx` will be near-duplicates between PR-B and Phase 3. If Phase 2 lands before Phase 3, both components may need parallel updates. Document in Phase 3's spec that website's copy is the canonical version once playground is deleted.

## 9. Rollback

Each PR is a single squash-merge unit and can be reverted independently:

- **PR-A revert** restores cream/amber `@pretable/ui` tokens. Bench and playground revert to their pre-pivot palettes. No database / data / external state to worry about.
- **PR-B revert** removes `apps/website/` from the tree. PR-A's token retune stays in place — bench remains cool-slate. The "no website" state is otherwise unchanged.

Git operations only. No data migrations, no external config changes, no published artifacts touched.

## 10. Risks

| Risk                                                                          | Mitigation                                                                                                                               |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Token rename misses a `var(--pt-cream)` somewhere; UI breaks invisibly        | Grep audit of `packages/`, `apps/` for old token names after the rename pass. Manual visual verification on bench and playground both.   |
| `@pretable/ui` consumers outside the monorepo (none today, but future)        | The rename is strictly internal as long as `@pretable/ui` isn't published. Phase 3+ work tracks the publishing question.                 |
| Next.js 16 + Vite + pnpm workspace interop has known sharp edges              | Copy dawn's known-good configs (next.config.ts, postcss.config.mjs, tsconfig.json) rather than improvise.                                |
| RSC vs client component boundary mistakes                                     | `PlaygroundSection.tsx` and `CopyCommand.tsx` are explicitly `"use client"`; everything else stays server-rendered. Document in PR body. |
| Font flash / CLS during initial paint                                          | Fraunces / Inter / JetBrains Mono all use fontsource-variable WOFF2 (subset, ~30-40KB each). `font-display: swap` default + serif fallback. |
| `process.env.npm_package_version` doesn't resolve at build time               | Tested by `pnpm build`. Fallback `"0.0.0"` covers any edge case.                                                                          |
| Bench or playground tests assert on a specific cream/amber color value        | Tests scanned; current tests are behavior-focused, not color-focused. If any color assertion exists, update the test alongside the rename. |
| `apps/playground` reskin produces a visually-broken interim state             | Acceptable — the playground is being retired in Phase 3 anyway. As long as it doesn't crash, transitional weirdness is fine.              |

## 11. Success criteria

Phase 1 is successful if:

1. **PR-A:** `@pretable/ui`'s tokens.css uses semantic-not-color names with cool-slate values; `components.css` references the new names. Bench and playground both build, pass tests, and visually render cool-slate. Repo-wide CI green.
2. **PR-B:** `apps/website` builds via `next build` with no errors; `pnpm --filter @pretable/app-website dev` renders a hero + grid section at `/`; the hero's primary CTA smooth-scrolls to the grid; the grid is fully interactive (scale change, row select, filter input).
3. The Nav at the top of the website shows `pretable / bench / docs / github` with `pretable` as the active tab. Footer renders with `ciStatus="green"` and the version string.
4. The visual identity across bench + playground + website is consistent: same cool-slate palette, same Fraunces serif on display, same Inter sans on body. (`apps/streaming-demo` keeps its independent Bloomberg-terminal aesthetic by design.)
5. No new failing tests anywhere. CI dry-run (`pnpm test && pnpm typecheck && pnpm lint && pnpm format && pnpm build`) is green at HEAD.
6. Phase 2 has clean ground to start on: an established website app, a known-good build pipeline, hero + grid components to compose body sections beside, a stable token set.

---

**End of spec.** Implementation plan follows via `superpowers:writing-plans` after user approval.

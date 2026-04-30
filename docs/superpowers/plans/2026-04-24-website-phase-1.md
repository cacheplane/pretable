# Website Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot pretable's web identity to a cool-slate AI-startup aesthetic. Phase 1 lands as TWO sequential PRs: PR-A retunes `@pretable/ui` design tokens (cream/amber → cool-slate/cyan, with semantic-not-color names) and migrates bench + playground; PR-B scaffolds a new `apps/website` Next.js 16 app with a centered hero plus a live playground grid section directly below.

**Architecture:** PR-A is a coordinated rename: tokens.css source-of-truth change + components.css var() updates + nav.tsx LINKS changes + bench's app.css migration + playground's app.css/pitch-grid.css/5 component-file Tailwind class migrations. Squash-merges as one logical unit. PR-B is greenfield: a new Next.js 16 + Tailwind v4 + MDX-ready app at `apps/website/` consuming the post-PR-A tokens, with `<Hero>`, `<PlaygroundSection>`, `<AmbientBlob>`, `<CopyCommand>` components and a smooth-scrolling anchor from hero to grid. `apps/streaming-demo` is untouched (independent Bloomberg-terminal theme).

**Tech Stack:** TypeScript 5, Tailwind v4 (`@tailwindcss/vite` for bench/playground, `@tailwindcss/postcss` for website), Next.js 16 App Router (RSC + client components for PlaygroundSection/CopyCommand), `@pretable/ui` (workspace), `@pretable/react/internal`, `@pretable-internal/scenario-data`, Fraunces / Inter / JetBrains Mono via `@fontsource-variable/*`.

---

## File Structure

### PR-A files (touched in token rename)

**Modified:**
```
packages/ui/src/tokens.css                          // wholesale rewrite (new names + cool-slate values)
packages/ui/src/components.css                      // search-replace var() references
packages/ui/src/nav.tsx                             // NavPage union widens; LINKS changes
apps/bench/src/app.css                              // @theme inline map + class rules
apps/playground/src/app.css                         // @theme inline map
apps/playground/src/pitch-grid.css                  // var() references
apps/playground/src/pitch-hero.tsx                  // Tailwind class strings
apps/playground/src/pitch-grid.tsx                  // Tailwind class strings
apps/playground/src/receipts-band.tsx               // Tailwind class strings
apps/playground/src/copy-command.tsx                // Tailwind class strings
apps/playground/src/streaming-proof.tsx             // Tailwind class strings
```

**Untouched in PR-A:**
- `apps/streaming-demo` (independent Bloomberg-terminal theme; doesn't import @pretable/ui tokens)
- All test files (assertions are behavior-focused, not color-focused)
- `apps/bench/src/bench-app.tsx` and adapter files (bench's color usage lives entirely in `app.css`)

### PR-B files (apps/website scaffold)

**Created:**
```
apps/website/
  app/
    layout.tsx                                       // Nav/Footer wrap, font imports, metadata
    page.tsx                                         // <Hero /> <PlaygroundSection />
    globals.css                                      // imports + @theme inline + body defaults + #grid styles
    components/
      Hero.tsx                                       // server component: eyebrow + headline + dek + 2 CTAs
      PlaygroundSection.tsx                          // "use client" — InspectionGrid wrapper
      AmbientBlob.tsx                                // server component: decorative gradient
      CopyCommand.tsx                                // "use client" — pill CTA with clipboard write
  public/                                            // (empty placeholder; Phase 2 may add og-image, icons)
  next.config.ts
  postcss.config.mjs
  tsconfig.json
  package.json
  README.md
  .gitignore
```

**Untouched in PR-B:** anything outside `apps/website/`. PR-A's token + nav + migrations are pre-merged before PR-B starts.

---

## Token rename mapping (reference table for PR-A)

This table is the canonical source for the search-replace work in PR-A. Keep it open while editing.

| Old name (current `tokens.css`) | New name              | Old hex     | New hex    | Status                                  |
| ------------------------------- | --------------------- | ----------- | ---------- | --------------------------------------- |
| `--pt-cream`                    | `--pt-bg-page`        | `#ede5d4`   | `#0b1120`  | rename + revalue                        |
| `--pt-cream-hi`                 | `--pt-bg-card`        | `#f5eedd`   | `#0f172a`  | rename + revalue                        |
| `--pt-cream-lo`                 | `--pt-bg-raised`      | `#e0d6bf`   | `#1e293b`  | rename + revalue                        |
| `--pt-cream-rule`               | `--pt-rule`           | `#cdc3aa`   | `#1e293b`  | rename + revalue                        |
| `--pt-ink`                      | `--pt-text-primary`   | `#1a1815`   | `#e2e8f0`  | rename + revalue                        |
| `--pt-ink-hover`                | `--pt-bg-raised`      | `#0a0806`   | `#1e293b`  | dropped; use `--pt-bg-raised`           |
| `--pt-ink-dim`                  | `--pt-text-secondary` | `#4a443b`   | `#94a3b8`  | rename + revalue                        |
| `--pt-ink-softer`               | `--pt-text-muted`     | `#7a7468`   | `#64748b`  | rename + revalue                        |
| `--pt-amber-ink`                | `--pt-accent-deep`    | `#8a5d0f`   | `#0284c7`  | rename + revalue                        |
| `--pt-amber-ink-dark`           | `--pt-accent-deep`    | `#7d4f0a`   | `#0284c7`  | dropped; folded into `--pt-accent-deep` |
| `--pt-amber`                    | `--pt-accent`         | `#c68a1e`   | `#38bdf8`  | rename + revalue                        |
| `--pt-amber-soft`               | `--pt-accent-soft`    | `#f5e8ca`   | `#1e3a52`  | rename + revalue                        |
| `--pt-dark`                     | (kept name)           | `#0f0e0c`   | `#020617`  | retune only                             |
| `--pt-grid-bg`                  | (kept name)           | `#0b0a09`   | `#0a0f1a`  | retune only                             |
| `--pt-grid-head`                | `--pt-grid-raised`    | `#0d0c0a`   | `#0d1426`  | dropped; use `--pt-grid-raised`         |
| `--pt-grid-raised`              | (kept name)           | `#151310`   | `#0d1426`  | retune only                             |
| `--pt-grid-rule`                | (kept name)           | `#1f1c18`   | `#131b2c`  | retune only                             |
| `--pt-grid-text`                | (kept name)           | `#d8d2c3`   | `#cbd5e1`  | retune only                             |
| `--pt-grid-dim`                 | (kept name)           | `#8f8a7d`   | `#64748b`  | retune only                             |
| `--pt-sev-*`                    | (unchanged)           | (unchanged) | (unchanged)| no change — domain colors               |
| `--pt-code-*`                   | (unchanged)           | (unchanged) | (unchanged)| no change — Phase 2 may revisit         |
| `--pt-font-serif`               | (kept name)           | "Fraunces"  | "Fraunces Variable" + serif fallback | family literal updated  |
| `--pt-font-sans`                | (kept name)           | system stack| "Inter Variable" + system fallback   | new — wires Inter font  |
| `--pt-font-mono`                | (kept name)           | system stack| "JetBrains Mono Variable" + fallback | new — wires JetBrains   |
| `--pt-fs-*`, `--pt-page-max`, `--pt-header-h`, `--pt-sidebar-w`, `--pt-toc-w`, `--pt-prose-max`, `--pt-code-max`, `--pt-modal-w` | (unchanged) | (unchanged) | (unchanged) | layout tokens — no change |

---

## Tailwind class string mapping (for the 5 playground TSX files in PR-A Task 7)

| Old class              | New class                    |
| ---------------------- | ---------------------------- |
| `bg-cream`             | `bg-bg-page`                 |
| `bg-cream-hi`          | `bg-bg-card`                 |
| `text-ink`             | `text-text-primary`          |
| `text-ink-dim`         | `text-text-secondary`        |
| `text-ink-softer`      | `text-text-muted`            |
| `text-amber-ink`       | `text-accent-deep`           |
| `text-amber`           | `text-accent`                |
| `text-cream-hi`        | `text-bg-card`               |
| `border-cream-rule`    | `border-rule`                |
| `border-ink`           | `border-text-primary`        |
| `bg-ink`               | `bg-text-primary`            |
| `hover:bg-ink`         | `hover:bg-bg-raised`         |
| `hover:bg-ink/90`      | `hover:bg-bg-raised`         |
| `hover:text-cream-hi`  | `hover:text-bg-card`         |
| `focus-visible:ring-amber-ink` | `focus-visible:ring-accent` |
| `focus-visible:ring-offset-cream` | `focus-visible:ring-offset-bg-page` |
| `bg-grid-bg`           | (unchanged)                  |
| `bg-grid-raised`       | (unchanged)                  |
| `border-grid-rule`     | (unchanged)                  |
| `text-grid-text`       | (unchanged)                  |
| `text-grid-dim`        | (unchanged)                  |
| `placeholder:text-grid-dim` | (unchanged)             |
| `focus:border-amber`   | `focus:border-accent`        |
| `bg-transparent text-amber` | `bg-transparent text-accent` |

Note: `bg-text-primary` reads awkwardly (text color used as a bg), but this is what dawn does (`bg-text-primary` is a real class that resolves to `var(--color-text-primary)`). The semantic naming is intentional — primary-text is also the inverse-bg color in a dark theme.

---

# PR-A — Token rename + bench/playground migration

## Branch setup for PR-A

This plan was committed on branch `feat/website-phase-1` (off `origin/main` at `35526a3`). The PR-A work continues on this branch — the spec + plan commits ride along into PR-A's diff (acceptable; they're the introduction of the new docs anyway). After PR-A merges, branch `feat/website-phase-2` (or similar) starts off fresh main for PR-B.

**Verify branch state before starting:**
```bash
cd /Users/blove/repos/pretable/.claude/worktrees/pedantic-joliot-7e6d20
git status
# Expected: on feat/website-phase-1, clean tree, HEAD = a9f3704 (spec) or one commit later (plan)
```

## PR-A Task 1: Rewrite `packages/ui/src/tokens.css`

Wholesale rewrite — keep the same file shape (`:root { ... }`) but with new names and cool-slate values. Layout tokens, type-scale tokens, severity tokens, syntax tokens stay; color tokens rename + revalue; font tokens add Inter and JetBrains Mono families.

**Files:**
- Modify: `packages/ui/src/tokens.css`

- [ ] **Step 1: Replace `tokens.css` content**

Replace the file at `packages/ui/src/tokens.css` with:

```css
/**
 * pretable design tokens
 *
 * Consumer imports this file once at the app's entry point. All component
 * styles in components.css reference these variables. To retheme, override
 * any variable at a more specific scope (e.g. [data-theme="dark"]).
 *
 * Cool-slate AI-startup palette (2026-04-24 pivot — see
 * docs/superpowers/specs/2026-04-24-website-phase-1-design.md).
 */
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

  /* Grid surfaces (always-dark family, cooler than before) */
  --pt-dark: #020617;
  --pt-grid-bg: #0a0f1a;
  --pt-grid-raised: #0d1426;
  --pt-grid-rule: #131b2c;
  --pt-grid-text: #cbd5e1;
  --pt-grid-dim: #64748b;

  /* Severity — only saturated colors in the system (unchanged) */
  --pt-sev-info: #6fa9c9;
  --pt-sev-warn: #d9a44f;
  --pt-sev-err: #d3615a;
  --pt-sev-ok: #7ea86f;

  /* Syntax highlighting (maps to severity family — unchanged) */
  --pt-code-key: #d9a44f;
  --pt-code-str: #7ea86f;
  --pt-code-fn: #6fa9c9;
  --pt-code-com: #6a6359;
  --pt-code-prop: #c9a47e;

  /* Typography stacks — Fraunces + Inter + JetBrains Mono via fontsource */
  --pt-font-serif: "Fraunces Variable", Georgia, "Times New Roman", serif;
  --pt-font-sans:
    "Inter Variable", ui-sans-serif, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --pt-font-mono:
    "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo,
    "Cascadia Code", "Roboto Mono", monospace;

  /* Type scale (unchanged) */
  --pt-fs-display-xl: 60px;
  --pt-fs-display-lg: 44px;
  --pt-fs-display-md: 32px;
  --pt-fs-dek: 18px;
  --pt-fs-body: 15px;
  --pt-fs-ui: 13.5px;
  --pt-fs-eyebrow: 11px;
  --pt-fs-data: 12.5px;

  /* Layout tokens (unchanged) */
  --pt-page-max: 1440px;
  --pt-header-h: 60px;
  --pt-sidebar-w: 260px;
  --pt-toc-w: 224px;
  --pt-prose-max: 720px;
  --pt-code-max: 900px;
  --pt-modal-w: 560px;
}
```

Note: `--pt-cream`, `--pt-cream-hi`, `--pt-cream-lo`, `--pt-cream-rule`, `--pt-ink`, `--pt-ink-hover`, `--pt-ink-dim`, `--pt-ink-softer`, `--pt-amber-ink`, `--pt-amber-ink-dark`, `--pt-amber`, `--pt-amber-soft`, `--pt-grid-head` no longer exist after this rewrite. Tasks 2-7 update consumers to use the new names.

- [ ] **Step 2: Verify `tokens.css` parses (no other consumers built yet)**

```bash
cd packages/ui
pnpm build 2>&1 | tail -10
```

Expected: build succeeds. The package builds CSS via tsup's static asset copy, not parsing — so a syntax error in tokens.css won't surface here. The real test is when a consumer imports it (Task 4+).

- [ ] **Step 3: Don't commit yet**

The intermediate state (tokens.css updated, components.css still using old names) breaks every consumer. Tasks 2-7 land together as one logical change. Hold the commit until the bottom of Task 8 (or commit each task and let squash-merge collapse the broken intermediates — either is fine, the latter is more recoverable mid-flight).

The conservative path is: commit each task and let squash-merge collapse. Pick that.

```bash
git add packages/ui/src/tokens.css
git commit -m "refactor(ui): retune tokens.css to cool-slate with semantic names"
```

---

## PR-A Task 2: Update `packages/ui/src/components.css`

Replace all `var(--pt-old-name)` references with new names per the mapping table. The file is 343 lines with ~30 `var(--pt-*)` references for renamed tokens. Do this as a search-replace pass.

**Files:**
- Modify: `packages/ui/src/components.css`

- [ ] **Step 1: Run the search-replace pass**

Apply these substitutions to `packages/ui/src/components.css` IN ORDER (the order matters because some new names are prefixes of old names):

1. `var(--pt-cream-rule)` → `var(--pt-rule)`
2. `var(--pt-cream-hi)` → `var(--pt-bg-card)`
3. `var(--pt-cream-lo)` → `var(--pt-bg-raised)`
4. `var(--pt-cream)` → `var(--pt-bg-page)`
5. `var(--pt-ink-hover)` → `var(--pt-bg-raised)`
6. `var(--pt-ink-dim)` → `var(--pt-text-secondary)`
7. `var(--pt-ink-softer)` → `var(--pt-text-muted)`
8. `var(--pt-ink)` → `var(--pt-text-primary)`
9. `var(--pt-amber-ink-dark)` → `var(--pt-accent-deep)`
10. `var(--pt-amber-ink)` → `var(--pt-accent-deep)`
11. `var(--pt-amber-soft)` → `var(--pt-accent-soft)`
12. `var(--pt-amber)` → `var(--pt-accent)`
13. `var(--pt-grid-head)` → `var(--pt-grid-raised)`

Use your editor's find-replace (or `sed -i ''` on macOS, but be careful with the order). Severity tokens, syntax-highlight tokens, font/font-size/layout tokens stay as-is.

- [ ] **Step 2: Verify no old names remain**

```bash
grep -nE "var\(--pt-(cream|ink|amber|grid-head)" packages/ui/src/components.css
```

Expected: NO output (empty result). If any line surfaces, fix it manually with the appropriate new name from the mapping table.

- [ ] **Step 3: Build the package**

```bash
pnpm --filter @pretable/ui build
```

Expected: PASS. The CSS files copy to `packages/ui/dist/`.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components.css
git commit -m "refactor(ui): rename var() references in components.css to new token names"
```

---

## PR-A Task 3: Update `packages/ui/src/nav.tsx`

Add `"website"` to the `NavPage` union; change `LINKS` to point the home tab at `"website"` instead of `"playground"`. Keep `"playground"` in the union (so existing consumers' `<Nav active="playground">` typechecks) but remove its link entry.

**Files:**
- Modify: `packages/ui/src/nav.tsx`

- [ ] **Step 1: Edit the type and LINKS array**

Open `packages/ui/src/nav.tsx`. Find this block near the top:

```tsx
export type NavPage = "playground" | "bench" | "docs" | "github";

export interface NavCta {
  label: string;
  href: string;
}

export interface NavProps {
  active: NavPage;
  version?: string;
  githubStars?: number;
  cta?: NavCta;
  onSearchClick?: () => void;
  className?: string;
}

const LINKS: Array<{ id: NavPage; label: string; href: string }> = [
  { id: "playground", label: "playground", href: "/" },
  { id: "bench", label: "bench", href: "/bench" },
  { id: "docs", label: "docs", href: "/docs" },
  {
    id: "github",
    label: "github",
    href: "https://github.com/cacheplane/pretable",
  },
];
```

Replace with:

```tsx
export type NavPage = "playground" | "website" | "bench" | "docs" | "github";

export interface NavCta {
  label: string;
  href: string;
}

export interface NavProps {
  active: NavPage;
  version?: string;
  githubStars?: number;
  cta?: NavCta;
  onSearchClick?: () => void;
  className?: string;
}

const LINKS: Array<{ id: NavPage; label: string; href: string }> = [
  { id: "website", label: "pretable", href: "/" },
  { id: "bench", label: "bench", href: "/bench" },
  { id: "docs", label: "docs", href: "/docs" },
  {
    id: "github",
    label: "github",
    href: "https://github.com/cacheplane/pretable",
  },
];
```

Key changes:
- `NavPage` adds `"website"` (kept `"playground"` for transitional compat)
- LINKS first entry is now `{ id: "website", label: "pretable", href: "/" }` — the home tab uses the brand wordmark and points at `/` (the website's homepage). The old `"playground"` link is gone.

Existing consumers (`apps/playground/src/app.tsx` with `<Nav active="playground">`) still typecheck because `"playground"` remains a valid `NavPage`. Their active marker won't visually highlight any link (since no link has `id="playground"`) — accepted transitional state.

- [ ] **Step 2: Verify package builds**

```bash
pnpm --filter @pretable/ui build
```

Expected: PASS. tsc emits clean dts.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/nav.tsx
git commit -m "refactor(ui): add website to NavPage; replace playground link with brand home"
```

---

## PR-A Task 4: Update `apps/bench/src/app.css`

Update the `@theme inline` Tailwind block + bench-specific class rules to consume the new token names. Bench has no Tailwind utility classes referencing tokens in TSX (verified — all bench color usage lives in app.css), so no TSX edits needed.

**Files:**
- Modify: `apps/bench/src/app.css`

- [ ] **Step 1: Replace the `@theme inline` block**

Find the `@theme inline { ... }` block in `apps/bench/src/app.css`. Replace its entire contents with:

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

- [ ] **Step 2: Apply var() rename to bench-specific class rules**

The bench-specific class rules (`.bench-shell`, `.bench-hero h1`, `.eyebrow`, `.scenario-panel`, `.preview-panel`, `.scenario-card`, `.scenario-id`, `.run-toolbar button`, `.viewport-card`, `.result-grid dt`, `.result-grid dd`, `.result-json`, `.status-note`, etc.) use `var(--pt-cream*)` / `var(--pt-amber*)` / `var(--pt-ink*)` references. Apply the same search-replace ordered list from PR-A Task 2 Step 1 to this file:

1. `var(--pt-cream-rule)` → `var(--pt-rule)`
2. `var(--pt-cream-hi)` → `var(--pt-bg-card)`
3. `var(--pt-cream-lo)` → `var(--pt-bg-raised)`
4. `var(--pt-cream)` → `var(--pt-bg-page)`
5. `var(--pt-ink-hover)` → `var(--pt-bg-raised)`
6. `var(--pt-ink-dim)` → `var(--pt-text-secondary)`
7. `var(--pt-ink-softer)` → `var(--pt-text-muted)`
8. `var(--pt-ink)` → `var(--pt-text-primary)`
9. `var(--pt-amber-ink-dark)` → `var(--pt-accent-deep)`
10. `var(--pt-amber-ink)` → `var(--pt-accent-deep)`
11. `var(--pt-amber-soft)` → `var(--pt-accent-soft)`
12. `var(--pt-amber)` → `var(--pt-accent)`
13. `var(--pt-grid-head)` → `var(--pt-grid-raised)`

- [ ] **Step 3: Add Inter + JetBrains Mono font imports**

Find the existing `@import "@fontsource-variable/fraunces/wght.css"` and `@import "@fontsource-variable/fraunces/wght-italic.css"` lines at the top of `apps/bench/src/app.css`. Add these two lines immediately below them:

```css
@import "@fontsource-variable/inter/wght.css";
@import "@fontsource-variable/jetbrains-mono/wght.css";
```

- [ ] **Step 4: Install the new fontsource packages in bench**

From repo root:
```bash
pnpm --filter @pretable/app-bench add @fontsource-variable/inter @fontsource-variable/jetbrains-mono
```

Expected: bench's `package.json` gains both deps.

- [ ] **Step 5: Verify bench builds + tests pass**

```bash
pnpm --filter @pretable/app-bench typecheck
pnpm --filter @pretable/app-bench test
```

Expected: typecheck PASS; all bench unit tests pass (count = whatever's current on main).

If a test fails because it asserts a literal color value or an old class name, STOP and report — bench tests are supposed to be behavior-focused.

- [ ] **Step 6: Verify no old names remain in bench's CSS**

```bash
grep -nE "var\(--pt-(cream|ink|amber|grid-head)" apps/bench/src/app.css
```

Expected: NO output.

- [ ] **Step 7: Commit**

```bash
git add apps/bench/src/app.css apps/bench/package.json pnpm-lock.yaml
git commit -m "refactor(bench): migrate app.css to new @pretable/ui tokens; add Inter + JetBrains Mono"
```

---

## PR-A Task 5: Update `apps/playground/src/app.css`

Same `@theme inline` block update as bench, plus Inter + JetBrains Mono imports + dep installs. Playground's `app.css` does not have many bench-style class rules (most playground styling is Tailwind utility classes in the TSX files, handled in Task 7).

**Files:**
- Modify: `apps/playground/src/app.css`

- [ ] **Step 1: Replace the `@theme inline` block**

Same replacement as bench (PR-A Task 4 Step 1). Use the identical block content.

- [ ] **Step 2: Apply var() rename to any remaining `var(--pt-*)` references in playground's app.css**

Run the same ordered search-replace as Task 4 Step 2 against `apps/playground/src/app.css`. The file is shorter than bench's, so this should affect fewer lines.

- [ ] **Step 3: Add Inter + JetBrains Mono font imports**

Below the existing Fraunces `@import` lines in `apps/playground/src/app.css`, add:

```css
@import "@fontsource-variable/inter/wght.css";
@import "@fontsource-variable/jetbrains-mono/wght.css";
```

- [ ] **Step 4: Install the fontsource packages in playground**

```bash
pnpm --filter @pretable/app-playground add @fontsource-variable/inter @fontsource-variable/jetbrains-mono
```

- [ ] **Step 5: Verify no old names remain**

```bash
grep -nE "var\(--pt-(cream|ink|amber|grid-head)" apps/playground/src/app.css
```

Expected: NO output.

- [ ] **Step 6: Don't run tests yet — Task 6 + Task 7 still need to land for playground to compile**

Just verify the file looks correct. Move to Task 6.

- [ ] **Step 7: Commit**

```bash
git add apps/playground/src/app.css apps/playground/package.json pnpm-lock.yaml
git commit -m "refactor(playground): migrate app.css to new @pretable/ui tokens; add Inter + JetBrains Mono"
```

---

## PR-A Task 6: Update `apps/playground/src/pitch-grid.css`

This file is vanilla CSS (not Tailwind), styling InspectionGrid's emitted class names against the dark grid palette. Most rules already reference `--pt-grid-*` (which mostly stay), but a few use renamed tokens.

**Files:**
- Modify: `apps/playground/src/pitch-grid.css`

- [ ] **Step 1: Apply var() rename**

Run the same ordered search-replace as Task 4 Step 2 against `apps/playground/src/pitch-grid.css`. Most of the file uses `--pt-grid-*` which stays; the affected lines will be limited to whichever rules referenced cream/amber/ink/grid-head.

- [ ] **Step 2: Verify**

```bash
grep -nE "var\(--pt-(cream|ink|amber|grid-head)" apps/playground/src/pitch-grid.css
```

Expected: NO output.

- [ ] **Step 3: Commit**

```bash
git add apps/playground/src/pitch-grid.css
git commit -m "refactor(playground): rename var() references in pitch-grid.css"
```

---

## PR-A Task 7: Update playground TSX files (Tailwind utility classes)

Five playground files hard-code Tailwind utility class strings referencing the old token names. Each needs a class-string migration per the Tailwind class mapping table at the top of this plan.

**Files (5 total):**
- Modify: `apps/playground/src/copy-command.tsx`
- Modify: `apps/playground/src/pitch-hero.tsx`
- Modify: `apps/playground/src/pitch-grid.tsx`
- Modify: `apps/playground/src/receipts-band.tsx`
- Modify: `apps/playground/src/streaming-proof.tsx`

For each file, apply this ordered class-string substitution:

1. `bg-cream-hi` → `bg-bg-card`
2. `bg-cream` → `bg-bg-page`
3. `text-cream-hi` → `text-bg-card`
4. `text-ink-dim` → `text-text-secondary`
5. `text-ink-softer` → `text-text-muted`
6. `text-ink` → `text-text-primary`
7. `text-amber-ink` → `text-accent-deep`
8. `text-amber` → `text-accent`
9. `border-cream-rule` → `border-rule`
10. `border-ink` → `border-text-primary`
11. `bg-ink/90` → `bg-bg-raised`
12. `bg-ink` → `bg-text-primary`
13. `hover:bg-ink/90` → `hover:bg-bg-raised`
14. `hover:bg-ink` → `hover:bg-bg-raised`
15. `hover:text-cream-hi` → `hover:text-bg-card`
16. `focus-visible:ring-amber-ink` → `focus-visible:ring-accent`
17. `focus-visible:ring-offset-cream` → `focus-visible:ring-offset-bg-page`
18. `focus:border-amber` → `focus:border-accent`

**Note on order:** the substitution `bg-ink` → `bg-text-primary` is a prefix of `bg-ink/90`, so do `bg-ink/90` first (steps 11, 13) before the bare `bg-ink` (step 12, 14). Same logic for `text-ink-*` ordering.

- [ ] **Step 1: Migrate `apps/playground/src/copy-command.tsx`**

Open the file and apply the substitution list above. The relevant lines are 22-25 (the Tailwind class strings inside the `classes` array). After:

```tsx
const classes = [
  "inline-flex items-center gap-2 rounded-[2px] border border-text-primary bg-transparent",
  "px-[18px] py-[10px] font-mono text-[13px] text-text-primary",
  "hover:bg-bg-raised hover:text-bg-card transition-colors",
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
  className,
]
  .filter(Boolean)
  .join(" ");
```

- [ ] **Step 2: Migrate `apps/playground/src/pitch-hero.tsx`**

Apply the substitution list. The full migrated file should look like:

```tsx
import { Receipt } from "@pretable/ui";

import { CopyCommand } from "./copy-command";

export function PitchHero() {
  return (
    <section className="bg-bg-page text-text-primary border-b border-rule px-7 py-16 md:px-10">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent-deep">
          $ pretable — read-heavy wedge · vol. 1 · no. 4
        </p>
        <h1 className="mt-3 font-display text-[44px] leading-[1.02] tracking-[-0.025em] md:text-[60px] md:leading-none">
          the grid that treats{" "}
          <em className="italic text-accent-deep">scroll</em>{" "}
          as a first-class feature.
        </h1>
        <p className="mt-5 max-w-[760px] font-display text-[18px] leading-[1.44] text-text-secondary">
          {/* dek body content unchanged */}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href="#grid"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-[2px] bg-text-primary px-[18px] py-[12px] text-[13px] text-bg-card hover:bg-bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            Try the live playground ↓
          </a>
          <CopyCommand command="npm i @pretable/react" />
        </div>
      </div>
    </section>
  );
}
```

**IMPORTANT:** preserve the existing `{/* dek body content unchanged */}` placeholder — open the actual file and copy the dek's `<Receipt>` tags and copy text verbatim. Do NOT rewrite the dek text content; just rename the className strings.

- [ ] **Step 3: Migrate `apps/playground/src/pitch-grid.tsx`**

Apply the substitution list. The grid section's wrapper, chrome strip, scale select, and filter inputs all get className updates. Most of the existing Tailwind classes are `bg-grid-*` / `text-grid-*` / `border-grid-*` which stay unchanged. The changing classes are:
- `text-amber` → `text-accent` (in the scale select)
- `focus:border-amber` → `focus:border-accent` (in the filter input)

The full migrated file's wrapper and structure stay as-is; only those two changes apply. Verify by grepping after the edit:

```bash
grep -nE "(bg-cream|text-ink|amber|cream-)" apps/playground/src/pitch-grid.tsx
```
Expected: NO output.

- [ ] **Step 4: Migrate `apps/playground/src/receipts-band.tsx`**

Apply the substitution list. The migrated section looks like:

```tsx
<section className="bg-bg-page text-text-primary border-b border-rule px-7 py-[52px] md:px-10">
  <div className="mx-auto max-w-[1240px]">
    <h2 className="font-display text-[28px] leading-[1.12] tracking-[-0.02em] md:text-[32px]">
      <em className="italic text-accent-deep">Receipts</em>, not claims.
    </h2>
    <ul className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
      {STATS.map((stat) => (
        <li key={stat.caption} className="border-t border-text-primary pt-3">
          <div className="font-display text-[44px] leading-[1] tracking-[-0.02em]">
            {stat.value}
          </div>
          <div className="mt-1 font-mono text-[12px] text-text-secondary">
            {stat.caption}
          </div>
        </li>
      ))}
    </ul>
    <p className="mt-5 font-mono text-[12px] text-text-muted">
      <a
        href="/bench"
        className="text-accent-deep underline-offset-2 hover:underline"
      >
        See them re-run in the bench →
      </a>
    </p>
  </div>
</section>
```

**IMPORTANT:** the file's interface declarations, `STATS` const, and the `28-line provenance comment` above `STATS` are PRESERVED untouched. Only className strings inside the JSX change.

- [ ] **Step 5: Migrate `apps/playground/src/streaming-proof.tsx`**

Apply the substitution list. The file structure mirrors `receipts-band.tsx`. Key changes:
- Section wrapper: `bg-bg-page text-text-primary border-b border-rule`
- Eyebrow: `text-accent-deep`
- `<em>`: `text-accent-deep`
- Dek: `text-text-secondary`
- Stat list item: `border-t border-text-primary`
- Caption: `text-text-secondary`
- Primary CTA: `bg-text-primary ... text-bg-card hover:bg-bg-raised focus-visible:ring-accent focus-visible:ring-offset-bg-page`

Preserve the `METRICS` constant and its provenance comment (the H13 reference) verbatim — only className strings change.

- [ ] **Step 6: Verify all 5 TSX files have no old class names**

```bash
grep -nE "(bg-cream|text-ink|text-amber|border-cream|bg-amber|bg-ink|text-cream|border-ink)" apps/playground/src/*.tsx
```
Expected: NO output. (Note: `text-amber` is a substring of `text-amber-ink` — if the grep matches, double-check the line is genuinely the bare `text-amber` and apply rule 7 vs rule 8 from the substitution list.)

- [ ] **Step 7: Run playground tests + typecheck**

```bash
pnpm --filter @pretable/app-playground test
pnpm --filter @pretable/app-playground typecheck
```

Expected: PASS. Tests assert behavior (rendered text, role, aria-label, click behavior), not specific Tailwind class names — they should not break from class renames.

If a test does fail because of a class assertion, STOP and report — those tests need to be updated alongside the rename, but the change is small.

- [ ] **Step 8: Commit**

```bash
git add apps/playground/src/copy-command.tsx apps/playground/src/pitch-hero.tsx apps/playground/src/pitch-grid.tsx apps/playground/src/receipts-band.tsx apps/playground/src/streaming-proof.tsx
git commit -m "refactor(playground): migrate Tailwind classes to new @pretable/ui token names"
```

---

## PR-A Task 8: Repo-wide CI dry-run + manual smoke

**Files:** none modified in this task — verification only.

- [ ] **Step 1: Repo-wide test/typecheck/lint/format/build**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```

Expected: all green. Bench tests + playground tests + package suites + streaming-demo tests all pass. Typecheck clean. Lint clean. Format clean. Build clean.

If `pnpm format` flags any of the files we touched, run the repo's format-write equivalent (check `package.json` scripts), commit the formatting fix, and re-run.

If any step fails on files we DIDN'T touch (pre-existing repo issues), note them in the PR description but don't fix.

- [ ] **Step 2: Manual smoke — bench**

```bash
pnpm --filter @pretable/app-bench dev
```

Open the URL. Walk through:
- Header (Nav) shows `pretable / bench / docs / github` with `bench` highlighted as active. Brand is "pretable" (the wordmark from the LINKS update).
- Bench hero, scenario panel, preview panel render against cool-slate (dark navy bg, cyan accents, no cream anywhere).
- Click through a bench run; result JSON renders against `--pt-grid-*` (still dark, slightly cooler).
- Footer renders monospace one-liner with version + ci dot.

Ctrl-C out.

- [ ] **Step 3: Manual smoke — playground**

```bash
pnpm --filter @pretable/app-playground dev
```

Open the URL. Walk through:
- Nav at top: `pretable / bench / docs / github`. **`pretable` is the active tab visually... wait — playground's `<App>` calls `<Nav active="playground">`, not `"website"`. After the LINKS update, no link has `id="playground"`, so no link visually highlights as active. This is the documented transitional state.** The Nav still renders correctly; it just doesn't mark a tab as active. Acceptable.
- Hero, grid section, streaming-proof section, receipts band all render against cool-slate.
- Hero CTA "Try the live playground ↓" smooth-scrolls to grid section.
- Copy CTA "$ npm i @pretable/react" works (clipboard write + ✓ copied flash).
- Grid section: scale select changes dataset, row click highlights cyan-tinted, filter inputs work.
- Streaming-proof section: dek + 3 stats + button all render correctly.
- Receipts band: 4 stats + bench link.

Ctrl-C out.

- [ ] **Step 4: Manual smoke — streaming-demo**

```bash
pnpm --filter @pretable/app-streaming-demo dev
```

Open the URL. Walk through:
- The Bloomberg-terminal aesthetic is unchanged (yellow/black). Streaming-demo doesn't consume `@pretable/ui` tokens; PR-A should not affect it.
- Replay loads, stream advances, pipeline inspector shows.

Ctrl-C out.

- [ ] **Step 5: No commit needed for this task**

This task is verification-only. If everything passed, move to Task 9.

If something failed on our touched files, fix and commit a small `fix:` patch before moving to Task 9.

---

## PR-A Task 9: Push + open PR

**Files:** none modified — git operations only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/website-phase-1
```

Expected: branch pushes cleanly. If origin already has `feat/website-phase-1` (unlikely, but possible if a previous attempt was made), use `git push --force-with-lease`.

- [ ] **Step 2: Create PR-A**

```bash
gh pr create --title "refactor(ui,bench,playground): retune @pretable/ui tokens to cool-slate" --body "$(cat <<'EOF'
## Summary

PR-A of website Phase 1. Retunes `@pretable/ui` design tokens from cream/amber to cool-slate/cyan, with semantic-not-color names. Migrates all internal consumers (bench + playground) so the repo is internally consistent at HEAD. Bench and playground both cosmetically reskin to cool-slate on merge.

**This PR includes the Phase 1 spec + plan documents** (`docs/superpowers/specs/2026-04-24-website-phase-1-design.md` and `docs/superpowers/plans/2026-04-24-website-phase-1.md`) — they introduce the design intent for the upcoming `apps/website` work. PR-B (separate, follows after this merges) builds the new website app on top of the renamed tokens.

### Changes
- `packages/ui/src/tokens.css` — rename color tokens to semantic names (`--pt-bg-page`, `--pt-text-primary`, `--pt-accent`, etc.) and revalue to cool-slate. Layout / type-scale / severity / syntax tokens unchanged. Font stack now wires Inter + JetBrains Mono via fontsource.
- `packages/ui/src/components.css` — search-replace `var(--pt-*)` references to new names.
- `packages/ui/src/nav.tsx` — `NavPage` adds `"website"`; `LINKS` swaps the `"playground"` entry for a `"website"` entry pointing at the brand wordmark on `/`. `"playground"` stays in the union (typecheck compat for transitional state).
- `apps/bench/src/app.css` — `@theme inline` map + class rules updated; Inter + JetBrains Mono imports added.
- `apps/playground/src/app.css`, `pitch-grid.css`, and 5 TSX component files (`pitch-hero.tsx`, `pitch-grid.tsx`, `receipts-band.tsx`, `copy-command.tsx`, `streaming-proof.tsx`) — Tailwind class strings + var() refs migrated to new names.
- `apps/streaming-demo` — **untouched** (independent Bloomberg-terminal theme, doesn't consume `@pretable/ui` tokens).

### Out of scope (separate PRs)

- `apps/website` scaffold — PR-B (follows this PR).
- AI-startup body sections — Phase 2.
- Retiring `apps/playground` — Phase 3.
- Updating `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` — Phase 2 will revise it to match the cool-slate pivot.

### Visual outcomes
- `apps/bench` reskins from cream chrome + amber accents to cool-slate chrome + cyan accents. The grid surfaces (`.viewport-card`, `.result-json`) stay dark (slightly cooler retune).
- `apps/playground` reskins similarly. Hero, grid, streaming-proof, receipts band all render cool-slate. Note: playground's `<Nav active="playground">` no longer highlights any tab (the link was removed). Acceptable transitional state — Phase 3 retires playground.
- `apps/streaming-demo` is unchanged.

## Test plan

- [x] `pnpm test` — all workspaces green (bench + playground + streaming-demo + packages)
- [x] `pnpm typecheck` — clean
- [x] `pnpm lint` — clean
- [x] `pnpm format` — clean
- [x] `pnpm build` — bench + playground + streaming-demo all build
- [ ] Manual: bench dev URL renders cool-slate, scenario run still works
- [ ] Manual: playground dev URL renders cool-slate, hero scroll-to-grid works, grid interactive, streaming-proof renders, receipts band renders
- [ ] Manual: streaming-demo dev URL unchanged

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

- [ ] **Step 3: Report status**

Mark PR-A done. Note PR URL and any pre-existing issues surfaced. Wait for PR-A to merge before starting PR-B.

---

# PR-B — `apps/website` scaffold + hero + grid

## Branch setup for PR-B

PR-B starts on a fresh branch off the post-PR-A `main`.

**Wait for PR-A to be MERGED before starting PR-B.** If PR-A is still open, STOP and report BLOCKED.

```bash
cd /Users/blove/repos/pretable/.claude/worktrees/pedantic-joliot-7e6d20
git fetch origin --prune
git checkout main && git pull --ff-only       # if main worktree exists; otherwise see fallback below
git checkout -b feat/website-scaffold origin/main
```

Fallback if local `main` is in another worktree (the Claude main repo `/Users/blove/repos/pretable` already holds it):
```bash
cd /Users/blove/repos/pretable && git pull --ff-only && cd -
git fetch origin --prune
git checkout -b feat/website-scaffold origin/main
```

After this, HEAD = `origin/main` post-PR-A merge. New branch `feat/website-scaffold`.

---

## PR-B Task 10: Scaffold `apps/website/` (configs + package.json)

Create the new app's directory structure with package.json + configs + empty `app/` subdir + .gitignore + README. No React code yet — just the skeleton that lets `pnpm install` resolve and `next build` succeed (rendering a default empty page).

**Files (all created):**
- `apps/website/package.json`
- `apps/website/next.config.ts`
- `apps/website/postcss.config.mjs`
- `apps/website/tsconfig.json`
- `apps/website/.gitignore`
- `apps/website/README.md`

- [ ] **Step 1: Create `apps/website/package.json`**

```json
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
    "@types/node": "^25.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.2.4",
    "typescript": "^5.0.0"
  }
}
```

After creating, replace the `^5.x.x` and `^25.0.0` etc. ranges with concrete latest versions during install (Step 7 below). Run `pnpm install` from repo root to get pnpm to resolve them, or pre-pin with `pnpm --filter @pretable/app-website add <pkg>@latest` for each.

- [ ] **Step 2: Create `apps/website/next.config.ts`**

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
};

export default config;
```

- [ ] **Step 3: Create `apps/website/postcss.config.mjs`**

```mjs
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
```

- [ ] **Step 4: Create `apps/website/tsconfig.json`**

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

- [ ] **Step 5: Create `apps/website/.gitignore`**

```
.next/
out/
node_modules/
*.tsbuildinfo
next-env.d.ts
.env*.local
```

- [ ] **Step 6: Create `apps/website/README.md`**

```markdown
# @pretable/app-website

The pretable website (cool-slate AI-startup landing). Next.js 16 + Tailwind v4 + MDX-ready.

## Phases
- **Phase 1 (this PR):** scaffold + hero + live playground grid section directly below.
- **Phase 2:** AI-startup body sections (problem / solution / stack / CTA), ScrollReveal animations, ambient blob narrative.
- **Phase 3:** Retire `apps/playground` (its hero + grid pattern lives here now).

See `docs/superpowers/specs/2026-04-24-website-phase-1-design.md` for the design.

## Local dev
\`\`\`bash
pnpm --filter @pretable/app-website dev
\`\`\`

## Deployment
Vercel-ready. Project + domain wiring deferred (manual step when ready).
```

- [ ] **Step 7: Install dependencies**

From repo root (the worktree root, equivalent):

```bash
pnpm install
```

Expected: pnpm picks up the new `apps/website` workspace entry (covered by the existing `apps/*` glob in `pnpm-workspace.yaml`), resolves all deps, updates `pnpm-lock.yaml`. Some `^x.x.x` ranges in `package.json` may still be placeholder strings — replace them with what pnpm resolved by running `pnpm --filter @pretable/app-website add <pkg>@latest` for each, OR edit `package.json` after `pnpm install` to capture the resolved versions.

- [ ] **Step 8: Verify the empty scaffold builds**

```bash
pnpm --filter @pretable/app-website typecheck
```

Expected: PASS (or fail with "no matching files found" — fine; no source files yet).

```bash
pnpm --filter @pretable/app-website build
```

Expected: PASS (or fail with "no app directory" — fine; we'll add `app/` in Task 11+).

- [ ] **Step 9: Commit**

```bash
git add apps/website/package.json apps/website/next.config.ts apps/website/postcss.config.mjs apps/website/tsconfig.json apps/website/.gitignore apps/website/README.md pnpm-lock.yaml
git commit -m "chore(website): scaffold apps/website Next.js app skeleton"
```

---

## PR-B Task 11: Create `apps/website/app/globals.css`

The CSS entry point. Imports fonts + tokens + components.css + tailwindcss. Declares `@theme inline` map. Sets body defaults. Includes `#grid` rules to style InspectionGrid's emitted classes (mirrors `apps/playground/src/pitch-grid.css` pattern but inlined here).

**Files:**
- Create: `apps/website/app/globals.css`

- [ ] **Step 1: Create the file with full content**

Create `apps/website/app/globals.css` containing:

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

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* InspectionGrid internals — these classes come from @pretable/react/internal */
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
  border: 0;
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

#grid .inspection-header-cell strong {
  color: var(--pt-grid-text);
  font-weight: 600;
}

#grid .inspection-header-cell.is-filtered {
  border-bottom: 2px solid var(--pt-accent);
}

#grid .sort-indicator {
  color: var(--pt-accent);
  font-size: 11px;
  opacity: 0.6;
}

#grid .inspection-scroll-content {
  position: relative;
}

#grid .inspection-row {
  display: grid;
  position: absolute;
  inset-inline: 0;
  border-bottom: 1px solid var(--pt-grid-rule);
  cursor: pointer;
}

#grid .inspection-row:hover .inspection-cell {
  background: var(--pt-grid-raised);
}

#grid .inspection-cell {
  display: grid;
  align-content: start;
  gap: 6px;
  min-height: 100%;
  padding: 12px;
  background: var(--pt-grid-bg);
  border-right: 1px solid var(--pt-grid-rule);
  color: var(--pt-grid-text);
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.52;
}

#grid .inspection-cell[data-pinned="left"] {
  z-index: 3;
  background: var(--pt-grid-raised);
}

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

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/globals.css
git commit -m "feat(website): add globals.css with tokens, theme, and grid internals"
```

---

## PR-B Task 12: Create `apps/website/app/layout.tsx`

The Next.js root layout. Wraps the page in `<Nav active="website">` + `<main>` + `<Footer>` from `@pretable/ui`. Imports `globals.css`.

**Files:**
- Create: `apps/website/app/layout.tsx`

- [ ] **Step 1: Create the file**

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/layout.tsx
git commit -m "feat(website): add root layout with Nav + Footer"
```

---

## PR-B Task 13: Create `<AmbientBlob />`

Decorative gradient blob component. Server-renderable.

**Files:**
- Create: `apps/website/app/components/AmbientBlob.tsx`

- [ ] **Step 1: Create the file**

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

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/components/AmbientBlob.tsx
git commit -m "feat(website): add AmbientBlob decorative component"
```

---

## PR-B Task 14: Create `<CopyCommand />` (port from playground)

Direct port of `apps/playground/src/copy-command.tsx` with `"use client"` directive at top and Tailwind classes already aligned to new token names (post PR-A).

**Files:**
- Create: `apps/website/app/components/CopyCommand.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useState } from "react";

export interface CopyCommandProps {
  command: string;
  className?: string;
}

export function CopyCommand({ command, className }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can fail in insecure contexts; silent no-op.
    }
  };

  const classes = [
    "inline-flex items-center gap-2 rounded-[2px] border border-text-primary bg-transparent",
    "px-[18px] py-[10px] font-mono text-[13px] text-text-primary",
    "hover:bg-bg-raised hover:text-bg-card transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-label="Copy install command"
      onClick={onClick}
    >
      {copied ? "✓ copied" : `$ ${command}`}
    </button>
  );
}
```

Note the `"use client"` directive at line 1 — without it, Next.js fails the build (`useState` is not allowed in server components).

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/components/CopyCommand.tsx
git commit -m "feat(website): add CopyCommand client component (port from playground)"
```

---

## PR-B Task 15: Create `<Hero />`

Centered hero with eyebrow, headline, dek, and two CTAs. Server component (no `useState`). Composes `<AmbientBlob>` + `<CopyCommand>`.

**Files:**
- Create: `apps/website/app/components/Hero.tsx`

- [ ] **Step 1: Create the file**

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

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/components/Hero.tsx
git commit -m "feat(website): add Hero section"
```

---

## PR-B Task 16: Create `<PlaygroundSection />` (port from playground)

Direct port of `apps/playground/src/pitch-grid.tsx` with `"use client"` directive and class names already aligned to new token names. The section keeps `id="grid"` so the hero CTA anchor resolves.

**Files:**
- Create: `apps/website/app/components/PlaygroundSection.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import {
  createInspectionDataset,
  inspectionColumns,
  inspectionDatasetScaleOptions,
  type InspectionDatasetScale,
} from "@pretable-internal/scenario-data";
import {
  InspectionGrid,
  type PretableTelemetry,
} from "@pretable/react/internal";
import { useMemo, useState } from "react";

interface InteractionState {
  sort: { columnId: string; direction: "asc" | "desc" } | null;
  filters: Record<string, string>;
  selectedRowId: string | null;
}

export function PlaygroundSection() {
  const [scale, setScale] = useState<InspectionDatasetScale>("dev");
  const [interactionState, setInteractionState] = useState<InteractionState>({
    sort: null,
    filters: {},
    selectedRowId: null,
  });
  const [telemetry, setTelemetry] = useState<PretableTelemetry | null>(null);

  const dataset = useMemo(() => createInspectionDataset(scale), [scale]);
  const rows = useMemo(() => [...dataset.rows], [dataset.rows]);

  const renderedRowCount = telemetry?.renderedRowCount ?? 0;
  const selectedId = interactionState.selectedRowId ?? "none";

  return (
    <section
      id="grid"
      className="bg-grid-bg text-grid-text border-y border-grid-rule"
    >
      <div
        data-testid="pitch-grid-chrome"
        className="flex items-center justify-between border-b border-grid-rule px-7 py-3 font-mono text-[11px] text-grid-dim md:px-10"
      >
        <div className="flex items-center gap-2">
          <span>inspection.log</span>
          <span>·</span>
          <label className="inline-flex items-center gap-1">
            <span className="sr-only">Dataset scale</span>
            <select
              aria-label="Dataset scale"
              className="bg-transparent text-accent outline-none cursor-pointer"
              value={scale}
              onChange={(event) => {
                setScale(
                  event.currentTarget.value as InspectionDatasetScale,
                );
              }}
            >
              {inspectionDatasetScaleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <span>rendered {renderedRowCount}</span>
          <span>·</span>
          <span>sel {selectedId}</span>
        </div>
      </div>

      <div
        data-testid="pitch-grid-filters"
        className="flex flex-wrap gap-3 border-b border-grid-rule bg-grid-raised px-7 py-3 font-mono text-[12px] md:grid md:grid-flow-col md:auto-cols-fr md:px-10"
      >
        {dataset.filterableColumnIds.map((columnId) => {
          const column = inspectionColumns.find((c) => c.id === columnId);
          const label = column?.header ?? columnId;
          return (
            <label
              key={columnId}
              className="grid min-w-[140px] flex-1 gap-1 text-grid-dim md:min-w-0"
            >
              <span className="uppercase tracking-[0.06em]">{label}</span>
              <input
                type="text"
                aria-label={`Filter ${label}`}
                value={interactionState.filters[columnId] ?? ""}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setInteractionState((current) => ({
                    ...current,
                    filters: { ...current.filters, [columnId]: nextValue },
                  }));
                }}
                className="rounded-[2px] border border-grid-rule bg-grid-bg px-2 py-1 text-grid-text placeholder:text-grid-dim focus:outline-none focus:border-accent"
                placeholder={`Filter ${label.toLowerCase()}`}
              />
            </label>
          );
        })}
      </div>

      <InspectionGrid
        ariaLabel="Inspection grid"
        filterableColumnIds={dataset.filterableColumnIds}
        interactionState={interactionState}
        onSelectedRowIdChange={(rowId) => {
          setInteractionState((current) => ({
            ...current,
            selectedRowId: rowId,
          }));
        }}
        onSortChange={(sort) => {
          setInteractionState((current) => ({ ...current, sort }));
        }}
        onTelemetryChange={setTelemetry}
        overscan={5}
        rows={rows}
        viewportHeight={420}
      />
    </section>
  );
}
```

This is a near-identical copy of `apps/playground/src/pitch-grid.tsx` (post PR-A migrations) with the class string `text-amber` → `text-accent` and `focus:border-amber` → `focus:border-accent` already applied (those will already be in playground after PR-A merges, so just copy from there).

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/components/PlaygroundSection.tsx
git commit -m "feat(website): add PlaygroundSection client component (port from playground)"
```

---

## PR-B Task 17: Create `app/page.tsx`

The homepage — composes `<Hero />` + `<PlaygroundSection />` inside the layout's `<main>` slot.

**Files:**
- Create: `apps/website/app/page.tsx`

- [ ] **Step 1: Create the file**

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

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/page.tsx
git commit -m "feat(website): add homepage composing Hero + PlaygroundSection"
```

---

## PR-B Task 18: Verify website builds and renders

**Files:** none modified — verification only.

- [ ] **Step 1: Build**

```bash
pnpm --filter @pretable/app-website build
```

Expected: PASS. `.next/` output produced. No RSC vs client component errors.

If a "Cannot use ... in Server Component" error surfaces, check that `PlaygroundSection.tsx` and `CopyCommand.tsx` both have `"use client"` at line 1.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @pretable/app-website typecheck
```

Expected: PASS.

- [ ] **Step 3: Repo-wide CI**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```

Expected: all green. The website added a new workspace; CI now exercises it.

If `pnpm format` flags anything we touched, run format-write, commit `style:`, re-run.

- [ ] **Step 4: Manual smoke**

```bash
pnpm --filter @pretable/app-website dev
```

Open the dev URL (typically `http://localhost:3000`). Walk through:
- Page loads with cool-slate dark navy background.
- Nav at top: `pretable / bench / docs / github` with `pretable` active.
- Hero renders centered: cyan eyebrow → Fraunces headline with italic cyan emphasis → Inter dek → solid-cyan primary CTA `Try the playground ↓` and ghost-mono `$ npm i @pretable/react` CTA pill.
- Cyan ambient blob visible behind hero (subtle).
- Click "Try the playground ↓" → smooth-scrolls to the grid section below.
- Grid section: chrome strip showing `inspection.log · scale: dev · rendered N · sel none`.
- Filter row with multiple inputs.
- Grid body: scrollable, multiple rows, click a row to highlight cyan-tinted, change scale to "tiny" — dataset re-derives.
- Copy CTA: click `$ npm i @pretable/react` → flashes `✓ copied`, paste verifies clipboard contains `npm i @pretable/react`.
- Footer at bottom: monospace one-liner with version + ci dot.
- Network tab: Fraunces + Inter + JetBrains Mono Variable WOFF2 files load without 404s.

Ctrl-C out.

- [ ] **Step 5: No commit needed for this task**

If everything passed, move to Task 19.

If something failed, fix and commit a `fix(website):` patch before Task 19.

---

## PR-B Task 19: Push + open PR-B

**Files:** none modified — git operations.

- [ ] **Step 1: Push**

```bash
git push -u origin feat/website-scaffold
```

- [ ] **Step 2: Open PR-B**

```bash
gh pr create --title "feat(website): scaffold apps/website with hero + live playground grid" --body "$(cat <<'EOF'
## Summary

PR-B of website Phase 1. Scaffolds a new `apps/website` Next.js 16 app with a centered hero plus a live, interactive playground grid section directly below. Consumes the cool-slate `@pretable/ui` tokens that PR-A landed.

### What ships

- New Next.js 16 app at `apps/website/` — App Router, RSC-aware, Tailwind v4 via `@tailwindcss/postcss`.
- Three font families wired via fontsource: Fraunces (display), Inter (sans), JetBrains Mono (mono).
- `<Hero />` — centered, ambient cyan blob behind, Fraunces headline with italic cyan emphasis, two CTAs (anchor → grid; copy-command pill).
- `<PlaygroundSection />` (`"use client"`) — full live interactive `InspectionGrid` mounted at `id="grid"`, identical interaction surface to the existing playground. Scale select, filter row, telemetry chrome.
- `<AmbientBlob />` — reusable decorative gradient.
- `<CopyCommand />` (`"use client"`) — pill CTA with clipboard write + ✓ copied flash.
- Layout composes `<Nav active="website">` + `<main>` + `<Footer>` from `@pretable/ui`.

### Architecture notes

- `<PlaygroundSection />` is a near-duplicate of `apps/playground/src/pitch-grid.tsx`. The playground will be retired in Phase 3; the website's copy is the canonical version going forward.
- `process.env.npm_package_version` provides the version string at build time (different mechanism from playground/bench's `import.meta.env.VITE_APP_VERSION` because Next.js doesn't use Vite).
- Mobile responsiveness: hero uses `md:` breakpoints for type scale; grid section uses Tailwind's responsive flex/grid for filter row.

### Out of scope (separate phases)

- AI-startup body sections (problem / solution / stack / CTA) — Phase 2.
- ScrollReveal animations + multi-blob ambient narrative — Phase 2.
- MDX content pages, Shiki syntax highlighting — Phase 2.
- Retiring `apps/playground` — Phase 3.
- Vercel project + domain wiring — manual deploy when ready.
- New unit tests — deferred until Phase 2 introduces a Next.js + RSC-aware test setup.

## Test plan

- [x] `pnpm test` — all workspaces green
- [x] `pnpm typecheck` — clean
- [x] `pnpm lint` — clean
- [x] `pnpm format` — clean
- [x] `pnpm build` — bench + playground + streaming-demo + website all build
- [ ] Manual: `pnpm --filter @pretable/app-website dev` renders cool-slate landing; hero CTA scrolls to grid; grid is fully interactive (scale change, row select, filter); copy-command writes to clipboard + flashes ✓ copied; Fraunces + Inter + JetBrains Mono load
- [ ] Manual: production build via `pnpm --filter @pretable/app-website build && pnpm --filter @pretable/app-website start`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

- [ ] **Step 3: Report status**

Mark PR-B done. Note PR URL. Phase 1 implementation is complete pending the user's manual visual review and merge.

---

## Spec coverage check

| Spec section                       | Task(s)         |
| ---------------------------------- | --------------- |
| §1 Goal                            | PR-A 1-9, PR-B 10-19 |
| §2 Scope (PR-A vs PR-B)            | structure       |
| §3 Architecture (component tree)   | PR-B 12, 13, 14, 15, 16, 17 |
| §3 State ownership                 | PR-B 14, 16     |
| §3 Type contracts                  | PR-A 3, PR-B 16 |
| §4 Token rename strategy           | PR-A 1          |
| §4 Token mapping table             | PR-A 1, 2 (and reference table at top) |
| §4 components.css migration        | PR-A 2          |
| §4 Nav.tsx changes                 | PR-A 3          |
| §4 bench's app.css migration       | PR-A 4          |
| §4 playground's app.css migration  | PR-A 5, 6       |
| §4 playground TSX migration        | PR-A 7          |
| §5 Directory layout                | PR-B 10, 11, 12, 13, 14, 15, 16, 17 |
| §5 package.json                    | PR-B 10         |
| §5 next.config.ts / postcss.config.mjs / tsconfig.json | PR-B 10 |
| §5 globals.css                     | PR-B 11         |
| §5 layout.tsx                      | PR-B 12         |
| §5 page.tsx                        | PR-B 17         |
| §6 Hero.tsx                        | PR-B 15         |
| §6 AmbientBlob.tsx                 | PR-B 13         |
| §6 CopyCommand.tsx                 | PR-B 14         |
| §6 PlaygroundSection.tsx           | PR-B 16         |
| §7 Testing approach (no new tests) | PR-A 4, 7, 8; PR-B 18 |
| §8 Out-of-scope items              | — (intentionally not tasks) |
| §9 Rollback                        | PR-A 9, PR-B 19 (single squash-merge per PR) |
| §10 Risks                          | PR-A 7 (component grep), PR-B 18 (RSC boundary check) |
| §11 Success criteria 1 (PR-A)      | PR-A 8          |
| §11 Success criteria 2 (PR-B build)| PR-B 18         |
| §11 Success criteria 3 (Nav active)| PR-A 3, PR-B 12 |
| §11 Success criteria 4 (visual identity) | PR-A 8, PR-B 18 |
| §11 Success criteria 5 (CI green)  | PR-A 8, PR-B 18 |
| §11 Success criteria 6 (Phase 2 ground) | structural — passes if PR-A and PR-B both merge |

All requirements covered.

---

**End of plan.** Execution via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.

# Bench UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `@pretable/ui` (Nav, Footer, design tokens) into `apps/bench` so its chrome matches the shipped `apps/playground` identity. Only the outer chrome + palette changes; the scenario panel, preview panel, run toolbar, and result display keep their structure.

**Architecture:** `<App>` in `apps/bench/src/app.tsx` gains a `<Nav active="bench">` wrapper and a `<Footer>` underneath. The existing `<BenchApp>` content moves inside `<main>` untouched. `apps/bench/src/app.css` is rewritten against `@pretable/ui` tokens using Tailwind v4 `@theme inline` mapping — same pattern direction A shipped for playground. No new components, no new unit tests, no changes inside `bench-app.tsx` or any adapter file.

**Tech Stack:** React 19.2, TypeScript 5, Vite 7 + Vitest, Tailwind v4 (`@tailwindcss/vite`), Fraunces via `@fontsource-variable/fraunces`, `@pretable/ui` (workspace).

---

## File Structure

**Modified files (4):**

```
apps/bench/package.json           // + deps, + version, + prepare:deps chain
apps/bench/vite.config.ts         // + tailwindcss plugin, + VITE_APP_VERSION define; keep vitest `test` block
apps/bench/src/app.tsx            // + Nav + Footer wrap
apps/bench/src/app.css            // rewritten end-to-end against @pretable/ui tokens
```

**No new files. No deleted files. No changes anywhere else in the repo.**

**Intentionally NOT modified:**

- `apps/bench/src/bench-app.tsx` (the 431-line kitchen sink — keeps all JSX, all state)
- `apps/bench/src/bench-runtime.ts`, `query-state.ts`, the four adapter files
- Any file under `packages/*` (vanilla-CSS convention stays intact)
- Any test under `apps/bench/src/__tests__/` or `apps/bench/tests/`

---

## Task 1: Install dependencies & Vite config

Install Tailwind v4, Fraunces, and `@pretable/ui`; wire the Tailwind plugin into bench's `vite.config.ts` while preserving the vitest `test` block; add `version` + update `prepare:deps` to also build `@pretable/ui`. Nothing visual yet — this is the foundation for later tasks.

**Files:**

- Modify: `apps/bench/package.json`
- Modify: `apps/bench/vite.config.ts`

- [ ] **Step 1: Install deps**

Run from repo root:

```bash
pnpm --filter @pretable/app-bench add @pretable/ui@workspace:*
pnpm --filter @pretable/app-bench add -D tailwindcss@^4 @tailwindcss/vite
pnpm --filter @pretable/app-bench add @fontsource-variable/fraunces
```

Expected: `apps/bench/package.json` gains:

- `dependencies`: `@pretable/ui: "workspace:*"`, `@fontsource-variable/fraunces: "^5.x.x"`
- `devDependencies`: `tailwindcss: "^4.x.x"`, `@tailwindcss/vite: "^4.x.x"`

- [ ] **Step 2: Add `version` field + extend `prepare:deps` to also build `@pretable/ui`**

Edit `apps/bench/package.json`. Add `"version": "0.0.0"` near the top (after `"private": true`). Update the `prepare:deps` script to also build `@pretable/ui`:

```json
"version": "0.0.0",
"scripts": {
  "prepare:deps": "pnpm --filter @pretable-internal/scenario-data build && pnpm --filter @pretable-internal/bench-runner build && pnpm --filter @pretable-internal/stream-adapter build && pnpm --filter @pretable/react build && pnpm --filter @pretable/ui build",
```

Rationale: `app.css` will `@import "@pretable/ui/tokens.css"` which resolves to `packages/ui/dist/tokens.css`. Without building ui first, cold-checkout `dev`/`build`/`test`/`typecheck` fail. Same gap was flagged and fixed on playground in direction A.

- [ ] **Step 3: Update `vite.config.ts` — preserve the vitest `test` block**

Replace `apps/bench/vite.config.ts` with:

```ts
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tests/**"],
    passWithNoTests: true,
  },
});
```

Key differences from playground's `vite.config.ts`:

- Imports from `vitest/config` (not `vite`) — bench merges Vite + Vitest config in one file
- Retains the `test` block (environment, include/exclude patterns, passWithNoTests)

**Do not drop the `test` block.** If you do, `pnpm --filter @pretable/app-bench test` will run all `*.test.*` files including Playwright's `tests/bench.spec.ts` under jsdom (which will explode).

- [ ] **Step 4: Sanity-check the build**

Run:

```bash
pnpm --filter @pretable/app-bench typecheck
```

Expected: PASS.

Run:

```bash
pnpm --filter @pretable/app-bench test
```

Expected: PASS. 6 existing test files run to completion. No new tests added by this task, but existing behavior must still work.

Run dev briefly (short timeout, background) to confirm the Tailwind plugin boots:

```bash
# Boot dev, confirm no CSS parse errors, stop.
pnpm --filter @pretable/app-bench dev
# Ctrl-C after confirming it started cleanly.
```

Expected: dev server boots with no CSS parse errors or Tailwind plugin errors. The page still renders against the old `app.css` (since we haven't rewritten it yet) — that's fine.

- [ ] **Step 5: Commit**

```bash
git add apps/bench/package.json apps/bench/vite.config.ts pnpm-lock.yaml
git commit -m "chore(bench): install Tailwind v4, @pretable/ui, and Fraunces; wire Vite plugin"
```

---

## Task 2: Wire `<Nav>` + `<Footer>` into `<App>`

Wrap the existing `<BenchApp>` with `<Nav active="bench">` and `<Footer>`. Add the `APP_VERSION` plumbing. No test changes — Nav/Footer contract coverage already lives in `apps/playground/src/__tests__/app.test.tsx`. Existing bench tests must stay green.

**Files:**

- Modify: `apps/bench/src/app.tsx`

- [ ] **Step 1: Rewrite `apps/bench/src/app.tsx`**

Replace the entire file with:

```tsx
import { Footer, Nav } from "@pretable/ui";

import { BenchApp } from "./bench-app";
import { detectBrowserVersion } from "./bench-runtime";

const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;

export function App() {
  return (
    <>
      <Nav active="bench" version={APP_VERSION} />
      <main>
        <BenchApp
          search={window.location.search}
          browserVersion={detectBrowserVersion(window.navigator.userAgent)}
        />
      </main>
      {/* TODO(ci-signal): wire ciStatus to a real source once CI status plumbing exists.
          Hardcoded "green" for now — parity with apps/playground/src/app.tsx. */}
      <Footer version={APP_VERSION} ciStatus="green" />
    </>
  );
}
```

Key differences from Task 2 of direction A:

- The bench-specific `BenchApp` invocation with `search` + `browserVersion` props is preserved inside `<main>`.
- `<Nav active="bench">` (vs `active="playground"`).
- Comment block matches playground's `ciStatus` TODO for cross-surface consistency.

- [ ] **Step 2: Verify existing tests still pass**

Run:

```bash
pnpm --filter @pretable/app-bench test
```

Expected: PASS. All 6 existing test files run to completion. Confirm none of them break because:

- `<BenchApp>` still renders inside `<App />` with the same `search` + `browserVersion` props → runtime tests unchanged.
- Tests that render `<App />` now get a `<Nav>` + `<Footer>` wrapper — they shouldn't assert on their absence.

If any test fails, STOP. Do not mutate test code. Investigate whether the Nav/Footer added markup that collides with an existing query. Likely culprit: a test that does `screen.getByRole("banner")` or similar. If that happens, report BLOCKED with the specific failure — the plan author will decide whether to scope the query or adjust the test.

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @pretable/app-bench typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/bench/src/app.tsx
git commit -m "feat(bench): wrap page in shared Nav + Footer from @pretable/ui"
```

---

## Task 3: Rewrite `app.css` against `@pretable/ui` tokens

The substantive task. Replace all hardcoded hex / rgba / gradient values with tokens. Import Fraunces, tokens, components, Tailwind. Add `@theme inline`. Preserve every class name (`.bench-shell`, `.bench-hero`, `.eyebrow`, `.scenario-panel`, `.preview-panel`, `.scenario-card`, etc.) so `bench-app.tsx`'s markup keeps rendering — just against a new palette.

**Files:**

- Modify: `apps/bench/src/app.css`

- [ ] **Step 1: Replace entire file contents**

Replace `apps/bench/src/app.css` with:

```css
@import "@fontsource-variable/fraunces/wght.css";
@import "@fontsource-variable/fraunces/wght-italic.css";
@import "@pretable/ui/tokens.css";
@import "@pretable/ui/components.css";
@import "tailwindcss";

@theme inline {
  --color-cream: var(--pt-cream);
  --color-cream-hi: var(--pt-cream-hi);
  --color-cream-rule: var(--pt-cream-rule);
  --color-ink: var(--pt-ink);
  --color-ink-dim: var(--pt-ink-dim);
  --color-ink-softer: var(--pt-ink-softer);
  --color-amber-ink: var(--pt-amber-ink);
  --color-amber: var(--pt-amber);
  --color-amber-soft: var(--pt-amber-soft);
  --color-grid-bg: var(--pt-grid-bg);
  --color-grid-raised: var(--pt-grid-raised);
  --color-grid-rule: var(--pt-grid-rule);
  --color-grid-text: var(--pt-grid-text);
  --color-grid-dim: var(--pt-grid-dim);
  --color-sev-info: var(--pt-sev-info);
  --color-sev-warn: var(--pt-sev-warn);
  --color-sev-err: var(--pt-sev-err);
  --color-sev-ok: var(--pt-sev-ok);

  /* Fraunces is referenced as "Fraunces Variable" to match the family name
     @fontsource-variable/fraunces registers, which unlocks the variable
     weight axis. Intentionally NOT indirected through --pt-font-serif
     (which uses plain "Fraunces" for external consumers without the
     fontsource package). Keep literal. */
  --font-display: "Fraunces Variable", Georgia, "Times New Roman", serif;
  --font-sans:
    ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    sans-serif;
  --font-mono:
    ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", "Roboto Mono",
    monospace;
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
}

body {
  font-family: var(--font-sans);
  color: var(--pt-ink);
  background: var(--pt-cream);
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

/* ----------------------------------------------------------------------- */
/* Bench-specific chrome                                                   */
/* ----------------------------------------------------------------------- */

.bench-shell {
  margin: 0 auto;
  max-width: 1200px;
  padding: 48px 24px 64px;
}

.bench-hero {
  max-width: 760px;
}

.eyebrow {
  margin: 0 0 12px;
  color: var(--pt-amber-ink);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.bench-hero h1 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(2.5rem, 5vw, 4.6rem);
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--pt-ink);
}

.hero-copy {
  max-width: 620px;
  color: var(--pt-ink-dim);
  font-family: var(--font-display);
  font-size: 1.05rem;
  line-height: 1.6;
}

.bench-grid {
  display: grid;
  gap: 24px;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  margin-top: 36px;
}

.scenario-panel,
.preview-panel {
  border: 1px solid var(--pt-cream-rule);
  border-radius: 8px;
  background: var(--pt-cream-hi);
  padding: 24px;
}

.panel-header {
  margin-bottom: 18px;
}

.panel-header h2 {
  margin: 0 0 6px;
  font-family: var(--font-display);
  font-size: 1.45rem;
  color: var(--pt-ink);
}

.panel-header p,
.scenario-card p,
.status-note {
  color: var(--pt-ink-dim);
  line-height: 1.5;
}

.scenario-list {
  display: grid;
  gap: 14px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.scenario-card {
  border: 1px solid var(--pt-cream-rule);
  border-radius: 6px;
  background: var(--pt-cream);
  padding: 16px;
}

.scenario-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.scenario-id {
  border-radius: 3px;
  background: var(--pt-amber-soft);
  color: var(--pt-amber-ink);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  padding: 3px 8px;
}

.scenario-card strong {
  font-size: 1rem;
  color: var(--pt-ink);
}

.scenario-card p {
  margin: 0 0 8px;
}

.scenario-card small {
  color: var(--pt-ink-softer);
}

.preview-panel section {
  border: 1px solid var(--pt-cream-rule);
  border-radius: 6px;
  padding: 18px;
  background: var(--pt-cream);
}

.active-scenario {
  display: grid;
  gap: 12px;
  grid-template-columns: auto 1fr;
  align-items: start;
  margin-bottom: 18px;
}

.active-scenario p {
  margin: 6px 0 0;
}

.run-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 18px;
}

.run-toolbar button {
  border: 0;
  border-radius: 2px;
  background: var(--pt-ink);
  color: var(--pt-cream-hi);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  padding: 10px 18px;
}

.run-toolbar button:hover {
  background: var(--pt-ink-hover, var(--pt-ink));
}

.run-toolbar button:focus-visible {
  outline: 2px solid var(--pt-amber-ink);
  outline-offset: 2px;
}

/* Grid / telemetry surfaces stay dark — they render structured data and
   preserve the cream-bracket-dark rhythm the visual system relies on. */

.viewport-card {
  border: 1px solid var(--pt-grid-rule);
  border-radius: 4px;
  background: var(--pt-grid-bg);
  color: var(--pt-grid-text);
  margin-bottom: 18px;
  min-height: 180px;
  overscroll-behavior: contain;
  overflow-anchor: none;
  padding: 18px;
}

.ag-body-viewport {
  overscroll-behavior: contain;
  overflow-anchor: none;
}

.adapter-surface section {
  border: 1px solid var(--pt-cream-rule);
  border-radius: 6px;
  background: var(--pt-cream);
  padding: 18px;
}

.result-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0 0 18px;
}

.result-grid dt {
  color: var(--pt-ink-softer);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.result-grid dd {
  margin: 0;
  color: var(--pt-ink);
  font-family: var(--font-mono);
  font-size: 13px;
}

.result-json {
  border: 1px solid var(--pt-grid-rule);
  border-radius: 4px;
  background: var(--pt-grid-bg);
  color: var(--pt-grid-text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  overflow: auto;
  padding: 16px;
}

.preview-panel p {
  margin: 0 0 10px;
}

.status-note {
  margin-top: 18px;
  font-size: 0.95rem;
}

@media (max-width: 720px) {
  .bench-shell {
    padding: 28px 16px 48px;
  }

  .result-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

Token mapping summary (for your reference — don't copy into the file):

| Current                                               | New                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `color: #f7f4ea` on `:root`                           | `color: var(--pt-ink)` on `body`                                                       |
| dark-gradient body background                         | flat `var(--pt-cream)` on `body`                                                       |
| `color: #ffbc7d` on `.eyebrow`                        | `var(--pt-amber-ink)` + mono font                                                      |
| `"Space Grotesk"` display family                      | `var(--font-display)` (Fraunces)                                                       |
| `color: #d7d1c4` on `.hero-copy`                      | `var(--pt-ink-dim)`                                                                    |
| `rgba(255,255,255,0.08)` borders                      | `var(--pt-cream-rule)`                                                                 |
| `rgba(17,22,30,0.74)` panel bg + backdrop-filter blur | flat `var(--pt-cream-hi)`                                                              |
| `rgba(255,188,125,0.14)` pill bg + `#ffbc7d` text     | `var(--pt-amber-soft)` + `var(--pt-amber-ink)`                                         |
| `#8aa7cd` dashed dim accents                          | `var(--pt-cream-rule)` solid                                                           |
| `linear-gradient(135deg,#ffbc7d,#d66024)` button      | flat `var(--pt-ink)` bg + `var(--pt-cream-hi)` text (matches playground's primary CTA) |
| `rgba(0,0,0,0.22)` result-json bg                     | `var(--pt-grid-bg)` (terminal palette — grid content surface)                          |
| `#8aa7cd` scenario-card small                         | `var(--pt-ink-softer)`                                                                 |

Rules removed:

- `backdrop-filter: blur(18px)` (cream-hi is opaque; no blur needed)
- `box-shadow: 0 24px 80px rgba(0,0,0,0.28)` on panels (editorial cream doesn't want the dark-drop shadow)
- Dashed blueish borders on `.preview-panel section` / `.viewport-card` (replaced with solid token borders)

- [ ] **Step 2: Verify build + tests**

Run the full playground suite:

```bash
pnpm --filter @pretable/app-bench test
```

Expected: PASS. All 6 tests run to completion unchanged.

Run typecheck:

```bash
pnpm --filter @pretable/app-bench typecheck
```

Expected: PASS.

Run dev briefly to confirm the new CSS compiles:

```bash
pnpm --filter @pretable/app-bench dev
# Ctrl-C after confirming no CSS parse errors.
```

Expected: dev server boots. Page renders against the new cream palette. Some visual elements may look slightly off compared to the playground — that's fine for now; Task 4 does the manual verification pass.

- [ ] **Step 3: Commit**

```bash
git add apps/bench/src/app.css
git commit -m "feat(bench): rewrite app.css against @pretable/ui tokens with Tailwind v4"
```

---

## Task 4: Manual verification + adjustments

Boot the dev server, walk through the bench workflow, and fix any visual regressions the token swap introduced. Also check for vendor-CSS conflicts (AG Grid, MUI X) and apply the adapter-scoping fallback if needed.

**Files:** potentially `apps/bench/src/app.css` (adjustments only); no other files.

- [ ] **Step 1: Boot dev + walk through the checklist**

```bash
pnpm --filter @pretable/app-bench dev
```

Open the URL. Walk through:

- **Chrome match with playground.** Nav at top should be visually identical to playground's (same wordmark + amber `.` + version pill + link set with `bench` active). Footer at bottom should be the same monospace one-liner.
- **Bench hero.** `.bench-hero` reads "Pretable benchmark lab" eyebrow in amber-ink monospace + Fraunces-display `h1` + ink-dim dek.
- **Scenario panel + preview panel** render on cream-hi surfaces with hairline borders, no heavy drop shadows, no blur.
- **Scenario cards** within the scenario panel are on plain cream with a hairline. `scenario-id` pill is amber-soft fill with amber-ink mono text.
- **Run toolbar button** is solid-ink on cream-hi text (not the orange gradient). Hover/focus states work.
- **Viewport card** stays on the dark `--pt-grid-bg` palette — this is where the live grid mounts.
- **Result JSON block** (post-run) renders on `--pt-grid-bg` with mono text.
- **Click through a bench run.** Pick a scenario, run the adapter, see the result JSON populate. Telemetry values are legible. No layout jumps.
- **Try each adapter** (`?v=ag-grid`, `?v=tanstack`, `?v=mui`, `?v=pretable`). Each adapter's own widget renders inside `.viewport-card` without breaking layout.
- **Responsive.** Resize to mobile viewport (~375px). `.bench-shell` reflows to 28px gutter; result-grid collapses to 2 columns; no horizontal scroll on the chrome.

If anything looks visually broken — not just "different from before," but actually broken (overlap, invisible text, unclickable buttons) — note it and proceed to Step 2. If the visual is cosmetically off but functional, log it as a follow-up in your report and move on. The goal is "no regressions" not "pixel-perfect polish."

- [ ] **Step 2: Handle vendor CSS conflicts (if needed)**

AG Grid and MUI X ship their own CSS. Likely outcomes, in order of likelihood:

1. **No conflict** — vendors' styles are scoped tightly. No action. Move to Step 3.
2. **Minor cosmetic drift** — vendor widgets look subtly off against cream chrome (default fonts, hover colors). Tolerate it. Log in Step 3's commit message as "known: ag-grid/mui vendor style drift, acceptable."
3. **Global stomp** — a vendor CSS rule overrides `@pretable/ui/components.css` body/anchor/heading styles. Unlikely but possible. If it happens, scope the adapter render:

   Edit `apps/bench/src/app.css` — add these rules at the end:

   ```css
   /* Scope vendor CSS within adapter surfaces so @pretable/ui governs outside. */
   .bench-adapter-ag,
   .bench-adapter-mui {
     isolation: isolate;
   }
   ```

   And edit `apps/bench/src/bench-app.tsx` to wrap the adapter render in a div with the appropriate class. **ONLY do this if you've verified a genuine global stomp.** The plan default is: don't touch `bench-app.tsx`. If the only way to fix a stomp is to add a wrapper div, that's an acceptable scope exception; commit it separately with a clear message.

- [ ] **Step 3: Commit adjustments (if any)**

If Step 1 or 2 surfaced adjustments:

```bash
git add apps/bench/src/app.css   # or bench-app.tsx if adapter scoping was needed
git commit -m "fix(bench): <specific adjustment, e.g. 'tighten scenario-card hairline spacing'>"
```

If no adjustments needed, skip the commit. The dev-server verification is complete.

- [ ] **Step 4: Run full bench test suite one more time**

```bash
pnpm --filter @pretable/app-bench test
pnpm --filter @pretable/app-bench typecheck
```

Expected: both PASS. Sanity check that any adjustments in Steps 2/3 didn't break tests.

---

## Task 5: CI green + open the PR

Full repo dry-run; push; open PR.

- [ ] **Step 1: Full repo CI dry-run**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```

Expected: all green. If `pnpm format` reports diffs, run the repo's format-write equivalent (check `package.json` scripts for `format:write` or similar), fix, commit with `style: apply prettier formatting`, re-run.

If any command fails on an unrelated workspace, note it in your report and do NOT attempt to fix — scope is bench only.

- [ ] **Step 2: Manual production-build smoke (optional, if time permits)**

```bash
pnpm --filter @pretable/app-bench build
pnpm --filter @pretable/app-bench preview:bench
```

Expected: preview URL boots. Scan console for hydration errors. Walk through the same checklist from Task 4 Step 1 against the production build. Ctrl-C out. Skip this step if you already verified dev in Task 4 and time is short.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/website-surfaces
```

Note: this branch already has direction A's commits. The PR you opened as PR #12 tracks `feat/website-surfaces`; pushing direction B's commits will add to that same PR. That's NOT what we want — direction B should be its own PR.

Two options:

1. **Separate branch for B.** Create `feat/bench-ui-integration` off `main` (or off the rebase point), cherry-pick B's commits onto it, push, open new PR. **This requires direction A to be merged first** (otherwise the base is wrong and you'd conflict).
2. **Stack B on A.** Leave B's commits on `feat/website-surfaces`, update PR #12 to cover both A and B. Larger PR, but no rebase gymnastics.

**Default: option 1 (separate branch) — but gated on A being merged.** If A is still open:

- STOP here and report BLOCKED with "Direction A (PR #12) must be merged before direction B can open its own PR on top of clean main."
- User can either merge PR #12 and re-dispatch Task 5, or accept stacking B on A (option 2).

If A is merged (PR #12 closed as merged into main):

```bash
git fetch origin --prune
git checkout main
git pull --ff-only
git checkout -b feat/bench-ui-integration
# Cherry-pick B's commits. If you don't know the SHA range, list with:
#   git log --oneline feat/website-surfaces --not main
# Then cherry-pick each B commit in order:
git cherry-pick <sha1> <sha2> <sha3> <sha4>
git push -u origin feat/bench-ui-integration
```

Then open the PR:

```bash
gh pr create --title "feat(bench): wire @pretable/ui chrome into bench (direction B)" --body "$(cat <<'EOF'
## Summary

- Wraps `apps/bench` in `<Nav active="bench">` + `<Footer>` from `@pretable/ui`.
- Rewrites `apps/bench/src/app.css` against `@pretable/ui` design tokens using Tailwind v4 `@theme inline` — same pattern shipped for playground in direction A.
- Replaces the dark-gradient body + IBM Plex + orange/blue hardcoded hex palette with cream chrome + Fraunces-display headlines + token-driven colors throughout.
- Preserves the cream-bracket-dark rhythm from visual-system-design §2 — `.viewport-card` and `.result-json` stay on the terminal (`--pt-grid-*`) palette because they render structured/grid data.
- Adds `@pretable/ui` to `prepare:deps` so cold-checkout dev/build/test/typecheck resolve the CSS imports.

Direction B of the four-direction website initiative. No changes to `bench-app.tsx`, `bench-runtime.ts`, `query-state.ts`, or any adapter file. No new tests — Nav/Footer contract coverage lives in playground's `app.test.tsx`.

Full spec: `docs/superpowers/specs/2026-04-21-bench-ui-integration-design.md`
Plan: `docs/superpowers/plans/2026-04-21-bench-ui-integration.md`

## Known follow-ups

- **The visual-system-design §6 adversarial-redesign project** (4-column comparison grid + scorecard + CI history + methodology) is intentionally out of scope and deferred. Tracked for a future brainstorm cycle.
- `ciStatus` in `<Footer>` remains hardcoded `"green"` (same pattern as playground).
- If vendor CSS (AG Grid, MUI X) shows cosmetic drift against the cream chrome in manual testing, future tightening is a small follow-up.

## Test plan

- [x] `pnpm test` green
- [x] `pnpm typecheck` green
- [x] `pnpm lint` green
- [x] `pnpm format` green
- [x] `pnpm build` green
- [ ] Manual: `pnpm --filter @pretable/app-bench dev` renders bench with shared Nav + Footer; scenario panel and preview panel render against cream-hi; `.viewport-card` stays dark; run toolbar button is solid ink; result JSON renders mono on grid-bg; all four adapter renders remain functional.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

- [ ] **Step 4: Report**

Mark Task 5 done. Report the PR URL + which CI checks passed + any follow-ups.

---

## Spec coverage check

| Spec section                               | Task(s)            |
| ------------------------------------------ | ------------------ |
| §1 Goal                                    | 1–5                |
| §2 Scope boundary                          | 1–3                |
| §3 Architecture                            | 2                  |
| §4 Styling integration                     | 1, 3               |
| §4 Token mapping cheat sheet               | 3 (Step 1)         |
| §4 Dark surfaces                           | 3 (Step 1)         |
| §4 Vendor CSS fallback                     | 4 (Step 2)         |
| §5 Testing (no new tests)                  | 2, 3 (verify only) |
| §6 Out of scope                            | — (not a task)     |
| §7 Success criteria 1 (chrome renders)     | 2, 4               |
| §7 Success criteria 2 (zero hardcoded hex) | 3                  |
| §7 Success criteria 3 (Nav/Footer match)   | 2, 4               |
| §7 Success criteria 4 (bench still runs)   | 4                  |
| §7 Success criteria 5 (CI green)           | 5                  |
| §7 Success criteria 6 (adapters work)      | 4                  |
| §8 Rollback                                | 5 (PR)             |
| §9 Risks                                   | 3, 4               |

All spec requirements covered.

---

**End of plan.** Execution via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.

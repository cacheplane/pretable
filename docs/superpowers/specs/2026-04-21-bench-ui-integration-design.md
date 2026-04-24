# Bench UI Integration — Design Spec

**Date:** 2026-04-21
**Status:** Draft for review
**Scope:** direction B of the four-direction website initiative — wire `@pretable/ui` (Nav, Footer, design tokens) into `apps/bench` so its chrome matches the shipped `apps/playground` identity per visual-system-design §6.
**Parent spec:** [`2026-04-21-pretable-visual-system-design.md`](./2026-04-21-pretable-visual-system-design.md)
**Dependencies shipped:** `@pretable/ui` (PR #7, commit `3d8c57a`). Direction A (`apps/playground` pitch landing) is open in PR #12 and establishes the token-mapping + Tailwind v4 pattern this spec follows.

---

## 1. Goal

`apps/bench` today is a standalone Vite app with its own dark-gradient theme (radial orange + blue accents over `#0e1116`), IBM Plex Sans typography, and zero participation in the shared design system. It runs the adversarial benchmark suite (4 adapters × multiple scenarios), publishes run artifacts to `status/`, and is the "receipts" surface of `pretable.ai`. It needs to look like a sibling of the playground landing, not a disconnected dev tool.

Direction B is a **chrome-only alignment** task. It wraps the bench in the same `<Nav>` / `<Footer>` shared from `@pretable/ui` that the playground now ships, rewrites `apps/bench/src/app.css` to render against `@pretable/ui` design tokens, and introduces Tailwind v4 for parity with playground's styling pipeline. It does **not** redesign the bench interior (scenario registry, adapter preview, run toolbar, result display) — that's a separate project scoped to visual-system-design §6 (adversarial 4-column grid + scorecard + CI history + methodology).

## 2. Scope boundary

**B owns:**

- `<App />` in `apps/bench/src/app.tsx` gains a `<Nav active="bench">` wrapper and a `<Footer>` below. The existing `<BenchApp>` content moves inside `<main>` untouched.
- Install `tailwindcss@^4`, `@tailwindcss/vite`, `@fontsource-variable/fraunces`, and `@pretable/ui` as app deps (same pattern as playground).
- `apps/bench/src/app.css` rewritten end-to-end: dark-gradient body + IBM Plex + orange/blue hardcoded hex values replaced with `@pretable/ui` tokens via `@theme inline`.
- `apps/bench/vite.config.ts` gains the Tailwind plugin and a `VITE_APP_VERSION` define (parity with playground).
- `apps/bench/package.json` gains `version: "0.0.0"` and an updated `prepare:deps` chain that also builds `@pretable/ui` (matches the fix applied to playground in Task 1).
- Manual visual verification that bench renders without regressions after the palette swap.

**B does not own:**

- Visual-system-design §6's adversarial 4-column grid, segmented-pill control strip, scorecard matrix, CI history chart, or methodology panel. Those are a separate future project ("bench §6 redesign").
- Any changes to `bench-app.tsx`, `bench-runtime.ts`, `query-state.ts`, the four adapter files (`ag-grid-adapter.tsx` etc.), or any scenario/adapter/runtime logic.
- Tailwind adoption in any `packages/*` workspace — those stay vanilla CSS per the repo convention.
- New unit tests for Nav/Footer presence in bench. Bench is not structurally changing enough to warrant them. Existing bench tests stay green.

## 3. Architecture

### Component tree

```
<App>                             apps/bench/src/app.tsx (modified)
  <Nav active="bench" />          @pretable/ui                  (unchanged)
  <main>
    <BenchApp                     apps/bench/src/bench-app.tsx  (unchanged)
      search={window.location.search}
      browserVersion={...}
    />
  </main>
  <Footer />                      @pretable/ui                  (unchanged)
</App>
```

`<Nav>` uses `active="bench"` so the shipped `LINKS` array highlights the right tab. `<Footer>` gets `version={APP_VERSION}` + `ciStatus="green"` (hardcoded for now — same follow-up flagged in playground's `app.tsx`, ultimately owned by the future D / CI-wiring work).

### State ownership

No new state. Everything inside `<BenchApp>` keeps its current state shape (URL query state → scenario + adapter selection → run harness). The Nav/Footer wrap is purely presentational.

### Type contracts

Only shared design-system types are consumed:

- `Nav`, `Footer`, `NavPage`, `FooterLink`, `CiStatus` — from `@pretable/ui`

No library-side type changes. Bench continues to import `PretableGrid`, `PretableTelemetry`, `ScenarioRow`, etc. from their existing sources.

## 4. Styling integration

### Dependencies added (app only — `packages/*` stay vanilla CSS)

- `tailwindcss@^4` (devDep)
- `@tailwindcss/vite` (devDep)
- `@fontsource-variable/fraunces` (dep; satisfies optional peer on `@pretable/ui`)
- `@pretable/ui` (workspace:\*)

### Vite config

`apps/bench/vite.config.ts` gains `tailwindcss()` alongside `react()`, plus the `VITE_APP_VERSION` define reading `package.json` via import attribute. Pattern is byte-identical to `apps/playground/vite.config.ts`.

### `apps/bench/src/app.css` rewrite

The current 241-line file is replaced with a token-driven stylesheet in three layers:

1. **Imports + Tailwind theme** — identical to `apps/playground/src/app.css`: Fraunces wght + wght-italic, `@pretable/ui/tokens.css`, `@pretable/ui/components.css`, `tailwindcss`, and the 18-color + 3-font `@theme inline` block.
2. **Global resets + body defaults** — `*` box-sizing, `html/body` margin + min-height, body font-family/color/background against tokens. Same shape playground uses.
3. **Bench-specific class rules** — `.bench-shell`, `.bench-hero`, `.eyebrow`, `.scenario-panel`, `.preview-panel`, `.panel-header`, `.viewport-card`, `.result-grid`, `.result-json`, `.status-note`, `.run-toolbar`, `.scenario-list`, `.scenario-card`, `.scenario-id`, `.active-scenario`, and the rest — rewritten against tokens.

### Token mapping cheat sheet

The rewrite is a mechanical substitution. The current file leans on ~20 hardcoded hex values and a handful of RGBA overlays. Each maps cleanly:

| Current (approx.)                   | Token                                       | Usage                             |
| ----------------------------------- | ------------------------------------------- | --------------------------------- |
| Dark gradient body                  | `var(--pt-cream)` flat                      | `.bench-shell` ambient background |
| `#f7f4ea` body text                 | `var(--pt-ink)`                             | body default                      |
| `#ffbc7d` eyebrow orange            | `var(--pt-amber-ink)`                       | `.eyebrow`                        |
| `#7db8ff` blue accent               | `var(--pt-sev-info)` or `var(--pt-amber)`   | selected-state highlight          |
| IBM Plex Sans                       | `var(--font-sans)` (system stack)           | body                              |
| Large headline                      | `var(--font-display)` (Fraunces)            | `.bench-hero h1`                  |
| Panel backgrounds (`rgba(...)`)     | `var(--pt-cream-hi)`                        | cream-hi panels                   |
| Panel borders                       | `var(--pt-cream-rule)`                      | hairlines                         |
| Viewport/grid card                  | `var(--pt-grid-bg)` + `--pt-grid-rule`      | where grid renders                |
| Result JSON / telemetry backgrounds | `var(--pt-grid-bg)` + `var(--pt-grid-text)` | mono data blocks                  |
| Warn / error badges                 | `var(--pt-sev-warn)` / `var(--pt-sev-err)`  | status indicators                 |

If a hex value in the current file doesn't map cleanly to an existing token, the implementation resolves by:

1. Picking the nearest token and accepting a visual shift — log the choice in a code comment.
2. NOT inventing a new token (tokens are `@pretable/ui` territory and this task doesn't touch packages).
3. Flattening any gradient to a flat token-driven fill.

### Dark surfaces inside the bench

The bench's `.viewport-card` and the result-JSON display are "grid content" zones — they render structured data (a live grid or JSON). These stay on the dark palette (`--pt-grid-bg` / `--pt-grid-text`) the way the playground's `<PitchGrid>` section does. This preserves the cream-bracket-dark visual rhythm the system spec §2 calls out as the distinctive gap vs competitors.

### Vendor CSS conflicts

AG Grid (`ag-grid-community`) and MUI X Data Grid (`@mui/x-data-grid` via `@mui/material`) ship their own CSS. Three possible outcomes:

1. Their styles are scoped tightly enough that they don't conflict with `@pretable/ui/components.css`. Best case; no action.
2. They bleed minor visual noise into bench chrome (fonts, rounded corners, hover states). Tolerable; implementation pass leaves them alone.
3. They stomp `@pretable/ui/components.css` globals (e.g., body font, anchor colors). If this happens, wrap each adapter render in a scoping div (`.bench-adapter-ag`, `.bench-adapter-mui`) and let vendor CSS win inside that scope while `@pretable/ui` governs everything outside.

Outcome can only be determined at implementation time (visual inspection). If the choice is non-obvious, ship what works and document the decision.

## 5. Testing

### No new tests

The bench is not structurally changing — `<BenchApp>`'s rendered tree is unchanged. Adding a unit test for `<Nav active="bench">` presence repeats the coverage playground's `app.test.tsx` already provides for the Nav/Footer component contracts.

### Preserved behavior

`apps/bench/tests/` (whatever it contains) must stay green through the CSS swap. If any existing test asserts on a color value, hex string, or CSS class (unlikely given bench tests focus on runtime behavior), the implementation:

1. Checks whether the assertion captures a legitimate user-facing behavior — if yes, adjust the token mapping so the assertion passes.
2. Or, if the assertion is coupled to an implementation detail that's irrelevant now, update the test to assert the new token-driven behavior.

Either way, do not delete tests to avoid this.

### Manual verification before PR

- `pnpm dev:bench` (or `pnpm --filter @pretable/app-bench dev`) boots; page loads.
- Bench hero (headline, dek, eyebrow) renders on cream with Fraunces display + amber-ink eyebrow.
- Nav + Footer match the shipped playground visually (same brand, same link set, `bench` tab active).
- Scenario panel, preview panel, run toolbar remain functional — click a scenario, run a bench, see the result JSON. No visible regressions.
- Viewport card / result JSON render on dark surfaces (grid-bg family).
- `ag-grid`, `tanstack`, and `mui-x` adapter renders remain usable (their internal styling may look slightly "off" vs. the cream chrome — acceptable as long as they don't break functionally).
- URL permalinks (`?s=S7&v=pretable&scale=stress` etc.) round-trip correctly.
- Responsive at mobile width: bench reflows without horizontal scroll on the chrome (grid content may retain internal horizontal scroll).

## 6. Out of scope / related follow-ups

**Out of scope for B:**

- Visual-system-design §6's adversarial 4-column grid and scorecard — tracked as the next project after direction D.
- Control strip with segmented pills (scenario / scale / adapter multi-select) — §6's territory.
- CI history chart reading `status/runsets/*.json` — §6's territory.
- Methodology section with the `pnpm bench:matrix` reproduce-locally code block — §6's territory.
- Bench runtime changes (telemetry instrumentation, new metrics, Playwright wiring) — out of scope for any of A-D.
- Any changes to `@pretable/ui` itself — the component API is taken as given.
- Unit tests for `<Nav active="bench">` rendering — playground's tests already cover the Nav/Footer contracts.

**Follow-ups surfaced:**

- `ciStatus` in `<Footer>` remains hardcoded `"green"`. Direction D (or a future "ci status wiring" project) is the eventual owner. Same TODO comment pattern used in `apps/playground/src/app.tsx`.
- If vendor CSS (AG Grid, MUI) produces visual noise under the new palette, the adapter-scoping fix is a separate small pass. Not worth blocking B over.
- The memory-flagged pivot — rename `apps/playground` + rebuild landing as an AI-startup style page modeled on the user's `angular-agent-framework` / `dawn` repos — will likely trigger a matching pass on `apps/bench` when it lands. Direction B establishes the pattern; the pivot revisits whether the pattern stays cream-editorial or becomes something more conventional-AI.

**Not a follow-up (intentionally deferred):**

- The `@pretable/*` consumer-theming architecture question (separately tracked) may eventually replace the token-import pattern this task uses. Not worth addressing in B; re-address when external consumers are on the horizon.

## 7. Success criteria

B is successful if:

1. `pnpm dev:bench` renders `<Nav active="bench">` + bench content + `<Footer>` with no layout regressions.
2. `apps/bench/src/app.css` contains zero hardcoded color hex values — every color comes from a `@pretable/ui` token or a token-family utility.
3. Nav/Footer are visually identical to the playground's (same wordmark, same link set, same footer one-liner).
4. The bench runs unchanged — selecting a scenario, running an adapter, seeing the result JSON, and pasting a permalink all work.
5. CI green: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build` all pass across the repo.
6. Manual visual verification confirms no regressions in any of the four adapter renders.

## 8. Rollback

B is a single-branch, single-squash-merge unit scoped to `apps/bench` plus the new workspace dep addition.

- **After ship:** `git revert` the squash commit restores the prior dark-gradient bench.
- **Before ship:** `git branch -D feat/bench-ui-integration` — the worktree is expendable. No data migrations, no external config changes.

No effect on `@pretable/*` packages, on `apps/playground`, or on published artifacts.

## 9. Risks

| Risk                                                                     | Mitigation                                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Deep CSS selector specificity in current `app.css` missed during rewrite | Implementation does a systematic rule-by-rule rewrite; manual visual verification catches strays         |
| Vendor CSS (AG Grid, MUI) clashes with `@pretable/ui/components.css`     | Scope vendor adapter renders under `.bench-adapter-*` wrapper if needed; `@pretable/ui` governs outside  |
| Tailwind v4 `@theme inline` duplication with playground                  | Pure duplication is fine; the two apps are independent surfaces. Not worth DRY-extracting for two apps.  |
| Visual regressions in a niche adapter render (e.g., MUI X hover state)   | Accept minor chrome mismatches; only fix the visual noise if it breaks function. Full polish is §6's job |
| Bench tests assert on a removed class/color                              | Preserve behavior: if legit user-facing assertion, adjust token map; if implementation-coupled, update   |

---

**End of spec.** Implementation plan follows via `superpowers:writing-plans` after user approval.

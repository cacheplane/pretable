# Website Drawer Takeover — Design

**Status:** Approved
**Date:** 2026-05-02
**Supersedes:** `2026-05-02-website-grid-as-hero-design.md` (peeking-drawer architecture)
**Related:** Bug 1 + Bug 2 from `docs/handoffs/2026-05-02-website-finish-line.md`

## Problem

PR #62 shipped a peeking-drawer architecture (75vh overlay, 56px peek visible at bottom of viewport). It does not work:

- `<DrawerHandle>` and `<Drawer>` were sibling elements in `page.tsx`. Only `<Drawer>` got pulled out of flow by the CSS upgrade. The handle floated unreachable in document flow below the 100vh hero. The peek a user saw was the drawer-content's sticky header, not a clickable handle. **Result: nobody can open the drawer.**
- The `/docs` link is broken from the previous round's nav refactor.
- Safari crashes the tab via "Maximum update depth exceeded" — `PretableSurface`'s telemetry effect refires every render because `HeroGrid` passes a new inline-arrow `onTelemetryChange` per render.
- The streaming demo at 1k events/sec doesn't read as "fast" — visually it's just rows ticking by. The product wedge isn't legible.
- The marketing content (6 sections) lives inside an unreachable overlay, so the homepage looks empty below the hero.

## Goal

Redesign the homepage so:

1. Cold landing on `/` shows **only** the live grid + a thin top control bar + a drawer handle pinned to the bottom of the viewport. Nothing else.
2. The drawer is a **fullscreen takeover** that slides up over the entire viewport (mobile-OS feel), with its own top nav, marketing sections, and footer.
3. Grid speed is **legible**: pause button, live counter, speed slider with discrete tiers.
4. The grid pauses while the drawer is open.
5. URL stays `/` throughout — no route change for the takeover. SEO crawlers see all marketing content rendered server-side.
6. `/docs` keeps its own route, with the same shared NavBar (without the close button) at the top.

## Architecture

### Single URL, SSR'd content, CSS-driven slide-up

The drawer content (NavBar + 6 sections + footer) is fully rendered server-side at `/`. JavaScript only animates the drawer between two states:

- **Closed:** `transform: translateY(100%)` — drawer hidden below the viewport.
- **Open:** `transform: translateY(0)` — drawer fills the viewport.

CSS transition: `transform 360ms cubic-bezier(0.32, 0.72, 0, 1)` (iOS-flavored spring easing). Reduced-motion → instant snap.

When closed, `pointer-events: none` on the drawer so the grid + handle are interactive. When open, `pointer-events: auto` and a `position: fixed; inset: 0; z-index: 50` so the drawer captures all interaction.

The drawer handle lives **inside** the drawer's outermost element (`.drawer-shell`), positioned absolutely at the bottom when closed (visible peek), out of view when open (covered by drawer content). Click on handle → drawer opens. Click on top-nav "Show the grid" button → drawer closes.

This DOM-first pattern means:

- SEO crawlers see a complete marketing page at `/`.
- No-JS users get a normal scroll page (drawer renders inline since the JS never adds the `data-drawer` attribute that triggers the CSS upgrade).
- Reduced-motion users get an instant open/close, no transform animation.

### Component layout

```
<html data-drawer="closed|open" lang="en">
  <body>
    <main>                                  {/* the grid + controls + handle */}
      <TopControlBar />                     {/* ~36px tall, console-style */}
      <HeroGrid />                          {/* fills remaining viewport */}
    </main>
    <DrawerShell>                           {/* fixed, full viewport, transformed */}
      <DrawerHandle />                      {/* 56px, bottom of shell when closed */}
      <DrawerContent>
        <NavBar mode="drawer" />            {/* shared with /docs */}
        <ReceiptsBand />
        <ComparisonTable />
        <HowItWorks />
        <CodeExample />
        <FeatureGrid />
        <CtaSection />
        <MountainFooter />
      </DrawerContent>
    </DrawerShell>
  </body>
</html>
```

### NavBar

Shared component, two modes:

- **`<NavBar mode="site">`** — used by `apps/website/app/docs/layout.tsx`. Brand left, `Docs` (current page indicator) + `GitHub` right. No close button.
- **`<NavBar mode="drawer">`** — used by `<DrawerContent>`. Brand left, anchor links center (`Receipts` / `Compare` / `How` / `Code` / `Features`), `Docs` + `GitHub` + **`Show the grid ↓`** right. Anchors smooth-scroll to section IDs within the drawer.

`<RouteAwareNav>` is renamed to `<NavBar>` and made mode-driven. The current "route-aware" highlighting logic stays, scoped to the `mode="site"` branch.

### TopControlBar

A 36px bar pinned to the top of the viewport on `/`. Three regions:

- **Left:** brand dot (`●` in accent color) + `pretable.ai` + separator + `events.stream`.
- **Center:** live counter — `<events>/s · <p95>ms · <fps>fps`. Updated 4× per second.
- **Right:** pause icon button + speed slider (4 discrete tiers: `Light 250 / Production 1k / Heavy 5k / Extreme 25k`). Default = `Production 1k`.

The bar is `position: relative; z-index: 10` so the drawer overlay (z-index 50) covers it cleanly when open.

Mobile (<768px): center counter shrinks to `<events>/s` only, pause + slider collapse behind a `⋯` overflow menu (a `<details>` element for zero-JS-friendly behavior).

### Grid controls integration

A new module `apps/website/app/components/heroGrid/controlState.ts` exposes a single source of truth via React context:

```ts
export interface HeroGridControlState {
  ratePerSec: number; // 250 | 1000 | 5000 | 25000
  setRatePerSec: (rate: number) => void;
  isPaused: boolean; // user toggle
  setIsPaused: (paused: boolean) => void;
  isDrawerOpen: boolean; // mirrored from useDrawer
  // Effective playing = !isPaused && !isDrawerOpen
}
```

`HeroGrid` reads `ratePerSec` and effective-playing, drives `createHeroReplay` accordingly. The replay engine gains `setRate(ratePerSec)` and respects `pause()`/`resume()` per-frame.

`<TopControlBar>` reads + writes `isPaused` and `ratePerSec`. `useDrawer` writes `isDrawerOpen`.

### Live counter wiring

- **events/sec:** maintained in HeroGrid by tracking emissions per 250ms window, smoothed with EMA.
- **p95 ms:** sourced from `PretableSurface`'s `onTelemetryChange` (telemetry already exposes frame-time stats — we just need to stabilize the callback per Bug 2 fix).
- **fps:** a small hook `useFps()` measuring `requestAnimationFrame` deltas, sliding window 60 frames.

All three pushed to a single `useState` in `<TopControlBar>`, updated 4× per second to avoid render storms.

### Drawer mechanics

`useDrawer` extends to:

- Write `data-drawer="closed"|"open"` to `<html>` (already does).
- Open via: handle click, anchor hash on mount (`/#receipts` etc.), `window.history.pushState({drawer: "open"}, "")` to enable back-button close.
- Close via: NavBar "Show the grid" click, Esc, popstate.
- Mirror state into the grid control context.

CSS upgrade rules in `globals.css`:

```css
@layer components {
  .drawer-shell {
    position: fixed;
    inset: 0;
    z-index: 50;
    pointer-events: none;
    transform: translateY(100%);
    transition: transform 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }
  html[data-drawer="open"] .drawer-shell {
    transform: translateY(0);
    pointer-events: auto;
  }
  html[data-drawer] .drawer-shell {
    display: block;
  }
  .drawer-handle {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: auto; /* always clickable, even when shell is non-interactive */
    z-index: 51;
  }
  html[data-drawer="open"] .drawer-handle {
    display: none; /* hide handle when drawer is open */
  }
  @media (prefers-reduced-motion: reduce) {
    .drawer-shell {
      transition: none;
    }
  }
}
```

When `data-drawer` is absent (no JS, viewport <768px, or hydration not yet run), the drawer renders in normal flow as a long page after the grid. This is the SEO/no-JS path. Below 768px the drawer-shell stays in normal flow (no fixed-position upgrade), so mobile users get a single scrolling page.

Wait — that's a behavior change from the current 768px gate. Re-thinking: on mobile (<768px), do we want the fullscreen slide-up takeover, or fallback-to-scroll?

**Decision:** keep the fullscreen slide-up on mobile too. The mobile-OS metaphor is exactly this. The 768px gate from the previous round only existed because the drawer was a bottom-peeking 75vh overlay that didn't make sense small. A fullscreen takeover works at every width.

Updated: drop the viewport-width gate in `useDrawer`. Always upgrade post-hydration. No-JS users get the inline-flow fallback, JS users get the slide-up at every width.

### Bug fixes folded in

- **Bug 1 (drawer architecture):** resolved by the new `<DrawerShell>` containing both handle and content; they share a single transformed element.
- **Bug 2 (Safari render loop):** `<HeroGrid>` no longer passes an inline `onTelemetryChange`. Instead, `useFps()` and the telemetry-derived counter live in a separate `<TelemetrySink>` component that mounts as a child of `<PretableSurface>` and reads telemetry via a `useCallback`-stable handler. Drops the inline-arrow per-render allocation.
- **`/docs` link broken:** `<NavBar>` uses Next `<Link href="/docs">`. The previous `<RouteAwareNav>` rendering issues are sidestepped because the new component is mounted in two places (drawer-content for `/`, docs-layout for `/docs`), neither of which has the prop drift problem the old version had.
- **MountainFooter relocation:** moves out of `apps/website/app/page.tsx` into `<DrawerContent>` as the last child. Drops from `/docs` (different surface — `/docs` keeps its own minimal layout).
- **`<TrailMarker>`s:** stay in ComparisonTable + FeatureGrid as cognitive-difficulty signals. Cohesive with mountain footer being inside the drawer too.

### Reduced motion

- Drawer transition disabled (instant open/close).
- Hero grid still shows 50-row static snapshot on mount (existing behavior).
- Counter fps stops updating (constant 60); pause + slider still functional but no rAF-driven counter churn.

## Out of scope for this PR

- A comparison toggle (pretable vs ag-grid vs tanstack) — separate sub-project.
- Dark mode — separate plan post-launch.
- Replacing the current marketing copy in the drawer's 6 sections — content audit is separate.
- Mobile-specific drawer content (different sections / collapsed copy). Just fits the existing content into the takeover.

## Verification

1. **Unit tests** — Vitest, jsdom, all existing tests stay green; new tests for `<NavBar>`, `<TopControlBar>`, `<DrawerShell>`, `useFps`, `controlState`.
2. **Cross-browser visual** — headed Playwright (`webkit`, `chromium`, `firefox`) at 320 / 375 / 768 / 1024 / 1280 / 1920 widths. Capture screenshots; verify no console errors during 5-second observation.
3. **Real Safari** — manual walkthrough on macOS Safari (real, not just WebKit engine). Verify: cold load shows grid + control bar + handle only; click handle slides up drawer; "Show the grid" closes; `/docs` link navigates; speed slider changes rate; pause stops the stream.
4. **iOS Safari** — same walkthrough on iPhone simulator or real device.
5. **Reduced motion** — toggle macOS setting; verify drawer instant-snap and no fps churn.
6. **Production validation** — after merge, walk `https://pretable.ai` in headed Chromium + WebKit. Lighthouse mobile + desktop, target Perf ≥ 80, A11y ≥ 95, BP ≥ 90, SEO ≥ 95.

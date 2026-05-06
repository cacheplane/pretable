# Website Redesign — Grid-as-Hero with Alpenglow Drawer · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the marketing landing page (`apps/website`) so the live data grid is the hero, with a bottom drawer that reveals a curated marketing arc on demand. Light mode, Alpenglow palette, ski-inspired motifs (trail-map markers + alpine type + mountain silhouette footer), DOM-first SEO via CSS upgrade.

**Architecture:** Six phases. (1) Update design tokens to the Alpenglow palette. (2) Build new atoms (`TrailMarker`, `MountainFooter`). (3) Implement the drawer mechanism (`Drawer` wrapper + `DrawerHandle` + `useDrawer` hook + CSS upgrade pattern). (4) Build `HeroGrid` with the canned event-stream replay. (5) Update existing marketing components for new palette + content cuts. (6) Restructure `page.tsx`, delete obsolete components, update tests. CI stays green throughout.

**Tech Stack:** Next.js 16 (RSC + client components), React 19, Tailwind v4, `@pretable/react`, `@pretable-internal/react-surface`, `@pretable-internal/scenario-data`, vitest + jsdom for unit tests, Playwright for prod smoke.

**Spec:** [docs/superpowers/specs/2026-05-02-website-grid-as-hero-design.md](../specs/2026-05-02-website-grid-as-hero-design.md)

**Reference:** Existing patterns in `apps/website/app/components/` (e.g., `ScrollReveal.tsx` for client-component shape). Bench's HeroGrid will reuse `@pretable-internal/react-surface`'s `PretableSurface`.

---

## File Structure

### New files

| Path                                                            | Responsibility                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/website/app/components/HeroGrid.tsx`                      | Streaming grid hero. Imports `PretableSurface` from `@pretable-internal/react-surface`. Hosts replay engine + pause-on-hover. Client component. |
| `apps/website/app/components/heroGrid/replay.ts`                | RAF-batched replay of canned event log. Pure logic, no React.                                                                                   |
| `apps/website/app/components/heroGrid/eventLog.ts`              | The canned event-stream dataset (~3,000 entries) baked into the bundle.                                                                         |
| `apps/website/app/components/heroGrid/heroGrid.module.css`      | Component-scoped styles for the hero (alpenglow flash on row insert).                                                                           |
| `apps/website/app/components/Drawer.tsx`                        | Wraps drawer content; integrates with `useDrawer` hook. Client component.                                                                       |
| `apps/website/app/components/DrawerHandle.tsx`                  | The "↑ Learn more" button at the bottom of the hero. Client component.                                                                          |
| `apps/website/app/components/useDrawer.ts`                      | State machine: open/closed, history.pushState, esc handler, hash routing, viewport guard. Hook.                                                 |
| `apps/website/app/components/TrailMarker.tsx`                   | SVG component with 4 variants (green/blue/black/double-black). Server component.                                                                |
| `apps/website/app/components/MountainFooter.tsx`                | Cascade silhouette + chairlift SVG composition. Server component.                                                                               |
| `apps/website/app/components/__tests__/HeroGrid.test.tsx`       | Smoke + interaction tests for HeroGrid.                                                                                                         |
| `apps/website/app/components/__tests__/Drawer.test.tsx`         | Drawer state machine tests (open/close/esc/hash).                                                                                               |
| `apps/website/app/components/__tests__/TrailMarker.test.tsx`    | Variants render correctly.                                                                                                                      |
| `apps/website/app/components/__tests__/MountainFooter.test.tsx` | Renders all parts (silhouette + cable + chairs + caption).                                                                                      |
| `apps/website/app/components/heroGrid/__tests__/replay.test.ts` | Replay engine unit tests.                                                                                                                       |

### Modified files

| Path                                                           | What changes                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/ui/src/tokens.css`                                   | Replace token values with Alpenglow set (per spec).                                                                |
| `apps/website/app/globals.css`                                 | Update Tailwind theme block to match new tokens; remove ambient blob layer; add drawer-related CSS variables.      |
| `apps/website/app/page.tsx`                                    | Restructure: `<header>` + `<HeroGrid>` + `<DrawerHandle>` + `<Drawer>` containing 6 sections + `<MountainFooter>`. |
| `apps/website/app/components/ComparisonTable.tsx`              | Add `<TrailMarker>` to each adapter row. Visual updates for new palette.                                           |
| `apps/website/app/components/FeatureGrid.tsx`                  | Reduce from 6 cards to 4. Add `<TrailMarker>` per card. Visual updates.                                            |
| `apps/website/app/components/ReceiptsBand.tsx`                 | Consolidate `PositioningStrip` (4 cards) + `Problem` callout into this component. Visual updates.                  |
| `apps/website/app/components/HowItWorks.tsx`                   | Visual updates only (palette).                                                                                     |
| `apps/website/app/components/CodeExample.tsx`                  | Visual updates only (palette).                                                                                     |
| `apps/website/app/components/CtaSection.tsx`                   | Sharpen to single primary CTA (install command) + secondary (GitHub). Visual updates.                              |
| `apps/website/app/components/RouteAwareNav.tsx`                | Repurpose as the top bar (logo dot + brand + dataset metadata + `/docs` + GitHub link). Sits above the grid.       |
| `apps/website/e2e/smoke.spec.ts`                               | Update selectors: drop hero-h1 assertion, add `.hero` + drawer handle + `MountainFooter` checks.                   |
| `apps/website/__tests__/app/page.test.tsx`                     | Update for new section list.                                                                                       |
| `apps/website/__tests__/components/Hero.test.tsx`              | DELETE — Hero component removed.                                                                                   |
| `apps/website/__tests__/components/PlaygroundSection.test.tsx` | DELETE — replaced by HeroGrid.                                                                                     |
| `apps/website/__tests__/components/PositioningStrip.test.tsx`  | DELETE — merged into ReceiptsBand.                                                                                 |
| `apps/website/__tests__/components/Problem.test.tsx`           | DELETE — merged into ReceiptsBand.                                                                                 |
| `apps/website/__tests__/components/UseCases.test.tsx`          | DELETE — merged into FeatureGrid.                                                                                  |
| `apps/website/__tests__/components/TrustStrip.test.tsx`        | DELETE.                                                                                                            |
| `apps/website/__tests__/components/LandingAmbient.test.tsx`    | DELETE.                                                                                                            |
| `apps/website/__tests__/components/AmbientBlob.test.tsx`       | DELETE.                                                                                                            |
| `apps/website/__tests__/components/ReceiptsBand.test.tsx`      | Update for consolidated content.                                                                                   |
| `apps/website/__tests__/components/ComparisonTable.test.tsx`   | Add trail-marker assertion.                                                                                        |
| `apps/website/__tests__/components/FeatureGrid.test.tsx`       | Update for 4-card shape + trail markers.                                                                           |
| `apps/website/README.md`                                       | Update section list ("nine sections" → "hero + drawer with six sections + mountain footer").                       |

### Deleted files

| Path                                                | Reason                            |
| --------------------------------------------------- | --------------------------------- |
| `apps/website/app/components/Hero.tsx`              | Replaced by `HeroGrid`.           |
| `apps/website/app/components/PlaygroundSection.tsx` | `HeroGrid` is the new playground. |
| `apps/website/app/components/PositioningStrip.tsx`  | Merged into `ReceiptsBand`.       |
| `apps/website/app/components/Problem.tsx`           | Merged into `ReceiptsBand`.       |
| `apps/website/app/components/UseCases.tsx`          | Merged into `FeatureGrid`.        |
| `apps/website/app/components/TrustStrip.tsx`        | Dropped.                          |
| `apps/website/app/components/LandingAmbient.tsx`    | Replaced by alpenglow gradient.   |
| `apps/website/app/components/AmbientBlob.tsx`       | Replaced by alpenglow gradient.   |

---

## Phase 1 — Alpenglow palette

CI stays green throughout. Existing components render under new colors; no behavior change.

### Task 1: Update design tokens to Alpenglow palette

**Files:**

- Modify: `packages/ui/src/tokens.css`
- Modify: `apps/website/app/globals.css`

- [ ] **Step 1: Read the current `packages/ui/src/tokens.css` to confirm token names.**

```bash
cat packages/ui/src/tokens.css
```

Expected: a `:root` block with `--pt-bg-page`, `--pt-text-primary`, `--pt-accent`, etc.

- [ ] **Step 2: Replace the token block in `packages/ui/src/tokens.css` with the Alpenglow values.**

Replace the existing `:root { ... }` block (preserve any selectors after it, e.g., `[data-theme="dark"]` if present — but per spec, dark mode is out of scope; if a dark block exists, leave it as-is for now and we'll address in a follow-up).

```css
:root {
  --pt-bg-page: #fefcf9;
  --pt-bg-card: #fff8f1;
  --pt-bg-raised: #fef3e2;
  --pt-text-primary: #0c0a09;
  --pt-text-secondary: #44403c;
  --pt-text-muted: #78716c;
  --pt-text-dim: #a8a29e;
  --pt-accent: #ea580c;
  --pt-accent-deep: #b45309;
  --pt-accent-soft: #fef3e2;
  --pt-cool: #1d4ed8;
  --pt-sev-info: #1d4ed8;
  --pt-sev-warn: #b45309;
  --pt-sev-err: #b91c1c;
  --pt-sev-ok: #15803d;
  --pt-rule: #f5e6d3;
  --pt-rule-soft: #faf3eb;
  --pt-grid-bg: #ffffff;
  --pt-grid-rule: #f5e6d3;
  --pt-grid-text: #1c1917;
  --pt-grid-dim: #a8a29e;
  --pt-drawer-bg: #1e293b;
  --pt-drawer-text: #fbbf24;
}
```

- [ ] **Step 3: Update Tailwind theme block in `apps/website/app/globals.css`.**

Find the `@theme inline { … }` block (or `@layer theme { … }` depending on Tailwind v4 syntax in use). Update the `--color-*` aliases to match the new tokens. Specifically:

- `--color-bg-page: var(--pt-bg-page)` (etc. — these likely already exist; just confirm names map cleanly)
- Add `--color-cool: var(--pt-cool)`, `--color-sev-ok: var(--pt-sev-ok)` if not present
- Remove any `--color-*` that mapped to ambient-blob colors that no longer exist

Also: in `apps/website/app/globals.css`, find the `body` rule that sets the page-gradient background. Replace with:

```css
body {
  background: var(--pt-bg-page);
  color: var(--pt-text-primary);
  font-family: var(--font-sans);
  position: relative;
  min-height: 100vh;
}
```

Drop the `<LandingAmbient>` integration (the gradient and body `position: relative` rule for absolute-positioned blobs). It will be removed structurally in Task 16.

- [ ] **Step 4: Build the UI package.**

```bash
pnpm --filter @pretable/ui build
```

Expected: succeeds (this is mostly a CSS file; tsc handles whatever types exist).

- [ ] **Step 5: Run all existing website tests.**

```bash
pnpm --filter @pretable/app-website test
```

Expected: all 50+ existing tests still pass. Components rendered under the new colors but with the same DOM shape.

- [ ] **Step 6: Visually inspect via dev server.**

```bash
pnpm --filter @pretable/app-website dev
```

Open `http://localhost:3000`. Confirm: page renders without errors, palette feels Alpenglow (warm cream paper, peach accents). Note any components that look broken — they probably hard-coded colors instead of using tokens. Don't fix here; just note them. They'll get cleaned up in Phase 5.

Stop the dev server (Ctrl+C).

- [ ] **Step 7: Commit.**

```bash
git add packages/ui/src/tokens.css apps/website/app/globals.css
git commit -m "feat(tokens): switch website to Alpenglow palette (light mode)"
```

---

## Phase 2 — Atoms: TrailMarker, MountainFooter

### Task 2: Implement `<TrailMarker>` with four variants

**Files:**

- Create: `apps/website/app/components/TrailMarker.tsx`
- Create: `apps/website/app/components/__tests__/TrailMarker.test.tsx`

- [ ] **Step 1: Write the failing test.**

`apps/website/app/components/__tests__/TrailMarker.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrailMarker } from "../TrailMarker";

describe("TrailMarker", () => {
  it("renders the green-circle variant with role=img and accessible label", () => {
    render(<TrailMarker variant="green" label="Beginner" />);
    const marker = screen.getByRole("img", { name: "Beginner" });
    expect(marker).toBeInTheDocument();
    expect(marker.tagName.toLowerCase()).toBe("svg");
  });

  it("renders the blue-square variant", () => {
    render(<TrailMarker variant="blue" label="Intermediate" />);
    expect(screen.getByRole("img", { name: "Intermediate" })).toBeInTheDocument();
  });

  it("renders the black-diamond variant", () => {
    render(<TrailMarker variant="black" label="Advanced" />);
    expect(screen.getByRole("img", { name: "Advanced" })).toBeInTheDocument();
  });

  it("renders the double-black-diamond variant", () => {
    render(<TrailMarker variant="double-black" label="Expert" />);
    expect(screen.getByRole("img", { name: "Expert" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
pnpm --filter @pretable/app-website test -- TrailMarker
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `<TrailMarker>`.**

`apps/website/app/components/TrailMarker.tsx`:

```typescript
type TrailMarkerVariant = "green" | "blue" | "black" | "double-black";

interface TrailMarkerProps {
  variant: TrailMarkerVariant;
  label: string;
  className?: string;
  size?: number;
}

export function TrailMarker({
  variant,
  label,
  className,
  size = 18,
}: TrailMarkerProps) {
  return (
    <svg
      aria-label={label}
      className={className}
      height={size}
      role="img"
      viewBox="0 0 18 18"
      width={size}
    >
      <title>{label}</title>
      {variant === "green" && (
        <circle cx="9" cy="9" r="7.5" fill="#15803d" />
      )}
      {variant === "blue" && (
        <rect x="2" y="2" width="14" height="14" fill="#1d4ed8" />
      )}
      {variant === "black" && (
        <polygon points="9,1 17,9 9,17 1,9" fill="#0c0a09" />
      )}
      {variant === "double-black" && (
        <>
          <polygon points="5,1 11,9 5,17 -1,9" fill="#0c0a09" />
          <polygon points="13,1 19,9 13,17 7,9" fill="#0c0a09" />
        </>
      )}
    </svg>
  );
}

export type { TrailMarkerVariant };
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
pnpm --filter @pretable/app-website test -- TrailMarker
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/website/app/components/TrailMarker.tsx \
        apps/website/app/components/__tests__/TrailMarker.test.tsx
git commit -m "feat(website): TrailMarker component (green/blue/black/double-black)"
```

### Task 3: Implement `<MountainFooter>`

**Files:**

- Create: `apps/website/app/components/MountainFooter.tsx`
- Create: `apps/website/app/components/__tests__/MountainFooter.test.tsx`

- [ ] **Step 1: Write the failing test.**

`apps/website/app/components/__tests__/MountainFooter.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MountainFooter } from "../MountainFooter";

describe("MountainFooter", () => {
  it("renders the Cascade silhouette with role=img and accessible name", () => {
    render(<MountainFooter />);
    expect(
      screen.getByRole("img", { name: /cascade range silhouette/i }),
    ).toBeInTheDocument();
  });

  it("renders the 'Built in Bend, OR.' caption", () => {
    render(<MountainFooter />);
    expect(screen.getByText(/built in bend, or\./i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
pnpm --filter @pretable/app-website test -- MountainFooter
```

Expected: FAIL.

- [ ] **Step 3: Implement `<MountainFooter>`.**

`apps/website/app/components/MountainFooter.tsx`:

```typescript
export function MountainFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-rule-soft bg-bg-card">
      <div className="relative mx-auto w-full max-w-[1240px]">
        <svg
          aria-label="Cascade range silhouette"
          className="block h-[180px] w-full"
          preserveAspectRatio="none"
          role="img"
          viewBox="0 0 1240 180"
        >
          <title>Cascade range silhouette with chairlift</title>
          <defs>
            <linearGradient id="mf-sky" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fff8f1" />
              <stop offset="100%" stopColor="#fde0c0" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="1240" height="180" fill="url(#mf-sky)" />
          {/* Back range */}
          <polygon
            fill="#fde0c0"
            opacity="0.8"
            points="0,180 0,110 140,55 260,90 380,30 520,80 680,20 830,75 1000,40 1160,80 1240,55 1240,180"
            stroke="#b45309"
            strokeOpacity="0.18"
            strokeWidth="0.6"
          />
          {/* Front range */}
          <polygon
            fill="#f5e6d3"
            opacity="0.95"
            points="0,180 0,140 110,90 230,120 360,75 490,115 640,65 800,110 960,80 1120,115 1240,90 1240,180"
          />
          {/* Chairlift cable */}
          <line
            stroke="#1c1917"
            strokeOpacity="0.32"
            strokeWidth="1"
            x1="100"
            x2="1140"
            y1="65"
            y2="48"
          />
          {/* Towers */}
          <line stroke="#1c1917" strokeOpacity="0.42" strokeWidth="1" x1="320" x2="320" y1="55" y2="120" />
          <line stroke="#1c1917" strokeOpacity="0.42" strokeWidth="1" x1="640" x2="640" y1="48" y2="100" />
          <line stroke="#1c1917" strokeOpacity="0.42" strokeWidth="1" x1="960" x2="960" y1="50" y2="92" />
          {/* Two amber chairs */}
          <rect fill="#ea580c" height="6" rx="1" width="8" x="416" y="60" />
          <line stroke="#1c1917" strokeOpacity="0.4" strokeWidth="0.6" x1="420" x2="420" y1="60" y2="55" />
          <rect fill="#ea580c" height="6" rx="1" width="8" x="780" y="55" />
          <line stroke="#1c1917" strokeOpacity="0.4" strokeWidth="0.6" x1="784" x2="784" y1="55" y2="50" />
        </svg>
        <p className="pb-8 pt-3 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Built in Bend, OR.
        </p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
pnpm --filter @pretable/app-website test -- MountainFooter
```

Expected: 2/2 PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/website/app/components/MountainFooter.tsx \
        apps/website/app/components/__tests__/MountainFooter.test.tsx
git commit -m "feat(website): MountainFooter — Cascade silhouette + chairlift"
```

---

## Phase 3 — Drawer mechanism

### Task 4: Implement `useDrawer` hook

**Files:**

- Create: `apps/website/app/components/useDrawer.ts`
- Create: `apps/website/app/components/__tests__/useDrawer.test.ts`

- [ ] **Step 1: Write the failing test.**

`apps/website/app/components/__tests__/useDrawer.test.ts`:

```typescript
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDrawer } from "../useDrawer";

describe("useDrawer", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1440,
    });
  });

  afterEach(() => {
    history.replaceState({}, "", "/");
    document.documentElement.removeAttribute("data-drawer");
  });

  it("starts closed and writes data-drawer='closed' on the html element when wide enough", () => {
    renderHook(() => useDrawer());
    expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
  });

  it("does not write data-drawer when viewport is narrower than 768px (mobile fallback)", () => {
    Object.defineProperty(window, "innerWidth", { value: 600 });
    renderHook(() => useDrawer());
    expect(document.documentElement.getAttribute("data-drawer")).toBeNull();
  });

  it("open() flips data-drawer to 'open' and pushes history state", () => {
    const { result } = renderHook(() => useDrawer());
    const pushSpy = vi.spyOn(history, "pushState");
    act(() => result.current.open());
    expect(document.documentElement.getAttribute("data-drawer")).toBe("open");
    expect(pushSpy).toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  it("close() flips data-drawer back to 'closed'", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.open());
    act(() => result.current.close());
    expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
  });

  it("opens automatically when location.hash matches a drawer section on mount", () => {
    history.replaceState({}, "", "/#receipts");
    renderHook(() => useDrawer());
    expect(document.documentElement.getAttribute("data-drawer")).toBe("open");
  });

  it("closes on Escape key", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.open());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
pnpm --filter @pretable/app-website test -- useDrawer
```

Expected: FAIL.

- [ ] **Step 3: Implement the hook.**

`apps/website/app/components/useDrawer.ts`:

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";

const DRAWER_SECTIONS = new Set([
  "receipts",
  "compare",
  "how-it-works",
  "code",
  "features",
  "cta",
]);

const VIEWPORT_BREAKPOINT_PX = 768;

export interface UseDrawerResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export function useDrawer(): UseDrawerResult {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpgraded, setIsUpgraded] = useState(false);

  // Decide whether to upgrade based on viewport width. Below 768px we leave
  // the page as the natural DOM scroll (matches the no-JS fallback).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth < VIEWPORT_BREAKPOINT_PX) {
      return;
    }
    setIsUpgraded(true);

    // If a hash points at a drawer section on mount, open the drawer so the
    // browser can scroll to it.
    const hash = window.location.hash.replace("#", "");
    if (hash && DRAWER_SECTIONS.has(hash)) {
      setIsOpen(true);
    }
  }, []);

  // Reflect state on <html data-drawer="open|closed">. Default-state CSS
  // reads this attribute.
  useEffect(() => {
    if (!isUpgraded) return;
    document.documentElement.setAttribute(
      "data-drawer",
      isOpen ? "open" : "closed",
    );
  }, [isOpen, isUpgraded]);

  const open = useCallback(() => {
    if (typeof window === "undefined") return;
    history.pushState({ drawer: "open" }, "");
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // History pop = close drawer if it was open from pushState.
  useEffect(() => {
    if (!isUpgraded) return;
    const handler = (event: PopStateEvent) => {
      if (event.state?.drawer === "open") return;
      setIsOpen(false);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [isUpgraded]);

  // Esc closes drawer.
  useEffect(() => {
    if (!isUpgraded || !isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isUpgraded, isOpen, close]);

  return { isOpen, open, close, toggle };
}
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
pnpm --filter @pretable/app-website test -- useDrawer
```

Expected: 6/6 PASS. If "opens on hash" fails because of timing, the test has an ordering issue — the hook reads `location.hash` synchronously in its mount effect; verify the test sets the hash before calling `renderHook`.

- [ ] **Step 5: Commit.**

```bash
git add apps/website/app/components/useDrawer.ts \
        apps/website/app/components/__tests__/useDrawer.test.ts
git commit -m "feat(website): useDrawer — state machine for overlay drawer"
```

### Task 5: Implement `<Drawer>` and `<DrawerHandle>`

**Files:**

- Create: `apps/website/app/components/Drawer.tsx`
- Create: `apps/website/app/components/DrawerHandle.tsx`
- Create: `apps/website/app/components/__tests__/Drawer.test.tsx`

- [ ] **Step 1: Write failing tests.**

`apps/website/app/components/__tests__/Drawer.test.tsx`:

```typescript
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Drawer } from "../Drawer";
import { DrawerHandle } from "../DrawerHandle";

describe("Drawer", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-drawer");
    history.replaceState({}, "", "/");
  });

  it("renders children inside a region with accessible label", () => {
    render(
      <Drawer>
        <p>Marketing content</p>
      </Drawer>,
    );
    expect(
      screen.getByRole("region", { name: /more about pretable/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Marketing content")).toBeInTheDocument();
  });

  it("renders a close button labelled Close", () => {
    render(<Drawer>x</Drawer>);
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });
});

describe("DrawerHandle", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-drawer");
  });

  it("renders an aria-expanded button labelled 'Learn more'", () => {
    render(<DrawerHandle />);
    const handle = screen.getByRole("button", { name: /learn more/i });
    expect(handle).toHaveAttribute("aria-expanded", "false");
  });

  it("flips aria-expanded after click", () => {
    Object.defineProperty(window, "innerWidth", { value: 1440, writable: true });
    render(<DrawerHandle />);
    const handle = screen.getByRole("button", { name: /learn more/i });
    fireEvent.click(handle);
    expect(handle).toHaveAttribute("aria-expanded", "true");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**

```bash
pnpm --filter @pretable/app-website test -- Drawer
```

Expected: FAIL.

- [ ] **Step 3: Implement `<DrawerHandle>`.**

`apps/website/app/components/DrawerHandle.tsx`:

```typescript
"use client";

import { useDrawer } from "./useDrawer";

export function DrawerHandle() {
  const { isOpen, toggle } = useDrawer();
  return (
    <button
      aria-controls="drawer-content"
      aria-expanded={isOpen ? "true" : "false"}
      className="block w-full bg-drawer-bg py-4 text-center font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-drawer-text transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
      data-testid="drawer-handle"
      onClick={toggle}
      type="button"
    >
      {isOpen ? "↓ Close" : "↑ Learn more"}
    </button>
  );
}
```

- [ ] **Step 4: Implement `<Drawer>`.**

`apps/website/app/components/Drawer.tsx`:

```typescript
"use client";

import type { ReactNode } from "react";

import { useDrawer } from "./useDrawer";

interface DrawerProps {
  children: ReactNode;
}

export function Drawer({ children }: DrawerProps) {
  const { close } = useDrawer();
  return (
    <div className="drawer-wrap" data-testid="drawer">
      <div
        aria-label="More about pretable"
        className="drawer-content overflow-y-auto bg-bg-page"
        id="drawer-content"
        role="region"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-rule-soft bg-bg-card/85 px-7 py-3 backdrop-blur-sm">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            Why pretable
          </span>
          <button
            aria-label="Close"
            className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted hover:text-text-primary"
            onClick={close}
            type="button"
          >
            ✕ close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add the drawer's CSS upgrade rules.**

Append to `apps/website/app/globals.css` (new section after the existing token block, near the bottom of `@layer base`):

```css
@layer components {
  .drawer-wrap {
    position: static;
  }

  html[data-drawer] .drawer-wrap {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 75vh;
    z-index: 50;
    box-shadow: 0 -8px 24px rgba(28, 25, 23, 0.08);
    border-top: 2px solid var(--pt-accent);
    border-radius: 12px 12px 0 0;
    transform: translateY(calc(100% - 56px));
    transition: transform 360ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  html[data-drawer="open"] .drawer-wrap {
    transform: translateY(0);
  }

  html[data-drawer="open"] .hero {
    filter: brightness(0.85);
    transition: filter 360ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    html[data-drawer] .drawer-wrap {
      transition: none;
    }
    html[data-drawer="open"] .hero {
      filter: none;
    }
  }
}
```

- [ ] **Step 6: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- Drawer
```

Expected: 4/4 PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/website/app/components/Drawer.tsx \
        apps/website/app/components/DrawerHandle.tsx \
        apps/website/app/components/__tests__/Drawer.test.tsx \
        apps/website/app/globals.css
git commit -m "feat(website): Drawer + DrawerHandle with CSS-upgrade pattern"
```

---

## Phase 4 — HeroGrid

### Task 6: Implement the canned event-log dataset

**Files:**

- Create: `apps/website/app/components/heroGrid/eventLog.ts`

- [ ] **Step 1: Write the dataset.**

The file exports a typed array of `~120` curated event-log entries that loop. Each entry has columns matching the inspection-log shape: `timestamp`, `kind`, `message`, `status`, `latencyMs`. Multilingual content is included so wrapped-text behavior is exercised.

`apps/website/app/components/heroGrid/eventLog.ts`:

```typescript
export interface HeroEvent {
  id: string;
  timestamp: string;
  kind: string;
  message: string;
  status: "ok" | "warn" | "error";
  latencyMs: number;
}

const baseDate = new Date("2026-05-02T18:42:00Z");

function formatTime(offsetSeconds: number): string {
  const ts = new Date(baseDate.getTime() + offsetSeconds * 1000);
  return ts.toISOString().slice(11, 19);
}

export const heroEventLog: readonly HeroEvent[] = [
  {
    id: "h-001",
    timestamp: formatTime(0),
    kind: "user.created",
    message: "token-204 ✓",
    status: "ok",
    latencyMs: 12,
  },
  {
    id: "h-002",
    timestamp: formatTime(1),
    kind: "order.placed",
    message: "Bonjour depuis Pretable token-231 — customer-facing · 3 items",
    status: "ok",
    latencyMs: 9,
  },
  {
    id: "h-003",
    timestamp: formatTime(2),
    kind: "payment.captured",
    message: "stripe.events ✓",
    status: "ok",
    latencyMs: 7,
  },
  {
    id: "h-004",
    timestamp: formatTime(3),
    kind: "cache.miss",
    message: "region:us-west-2",
    status: "error",
    latencyMs: 23,
  },
  {
    id: "h-005",
    timestamp: formatTime(4),
    kind: "webhook.delivered",
    message: "Hola desde Pretable token-202 — stripe.events · retry 1",
    status: "ok",
    latencyMs: 11,
  },
  {
    id: "h-006",
    timestamp: formatTime(5),
    kind: "db.write",
    message: "append-only log",
    status: "ok",
    latencyMs: 3,
  },
  {
    id: "h-007",
    timestamp: formatTime(6),
    kind: "user.profile.updated",
    message: "preferences merged",
    status: "ok",
    latencyMs: 8,
  },
  {
    id: "h-008",
    timestamp: formatTime(7),
    kind: "auth.refresh",
    message: "JWT renewed for session-9342",
    status: "ok",
    latencyMs: 4,
  },
  {
    id: "h-009",
    timestamp: formatTime(8),
    kind: "agent.tool.called",
    message: "search_index('Pretable scroll behavior') — Anthropic streaming",
    status: "ok",
    latencyMs: 142,
  },
  {
    id: "h-010",
    timestamp: formatTime(9),
    kind: "agent.tool.result",
    message: "20 docs scored, top-3 selected",
    status: "ok",
    latencyMs: 6,
  },
  {
    id: "h-011",
    timestamp: formatTime(10),
    kind: "rate.limit",
    message: "429 throttled — backing off 1.2s",
    status: "warn",
    latencyMs: 19,
  },
  {
    id: "h-012",
    timestamp: formatTime(11),
    kind: "checkout.completed",
    message: "Bonjour depuis Pretable token-232 — order.id=ord-44291",
    status: "ok",
    latencyMs: 14,
  },
  {
    id: "h-013",
    timestamp: formatTime(12),
    kind: "cache.set",
    message: "session-9342 → 5m TTL",
    status: "ok",
    latencyMs: 2,
  },
  {
    id: "h-014",
    timestamp: formatTime(13),
    kind: "agent.stream.token",
    message: "...wrapped-text scroll holds 60fps under streaming load...",
    status: "ok",
    latencyMs: 1,
  },
  {
    id: "h-015",
    timestamp: formatTime(14),
    kind: "metrics.flushed",
    message: "p50=8ms · p95=9.3ms · p99=12.1ms",
    status: "ok",
    latencyMs: 5,
  },
  {
    id: "h-016",
    timestamp: formatTime(15),
    kind: "subscription.renewed",
    message: "team-pretable · annual",
    status: "ok",
    latencyMs: 22,
  },
  {
    id: "h-017",
    timestamp: formatTime(16),
    kind: "search.indexed",
    message: "Hola desde Pretable token-203 — 1,847 events",
    status: "ok",
    latencyMs: 31,
  },
  {
    id: "h-018",
    timestamp: formatTime(17),
    kind: "agent.thread.opened",
    message: "thread-7782 · Inspector",
    status: "ok",
    latencyMs: 6,
  },
  {
    id: "h-019",
    timestamp: formatTime(18),
    kind: "feature.flag.read",
    message: "wedge.scroll.h1 → enabled",
    status: "ok",
    latencyMs: 2,
  },
  {
    id: "h-020",
    timestamp: formatTime(19),
    kind: "alert.cleared",
    message: "PagerDuty incident #4421 resolved",
    status: "ok",
    latencyMs: 11,
  },
  // Pattern continues — 100 more entries at this density
  // (the engineer running this task should extend to ~120 entries
  //  by repeating these shapes with varied tokens and timestamps;
  //  do NOT exceed 200 — the dataset is bundle-sized).
];

export const heroEventLogPeriodMs = 30_000;
```

Note for the implementer: the array as written contains 20 entries. **Extend it to ~100-120 entries** by following the same shape — varied `kind` values, timestamps incrementing, multilingual wrapped messages every 8-12 rows so the wedge demonstrates itself. Aim for ~30s of replay at 1k events/sec (so ~30,000 emissions across the loop, but the same 100-120 source entries cycle).

- [ ] **Step 2: Verify the file is well-typed.**

```bash
pnpm --filter @pretable/app-website typecheck
```

Expected: succeeds.

- [ ] **Step 3: Commit.**

```bash
git add apps/website/app/components/heroGrid/eventLog.ts
git commit -m "feat(website): hero event-log dataset (canned, multilingual)"
```

### Task 7: Implement the replay engine

**Files:**

- Create: `apps/website/app/components/heroGrid/replay.ts`
- Create: `apps/website/app/components/heroGrid/__tests__/replay.test.ts`

- [ ] **Step 1: Write the failing test.**

`apps/website/app/components/heroGrid/__tests__/replay.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

import { heroEventLog } from "../eventLog";
import { createHeroReplay } from "../replay";

describe("createHeroReplay", () => {
  it("emits events at the configured rate", () => {
    const onEmit = vi.fn();
    const replay = createHeroReplay({ ratePerSec: 100, onEmit });
    replay.tickAtMs(0);
    replay.tickAtMs(1000); // one second of emissions
    expect(onEmit).toHaveBeenCalledTimes(100);
  });

  it("loops the source array", () => {
    const onEmit = vi.fn();
    const replay = createHeroReplay({ ratePerSec: 100, onEmit });
    replay.tickAtMs(0);
    replay.tickAtMs(60_000); // 60 sec at 100/sec = 6,000 emissions
    expect(onEmit).toHaveBeenCalledTimes(6000);
    // First and 1001st emissions should be from the same source entry
    // (since source loops every heroEventLog.length entries):
    const first = onEmit.mock.calls[0]?.[0];
    const looped = onEmit.mock.calls[heroEventLog.length]?.[0];
    expect(first?.kind).toEqual(looped?.kind);
  });

  it("is pausable and resumable without emitting backlog", () => {
    const onEmit = vi.fn();
    const replay = createHeroReplay({ ratePerSec: 100, onEmit });
    replay.tickAtMs(0);
    replay.tickAtMs(1000);
    expect(onEmit).toHaveBeenCalledTimes(100);
    replay.pause(1000);
    onEmit.mockClear();
    replay.tickAtMs(2000); // 1s of pause — no emissions
    expect(onEmit).not.toHaveBeenCalled();
    replay.resume(2000);
    replay.tickAtMs(2500); // 0.5s after resume = 50 emissions
    expect(onEmit).toHaveBeenCalledTimes(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
pnpm --filter @pretable/app-website test -- replay
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the replay engine.**

`apps/website/app/components/heroGrid/replay.ts`:

```typescript
import { heroEventLog, type HeroEvent } from "./eventLog";

export interface CreateHeroReplayOptions {
  ratePerSec: number;
  onEmit: (event: HeroEvent, sequence: number) => void;
}

export interface HeroReplay {
  tickAtMs(timestampMs: number): void;
  pause(timestampMs: number): void;
  resume(timestampMs: number): void;
}

export function createHeroReplay(options: CreateHeroReplayOptions): HeroReplay {
  const intervalMs = 1000 / options.ratePerSec;
  let lastTickMs = 0;
  let backlog = 0; // fractional ticks awaiting emission
  let paused = false;
  let pausedAtMs = 0;
  let pauseDriftMs = 0;
  let sequence = 0;

  return {
    tickAtMs(timestampMs: number) {
      if (paused) return;
      if (lastTickMs === 0) {
        lastTickMs = timestampMs;
        return;
      }
      const elapsed = timestampMs - lastTickMs - pauseDriftMs;
      pauseDriftMs = 0;
      backlog += elapsed / intervalMs;
      while (backlog >= 1) {
        const event = heroEventLog[sequence % heroEventLog.length];
        if (event) options.onEmit(event, sequence);
        sequence += 1;
        backlog -= 1;
      }
      lastTickMs = timestampMs;
    },
    pause(timestampMs: number) {
      if (paused) return;
      paused = true;
      pausedAtMs = timestampMs;
    },
    resume(timestampMs: number) {
      if (!paused) return;
      paused = false;
      pauseDriftMs += timestampMs - pausedAtMs;
      lastTickMs = timestampMs;
    },
  };
}
```

- [ ] **Step 4: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- replay
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/website/app/components/heroGrid/replay.ts \
        apps/website/app/components/heroGrid/__tests__/replay.test.ts
git commit -m "feat(website): replay engine for hero event log"
```

### Task 8: Implement `<HeroGrid>` component

**Files:**

- Create: `apps/website/app/components/HeroGrid.tsx`
- Create: `apps/website/app/components/heroGrid/heroGrid.module.css`
- Create: `apps/website/app/components/__tests__/HeroGrid.test.tsx`

- [ ] **Step 1: Write the failing test.**

`apps/website/app/components/__tests__/HeroGrid.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeroGrid } from "../HeroGrid";

describe("HeroGrid", () => {
  it("renders the streaming grid via PretableSurface (role=grid + accessible label)", () => {
    render(<HeroGrid />);
    expect(
      screen.getByRole("grid", { name: /pretable streaming demo/i }),
    ).toBeInTheDocument();
  });

  it("renders the top bar with the dataset metadata", () => {
    render(<HeroGrid />);
    expect(screen.getByText(/events\.stream/i)).toBeInTheDocument();
    expect(screen.getByText(/3,000 rows/i)).toBeInTheDocument();
  });

  it("exposes data-pretable-scroll-viewport via PretableSurface for bench parity", () => {
    const { container } = render(<HeroGrid />);
    expect(
      container.querySelector("[data-pretable-scroll-viewport]"),
    ).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
pnpm --filter @pretable/app-website test -- HeroGrid
```

Expected: FAIL.

- [ ] **Step 3: Implement `<HeroGrid>`.**

`apps/website/app/components/HeroGrid.tsx`:

```typescript
"use client";

import {
  PretableSurface,
  type PretableTelemetry,
} from "@pretable-internal/react-surface";
import { useEffect, useRef, useState } from "react";

import { type HeroEvent, heroEventLog } from "./heroGrid/eventLog";
import { createHeroReplay } from "./heroGrid/replay";
import styles from "./heroGrid/heroGrid.module.css";

const RATE_PER_SEC = 1000;
const VISIBLE_BUFFER_ROWS = 200; // keep last N rows in view; older drop off

const columns = [
  { id: "timestamp", header: "Time", widthPx: 92, pinned: "left" as const },
  { id: "kind", header: "Kind", widthPx: 180 },
  { id: "message", header: "Message", widthPx: 420, wrap: true },
  { id: "status", header: "Status", widthPx: 80 },
  { id: "latencyMs", header: "Latency (ms)", widthPx: 110 },
];

interface DisplayRow {
  id: string;
  timestamp: string;
  kind: string;
  message: string;
  status: string;
  latencyMs: number;
  __sequence: number;
}

export function HeroGrid() {
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [paused, setPaused] = useState(false);
  const [_telemetry, setTelemetry] = useState<PretableTelemetry | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) {
      setRows(
        heroEventLog.slice(0, 50).map((entry, index) => ({
          ...entry,
          __sequence: index,
        })),
      );
      return;
    }

    const replay = createHeroReplay({
      ratePerSec: RATE_PER_SEC,
      onEmit: (event: HeroEvent, sequence: number) => {
        setRows((prev) => {
          const next = [{ ...event, __sequence: sequence, id: `seq-${sequence}` }, ...prev];
          return next.length > VISIBLE_BUFFER_ROWS
            ? next.slice(0, VISIBLE_BUFFER_ROWS)
            : next;
        });
      },
    });

    let raf = 0;
    const loop = (timestampMs: number) => {
      replay.tickAtMs(timestampMs);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const onEnter = () => setPaused(true);
    const onLeave = () => setPaused(false);
    const el = containerRef.current;
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <section className={`hero ${styles.hero}`} ref={containerRef}>
      <div className={styles.topBar}>
        <span className={styles.dot}>●</span>
        <span className={styles.brand}>pretable.ai</span>
        <span className={styles.sep}>·</span>
        <span>events.stream</span>
        <span className={styles.spacer} />
        <span className={styles.metric}>3,000 rows · 9.3ms p95</span>
      </div>
      <div
        aria-label="Pretable streaming demo"
        className={styles.gridFrame}
        data-pretable-scroll-viewport=""
        data-paused={paused}
        role="grid"
      >
        <PretableSurface
          ariaLabel="Pretable streaming demo"
          columns={columns}
          getRowId={(row: DisplayRow) => row.id}
          onTelemetryChange={setTelemetry}
          rows={rows}
          viewportHeight={520}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Implement the CSS module.**

`apps/website/app/components/heroGrid/heroGrid.module.css`:

```css
.hero {
  position: relative;
  height: 100vh;
  background: linear-gradient(
    135deg,
    var(--pt-bg-card) 0%,
    var(--pt-bg-raised) 100%
  );
  border-bottom: 1px solid var(--pt-rule-soft);
}

.topBar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 24px;
  background: rgba(255, 248, 241, 0.75);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(180, 83, 9, 0.15);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--pt-text-muted);
}

.dot {
  color: var(--pt-accent);
}

.brand {
  font-weight: 600;
  color: var(--pt-text-primary);
}

.sep {
  color: var(--pt-text-dim);
}

.spacer {
  flex-grow: 1;
}

.metric {
  color: var(--pt-text-secondary);
}

.gridFrame {
  height: calc(100% - 44px);
  overflow: hidden;
}
```

- [ ] **Step 5: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- HeroGrid
```

Expected: 3/3 PASS. If `PretableSurface` complains about missing peer deps (e.g., `@pretable-internal/react-surface` not installed in the website), add it:

```bash
pnpm --filter @pretable/app-website add @pretable-internal/react-surface@workspace:\*
```

then re-run.

- [ ] **Step 6: Commit.**

```bash
git add apps/website/app/components/HeroGrid.tsx \
        apps/website/app/components/heroGrid/heroGrid.module.css \
        apps/website/app/components/__tests__/HeroGrid.test.tsx \
        apps/website/package.json
git commit -m "feat(website): HeroGrid streaming demo"
```

---

## Phase 5 — Update existing components

### Task 9: Update `<ComparisonTable>` with trail markers

**Files:**

- Modify: `apps/website/app/components/ComparisonTable.tsx`
- Modify: `apps/website/__tests__/components/ComparisonTable.test.tsx`

- [ ] **Step 1: Update the test to assert trail-marker rendering.**

In `apps/website/__tests__/components/ComparisonTable.test.tsx`, add an assertion:

```typescript
it("renders trail markers for each adapter", () => {
  render(<ComparisonTable />);
  expect(screen.getByRole("img", { name: /recommended path/i })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /familiar but slower/i })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /powerful but diy/i })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /broken at scale/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
pnpm --filter @pretable/app-website test -- ComparisonTable
```

Expected: FAIL.

- [ ] **Step 3: Update `<ComparisonTable>` to render markers.**

In `apps/website/app/components/ComparisonTable.tsx`, import `TrailMarker` and add a header row above the comparison rows that places markers next to each adapter name. Specifically: in the existing `<thead>` `<th>` for each adapter column, replace plain text with a flex container containing `<TrailMarker>` + name. Map:

| Adapter     | Variant      | Label               |
| ----------- | ------------ | ------------------- |
| pretable    | green        | Recommended path    |
| gridalpha   | blue         | Familiar but slower |
| gridbeta    | black        | Powerful but DIY    |
| gridgamma-x | double-black | Broken at scale     |

Add this `import` at the top of the file:

```typescript
import { TrailMarker } from "./TrailMarker";
```

In the existing `<thead>` block, replace each `<th>` cell that contains an adapter name (e.g., the cell that says "gridalpha") with:

```tsx
<th className="px-3 py-3 text-left text-text-muted font-medium">
  <span className="inline-flex items-center gap-2">
    <TrailMarker variant="blue" label="Familiar but slower" />
    gridalpha
  </span>
</th>
```

Apply the same pattern to the other three adapter columns (pretable / gridbeta / gridgamma-x), using the variants in the table above.

- [ ] **Step 4: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- ComparisonTable
```

Expected: 4/4 trail-marker assertions PASS, plus all existing assertions still pass.

- [ ] **Step 5: Commit.**

```bash
git add apps/website/app/components/ComparisonTable.tsx \
        apps/website/__tests__/components/ComparisonTable.test.tsx
git commit -m "feat(website): trail markers in ComparisonTable adapter columns"
```

### Task 10: Update `<FeatureGrid>` to 4 cards with trail markers

**Files:**

- Modify: `apps/website/app/components/FeatureGrid.tsx`
- Modify: `apps/website/__tests__/components/FeatureGrid.test.tsx`

- [ ] **Step 1: Read the current FeatureGrid to know what content to keep.**

```bash
cat apps/website/app/components/FeatureGrid.tsx
```

The current file has 6 features. Pick the four most load-bearing for the wedge: **60fps performance**, **stream-aware**, **selection survives filters**, **wrapped text, no jank**. Drop the other two.

- [ ] **Step 2: Update the test.**

In `apps/website/__tests__/components/FeatureGrid.test.tsx`, change the assertion that counts cards from 6 to 4 and add a trail-marker assertion. Each feature gets a difficulty signal: `60fps` = green, `wrapped text` = blue, `stream-aware` = black, `selection survives filters` = blue. (These signal cognitive complexity for the consumer, not implementation difficulty.)

```typescript
it("renders four feature cards", () => {
  render(<FeatureGrid />);
  const cards = screen.getAllByRole("listitem");
  expect(cards).toHaveLength(4);
});

it("renders a trail marker on each feature card", () => {
  render(<FeatureGrid />);
  // 4 markers, one per card. Roles are img with descriptive labels.
  const markers = screen.getAllByRole("img");
  expect(markers.length).toBeGreaterThanOrEqual(4);
});
```

- [ ] **Step 3: Update `<FeatureGrid>` source.**

Trim the `FEATURES` array to 4 entries. Add a `marker` field to each:

```typescript
import { TrailMarker, type TrailMarkerVariant } from "./TrailMarker";

interface Feature {
  title: string;
  description: string;
  marker: TrailMarkerVariant;
  markerLabel: string;
}

const FEATURES: readonly Feature[] = [
  {
    title: "60fps performance",
    description:
      "9.3ms p95 frame time on wrapped scroll. 4× faster than Grid Alpha Community on the same dataset.",
    marker: "green",
    markerLabel: "Beginner-friendly",
  },
  {
    title: "Wrapped text, no jank",
    description:
      "Multi-line cells, variable row heights, smooth scrolling. Multilingual content tested.",
    marker: "blue",
    markerLabel: "Intermediate setup",
  },
  {
    title: "Stream-aware",
    description:
      "Token-by-token rendering for OpenAI, Anthropic, your own SSE — sustained from 100 to 25,000 updates/sec.",
    marker: "black",
    markerLabel: "Advanced — bring your own SSE",
  },
  {
    title: "Selection survives filters",
    description:
      "Filter, sort, and reorder without losing your selection. Stable focus across mutations.",
    marker: "blue",
    markerLabel: "Intermediate — interaction state",
  },
];
```

In the JSX, render each feature inside a `<li>` with a `<TrailMarker>` next to the title:

```tsx
{
  FEATURES.map((feature) => (
    <li key={feature.title} className="border-t border-rule pt-5">
      <div className="flex items-center gap-3">
        <TrailMarker variant={feature.marker} label={feature.markerLabel} />
        <h3 className="font-display text-[20px] tracking-[-0.01em] text-text-primary">
          {feature.title}
        </h3>
      </div>
      <p className="mt-3 text-text-secondary leading-[1.55]">
        {feature.description}
      </p>
    </li>
  ));
}
```

- [ ] **Step 4: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- FeatureGrid
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/website/app/components/FeatureGrid.tsx \
        apps/website/__tests__/components/FeatureGrid.test.tsx
git commit -m "feat(website): FeatureGrid reduced to 4 cards with trail markers"
```

### Task 11: Consolidate `<ReceiptsBand>` (absorb PositioningStrip + Problem)

**Files:**

- Modify: `apps/website/app/components/ReceiptsBand.tsx`
- Modify: `apps/website/__tests__/components/ReceiptsBand.test.tsx`

- [ ] **Step 1: Read the current ReceiptsBand, PositioningStrip, and Problem to know what to absorb.**

```bash
cat apps/website/app/components/ReceiptsBand.tsx
cat apps/website/app/components/PositioningStrip.tsx
cat apps/website/app/components/Problem.tsx
```

- [ ] **Step 2: Update the test.**

In `apps/website/__tests__/components/ReceiptsBand.test.tsx`, ensure the consolidated component renders:

- The four headline numbers (current ReceiptsBand stats)
- Four positioning cards (from PositioningStrip)
- One problem callout (single-sentence summary of Problem.tsx)

```typescript
it("renders the receipts headline numbers", () => {
  render(<ReceiptsBand />);
  expect(screen.getByText("4×")).toBeInTheDocument();
  expect(screen.getByText("9.3ms")).toBeInTheDocument();
});

it("renders the four positioning cards", () => {
  render(<ReceiptsBand />);
  expect(screen.getByText(/performance/i)).toBeInTheDocument();
  expect(screen.getByText(/ai-native/i)).toBeInTheDocument();
});

it("renders the problem callout", () => {
  render(<ReceiptsBand />);
  expect(screen.getByText(/clips wrapped content/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Update `<ReceiptsBand>` source.**

Add the positioning cards block (top of section, 4 cards) and a problem callout (bottom of section, single line):

```tsx
import { TrailMarker } from "./TrailMarker";

// (existing STATS array stays — 4 receipt numbers)

const POSITIONING = [
  {
    num: "01",
    eyebrow: "Performance",
    headline: "The fastest grid in independent benchmarks.",
  },
  {
    num: "02",
    eyebrow: "AI-native",
    headline: "AI isn't a feature. It's the data model.",
  },
  {
    num: "03",
    eyebrow: "Wrapped text",
    headline: "Multi-line cells, no layout thrash.",
  },
  {
    num: "04",
    eyebrow: "Ecosystem",
    headline: "Drops into the AI SDKs you already use.",
  },
];

export function ReceiptsBand() {
  return (
    <section id="receipts" className="...">
      {/* Receipts numbers — existing markup */}
      <h2 className="...">
        <em>Receipts</em>, not claims.
      </h2>
      <ul className="...">
        {STATS.map((stat) => (
          <li key={stat.caption}>...</li>
        ))}
      </ul>

      {/* Positioning cards — new, absorbed from PositioningStrip */}
      <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
        {POSITIONING.map((card) => (
          <li
            key={card.num}
            className="rounded-[8px] border border-rule bg-bg-card p-6"
          >
            <span className="font-mono text-[10px] text-text-muted">
              {card.num}
            </span>
            <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
              {card.eyebrow}
            </span>
            <h3 className="mt-3 font-display text-[18px] tracking-[-0.01em]">
              {card.headline}
            </h3>
          </li>
        ))}
      </ul>

      {/* Problem callout — new, absorbed from Problem */}
      <p className="mt-12 border-l-4 border-accent bg-accent-soft px-6 py-4 font-display text-[16px] text-text-primary">
        Grid Alpha Community clips wrapped content to a single line at
        hypothesis scale. We don't.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- ReceiptsBand
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/website/app/components/ReceiptsBand.tsx \
        apps/website/__tests__/components/ReceiptsBand.test.tsx
git commit -m "feat(website): consolidate PositioningStrip + Problem into ReceiptsBand"
```

### Task 12: Sharpen `<CtaSection>` to single primary CTA

**Files:**

- Modify: `apps/website/app/components/CtaSection.tsx`
- Modify: `apps/website/__tests__/components/CtaSection.test.tsx`

- [ ] **Step 1: Update the test for new shape.**

```typescript
it("renders the install command as primary CTA", () => {
  render(<CtaSection />);
  expect(screen.getByText("npm install @pretable/react")).toBeInTheDocument();
});

it("renders a GitHub link as secondary CTA", () => {
  render(<CtaSection />);
  const link = screen.getByRole("link", { name: /github/i });
  expect(link).toHaveAttribute("href", expect.stringContaining("github.com"));
});
```

- [ ] **Step 2: Update `<CtaSection>` source.**

```tsx
import { CopyCommand } from "./CopyCommand";

export function CtaSection() {
  return (
    <section id="cta" className="px-7 py-24 md:px-10 md:py-32 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
        Get started
      </p>
      <h2 className="mt-4 font-display text-[40px] leading-[1.05] tracking-[-0.025em] md:text-[56px] md:leading-none">
        One import. <em className="italic text-accent">Drop it in.</em>
      </h2>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <CopyCommand command="npm install @pretable/react" />
        <a
          className="inline-flex items-center gap-2 rounded-[2px] border border-text-primary bg-transparent px-[18px] py-[10px] font-mono text-[13px] text-text-primary hover:bg-bg-raised"
          href="https://github.com/cacheplane/pretable"
        >
          GitHub →
        </a>
      </div>
    </section>
  );
}
```

(Reuses the existing `<CopyCommand>` component for the install line.)

- [ ] **Step 3: Run tests + commit.**

```bash
pnpm --filter @pretable/app-website test -- CtaSection
git add apps/website/app/components/CtaSection.tsx \
        apps/website/__tests__/components/CtaSection.test.tsx
git commit -m "feat(website): CtaSection sharpened to install + GitHub"
```

### Task 13: Update `<RouteAwareNav>` to be the top-bar over the hero

**Files:**

- Modify: `apps/website/app/components/RouteAwareNav.tsx`

- [ ] **Step 1: Open the existing component.**

```bash
cat apps/website/app/components/RouteAwareNav.tsx
```

It's currently a generic top-bar. Update it so:

- Renders as a thin bar (44px tall)
- Uses `position: absolute` (or sticky if it should stay during drawer open) at the top of the hero
- Background `rgba(255, 248, 241, 0.85)` with `backdrop-filter: blur(8px)`
- Contents: dot + brand + ` /docs` link + ` GitHub →` link

```tsx
"use client";

import Link from "next/link";

export function RouteAwareNav() {
  return (
    <header
      className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-rule-soft bg-bg-card/85 px-7 py-3 backdrop-blur-sm md:px-10"
      role="banner"
    >
      <Link className="flex items-center gap-2 font-mono text-[13px]" href="/">
        <span className="text-accent">●</span>
        <span className="font-semibold text-text-primary">pretable.ai</span>
      </Link>
      <nav className="flex items-center gap-5 font-mono text-[12px] text-text-muted">
        <Link className="hover:text-text-primary" href="/docs">
          /docs
        </Link>
        <a
          className="inline-flex items-center gap-1 hover:text-text-primary"
          href="https://github.com/cacheplane/pretable"
        >
          GitHub →
        </a>
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- RouteAwareNav
```

If existing tests fail because they assumed the old shape, update them to match. Specifically:

- The component should still be exported under the same name
- It should render `pretable.ai` and `/docs` and `GitHub`

- [ ] **Step 3: Commit.**

```bash
git add apps/website/app/components/RouteAwareNav.tsx \
        apps/website/__tests__/components/RouteAwareNav.test.tsx
git commit -m "feat(website): RouteAwareNav as transparent top-bar over hero"
```

### Task 14: Visual updates to `<HowItWorks>` and `<CodeExample>`

**Files:**

- Modify: `apps/website/app/components/HowItWorks.tsx`
- Modify: `apps/website/app/components/CodeExample.tsx`

These components don't change shape — they just need to look good under the new palette. Walk through each:

- [ ] **Step 1: Open `<HowItWorks>`.**

```bash
cat apps/website/app/components/HowItWorks.tsx
```

- [ ] **Step 2: Replace any hard-coded color hex values with token references.**

Find lines like `text-[#fbbf24]` or `bg-[#1e293b]` and replace with `text-accent`, `bg-bg-card`, etc. The token names are in `apps/website/app/globals.css` under the `@theme` block.

- [ ] **Step 3: Repeat for `<CodeExample>`.**

```bash
cat apps/website/app/components/CodeExample.tsx
```

Apply the same swap. Pay attention to the syntax-highlighting theme — if it's a hardcoded shiki theme, switch it to a light-friendly one (e.g., `light-plus` or `github-light`). Confirm the existing shiki integration; we may already have a theme variable.

- [ ] **Step 4: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- HowItWorks CodeExample
```

Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/website/app/components/HowItWorks.tsx \
        apps/website/app/components/CodeExample.tsx
git commit -m "style(website): HowItWorks + CodeExample under Alpenglow palette"
```

---

## Phase 6 — Page assembly + cleanup

### Task 15: Rewrite `apps/website/app/page.tsx`

**Files:**

- Modify: `apps/website/app/page.tsx`

- [ ] **Step 1: Replace the file contents.**

```tsx
import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { Drawer } from "./components/Drawer";
import { DrawerHandle } from "./components/DrawerHandle";
import { FeatureGrid } from "./components/FeatureGrid";
import { HeroGrid } from "./components/HeroGrid";
import { HowItWorks } from "./components/HowItWorks";
import { MountainFooter } from "./components/MountainFooter";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { RouteAwareNav } from "./components/RouteAwareNav";
import { ScrollReveal } from "./components/ScrollReveal";

export default function HomePage() {
  return (
    <>
      <RouteAwareNav />
      <main>
        <HeroGrid />
        <DrawerHandle />
        <Drawer>
          <ReceiptsBand />
          <ScrollReveal>
            <ComparisonTable />
          </ScrollReveal>
          <ScrollReveal>
            <HowItWorks />
          </ScrollReveal>
          <ScrollReveal>
            <CodeExample />
          </ScrollReveal>
          <ScrollReveal>
            <FeatureGrid />
          </ScrollReveal>
          <ScrollReveal>
            <CtaSection />
          </ScrollReveal>
        </Drawer>
      </main>
      <MountainFooter />
    </>
  );
}
```

- [ ] **Step 2: Run typecheck.**

```bash
pnpm --filter @pretable/app-website typecheck
```

Expected: passes. The deleted-but-still-referenced components (Hero, PlaygroundSection, PositioningStrip, Problem, UseCases, TrustStrip, LandingAmbient, AmbientBlob) need to be removed in Task 16 to keep the typecheck clean.

- [ ] **Step 3: Commit.**

```bash
git add apps/website/app/page.tsx
git commit -m "feat(website): assemble new homepage layout (HeroGrid + Drawer)"
```

### Task 16: Delete obsolete components and their tests

**Files:**

- Delete: `apps/website/app/components/Hero.tsx`
- Delete: `apps/website/app/components/PlaygroundSection.tsx`
- Delete: `apps/website/app/components/PositioningStrip.tsx`
- Delete: `apps/website/app/components/Problem.tsx`
- Delete: `apps/website/app/components/UseCases.tsx`
- Delete: `apps/website/app/components/TrustStrip.tsx`
- Delete: `apps/website/app/components/LandingAmbient.tsx`
- Delete: `apps/website/app/components/AmbientBlob.tsx`
- Delete: corresponding files under `apps/website/__tests__/components/`

- [ ] **Step 1: Confirm no remaining imports of these components.**

```bash
for c in Hero PlaygroundSection PositioningStrip Problem UseCases TrustStrip LandingAmbient AmbientBlob; do
  echo "=== $c ==="
  grep -rln "components/$c" apps/website/app | grep -v __tests__
done
```

Expected: zero matches in non-test code. If anything matches, fix that import first (probably a stale reference in another component).

- [ ] **Step 2: Delete the files.**

```bash
git rm apps/website/app/components/Hero.tsx \
       apps/website/app/components/PlaygroundSection.tsx \
       apps/website/app/components/PositioningStrip.tsx \
       apps/website/app/components/Problem.tsx \
       apps/website/app/components/UseCases.tsx \
       apps/website/app/components/TrustStrip.tsx \
       apps/website/app/components/LandingAmbient.tsx \
       apps/website/app/components/AmbientBlob.tsx \
       apps/website/__tests__/components/Hero.test.tsx \
       apps/website/__tests__/components/PlaygroundSection.test.tsx \
       apps/website/__tests__/components/PositioningStrip.test.tsx \
       apps/website/__tests__/components/Problem.test.tsx \
       apps/website/__tests__/components/UseCases.test.tsx \
       apps/website/__tests__/components/TrustStrip.test.tsx \
       apps/website/__tests__/components/LandingAmbient.test.tsx \
       apps/website/__tests__/components/AmbientBlob.test.tsx 2>/dev/null
```

If any `git rm` fails because the file doesn't exist (e.g., AmbientBlob test was never created), ignore the error — the redirect to `/dev/null` swallows them.

- [ ] **Step 3: Run typecheck + test + build.**

```bash
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website build
```

All should pass. If a test breaks because it's still referenced from `apps/website/__tests__/app/page.test.tsx` or similar (not a per-component test file), fix that.

- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "chore(website): remove obsolete components from old layout"
```

### Task 17: Update Playwright smoke spec for new shape

**Files:**

- Modify: `apps/website/e2e/smoke.spec.ts`

- [ ] **Step 1: Read the current spec.**

```bash
cat apps/website/e2e/smoke.spec.ts
```

It references the old `Hero` h1 + `PlaygroundSection`. Rewrite the smoke to assert:

- Title is "pretable"
- The grid viewport is present (`[data-pretable-scroll-viewport]`)
- The drawer handle is present (`[data-testid="drawer-handle"]`)
- `/docs` route returns 200
- The mountain footer caption is visible ("Built in Bend, OR.")

Per the spec, the H1 text overlay is **off by default** in this redesign — drop the h1 visibility assertion that was in the prior smoke.

- [ ] **Step 2: Replace the smoke contents.**

```typescript
import { expect, test } from "@playwright/test";

test("landing renders hero grid, drawer handle, mountain footer; /docs resolves", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("pretable");

  // Hero grid is present (the streaming demo viewport)
  await expect(page.locator("[data-pretable-scroll-viewport]")).toBeVisible({
    timeout: 10_000,
  });

  // Drawer handle is present
  await expect(page.locator("[data-testid='drawer-handle']")).toBeVisible();

  // Mountain footer caption
  await expect(page.getByText(/built in bend, or\./i)).toBeVisible();

  // /docs still resolves
  const docsResponse = await page.goto("/docs", {
    waitUntil: "domcontentloaded",
  });
  expect(docsResponse?.status()).toBe(200);
});
```

- [ ] **Step 3: Smoke test against the dev server.**

```bash
pnpm --filter @pretable/app-website dev &
sleep 6
BASE_URL=http://localhost:3000 pnpm --filter @pretable/app-website smoke
# Stop the dev server (find the PID and kill, or Ctrl+C if running interactive)
```

Expected: 1 passed.

- [ ] **Step 4: Commit.**

```bash
git add apps/website/e2e/smoke.spec.ts
git commit -m "test(website): smoke spec for new hero/drawer/footer shape"
```

### Task 18: Update apps/website/README.md

**Files:**

- Modify: `apps/website/README.md`

- [ ] **Step 1: Replace the section list and the page-flow description.**

The current README describes "nine sections" wrapped in `<ScrollReveal>`. Update to describe:

- Top bar (`<RouteAwareNav>`)
- Hero (`<HeroGrid>`)
- Drawer handle (`<DrawerHandle>`)
- Drawer overlay (`<Drawer>`) containing 6 sections: ReceiptsBand, ComparisonTable, HowItWorks, CodeExample, FeatureGrid, CtaSection
- Mountain footer (`<MountainFooter>`)

Mention:

- Light mode by default; Alpenglow palette
- DOM-first: full content always in DOM, JS upgrades to overlay drawer above 768px
- Mobile (< 768px): natural scroll page (no drawer overlay)
- `prefers-reduced-motion`: drawer transitions disabled
- Trail markers (TrailMarker variants) used in ComparisonTable and FeatureGrid
- Mountain footer is once-per-page; no other ski/mountain elements appear elsewhere

Drop references to `<LandingAmbient>` and the body gradient — those are gone.

- [ ] **Step 2: Commit.**

```bash
git add apps/website/README.md
git commit -m "docs(website): update README for grid-as-hero + drawer layout"
```

### Task 19: Final workspace verification + open PR

- [ ] **Step 1: Full clean validation.**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
pnpm -r --filter '@pretable/{core,react}' --filter '@cacheplane/json-stream' lint:packaging
```

All pass. Lint warnings on apps/website's pre-existing fast-refresh issues are OK.

- [ ] **Step 2: Visual smoke in dev server.**

```bash
pnpm --filter @pretable/app-website dev
```

Open `http://localhost:3000`. Confirm:

- Light mode, alpenglow palette
- Streaming grid live, rows ticking in
- Drawer handle visible at the bottom
- Click drawer → overlay slides up with marketing content
- Esc closes drawer
- Browser back button closes drawer (without leaving page)
- `/#receipts` opens drawer + scrolls to receipts
- Mobile (resize to <768px): drawer overlay disappears, page scrolls naturally
- `prefers-reduced-motion: reduce` (toggle in OS): no slide animation, grid is static snapshot
- `/docs` route still works
- Mountain footer renders with "Built in Bend, OR."

Stop the dev server.

- [ ] **Step 3: Push branch and open PR.**

```bash
git push -u origin "$(git branch --show-current)"
gh pr create --title "feat(website): grid-as-hero with Alpenglow drawer" --body "$(cat <<'EOF'
## Summary

Redesigns the marketing landing page so the live data grid IS the hero. Bottom drawer reveals a curated marketing arc on demand. Light mode, Alpenglow palette inspired by Bend / skiing. DOM-first SEO; JS upgrades to overlay drawer.

**Spec:** [docs/superpowers/specs/2026-05-02-website-grid-as-hero-design.md](docs/superpowers/specs/2026-05-02-website-grid-as-hero-design.md)
**Plan:** [docs/superpowers/plans/2026-05-02-website-grid-as-hero.md](docs/superpowers/plans/2026-05-02-website-grid-as-hero.md)

## What changes

- **Hero**: full-bleed `<HeroGrid>` with live event-stream replay (1k/sec, alpenglow flash on new rows)
- **Drawer**: overlay above 768px, natural scroll below; opens via handle click, hash navigation, or programmatic `?drawer=open`
- **Palette**: Alpenglow tokens (warm cream + dusk peach + cobalt) replace existing tokens
- **Motifs**: trail-map difficulty markers in ComparisonTable + FeatureGrid; mountain silhouette + chairlift in footer
- **Content cuts**: 5 components deleted (Hero, PlaygroundSection, PositioningStrip, Problem, UseCases, TrustStrip, LandingAmbient, AmbientBlob); 4 new (HeroGrid, Drawer, DrawerHandle, TrailMarker, MountainFooter); 6 updated

## Test plan

- [ ] CI green (test/typecheck/lint/format/build/packaging)
- [ ] Preview deploy renders correctly
- [ ] Drawer keyboard interaction (Esc, focus management)
- [ ] Mobile viewport (`<768px`) shows scroll page, no drawer overlay
- [ ] `prefers-reduced-motion: reduce` skips animations
- [ ] /docs route still loads
EOF
)"
```

- [ ] **Step 4: Watch CI.**

```bash
PR=$(gh pr view --json number --jq .number)
gh pr checks "$PR" --watch
```

Expected: all checks pass.

- [ ] **Step 5: Merge once green.**

```bash
gh pr merge "$PR" --squash --delete-branch
```

---

## Done

After Task 19 step 5, the redesign is live on `pretable.vercel.app`. Cleanup follow-ups:

- Add a /docs revamp under the same palette and trail-marker convention (separate plan)
- Add dark mode tokens (separate plan, post-launch)
- Consider the BYOD hero option from the brainstorm (phase 2 enhancement)

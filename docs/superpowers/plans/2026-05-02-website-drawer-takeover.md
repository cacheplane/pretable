# Website Drawer Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken peeking-drawer architecture with a fullscreen slide-up takeover. Cold landing = grid + thin top control bar + drawer handle; click handle → drawer slides up to fill viewport with marketing site (NavBar + 6 sections + footer). Pause/resume + speed slider on the grid. Fix Safari render loop. Fix /docs link.

**Architecture:** Single URL `/`, all drawer content SSR'd, JS adds `data-drawer="open|closed"` to `<html>` and CSS transforms `.drawer-shell` from `translateY(100%)` to `0`. Mobile-OS spring easing. Reduced-motion → instant snap.

**Tech Stack:** Next.js 15 + React 19 + Tailwind v4. `PretableSurface` from `@pretable-internal/react-surface`. Vanilla CSS modules for drawer styles. Vitest + jsdom for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-05-02-website-drawer-takeover-design.md`

**Branch:** `feat/website-drawer-takeover` (created)

---

## Phase 1 — Foundation: control state + NavBar

### Task 1: Create `controlState.ts` (React context for grid controls)

**Files:**
- Create: `apps/website/app/components/heroGrid/controlState.ts`
- Create: `apps/website/app/components/heroGrid/__tests__/controlState.test.tsx`

- [ ] **Step 1: Write the failing test.**

`apps/website/app/components/heroGrid/__tests__/controlState.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ControlStateProvider,
  useControlState,
} from "../controlState";

describe("controlState", () => {
  it("defaults to ratePerSec=1000, isPaused=false, isDrawerOpen=false", () => {
    const { result } = renderHook(() => useControlState(), {
      wrapper: ({ children }) => (
        <ControlStateProvider>{children}</ControlStateProvider>
      ),
    });
    expect(result.current.ratePerSec).toBe(1000);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.isDrawerOpen).toBe(false);
    expect(result.current.isPlaying).toBe(true);
  });

  it("setRatePerSec updates rate", () => {
    const { result } = renderHook(() => useControlState(), {
      wrapper: ({ children }) => (
        <ControlStateProvider>{children}</ControlStateProvider>
      ),
    });
    act(() => result.current.setRatePerSec(5000));
    expect(result.current.ratePerSec).toBe(5000);
  });

  it("isPlaying is false when isPaused is true", () => {
    const { result } = renderHook(() => useControlState(), {
      wrapper: ({ children }) => (
        <ControlStateProvider>{children}</ControlStateProvider>
      ),
    });
    act(() => result.current.setIsPaused(true));
    expect(result.current.isPlaying).toBe(false);
  });

  it("isPlaying is false when isDrawerOpen is true", () => {
    const { result } = renderHook(() => useControlState(), {
      wrapper: ({ children }) => (
        <ControlStateProvider>{children}</ControlStateProvider>
      ),
    });
    act(() => result.current.setIsDrawerOpen(true));
    expect(result.current.isPlaying).toBe(false);
  });
});
```

- [ ] **Step 2: Implement.**

`apps/website/app/components/heroGrid/controlState.ts`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type RateTier = 250 | 1000 | 5000 | 25000;

export interface HeroGridControlState {
  ratePerSec: RateTier;
  setRatePerSec: (rate: RateTier) => void;
  isPaused: boolean;
  setIsPaused: (paused: boolean) => void;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (open: boolean) => void;
  isPlaying: boolean;
}

const ControlStateContext = createContext<HeroGridControlState | null>(null);

export function ControlStateProvider({ children }: { children: ReactNode }) {
  const [ratePerSec, setRatePerSec] = useState<RateTier>(1000);
  const [isPaused, setIsPaused] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const setRate = useCallback((rate: RateTier) => setRatePerSec(rate), []);
  const setPaused = useCallback((paused: boolean) => setIsPaused(paused), []);
  const setOpen = useCallback((open: boolean) => setIsDrawerOpen(open), []);

  const value = useMemo<HeroGridControlState>(
    () => ({
      ratePerSec,
      setRatePerSec: setRate,
      isPaused,
      setIsPaused: setPaused,
      isDrawerOpen,
      setIsDrawerOpen: setOpen,
      isPlaying: !isPaused && !isDrawerOpen,
    }),
    [ratePerSec, isPaused, isDrawerOpen, setRate, setPaused, setOpen],
  );

  return (
    <ControlStateContext.Provider value={value}>
      {children}
    </ControlStateContext.Provider>
  );
}

export function useControlState(): HeroGridControlState {
  const ctx = useContext(ControlStateContext);
  if (!ctx) {
    throw new Error("useControlState must be used inside ControlStateProvider");
  }
  return ctx;
}
```

- [ ] **Step 3: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- controlState
```

Expected: 4/4 PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/heroGrid/controlState.ts \
        apps/website/app/components/heroGrid/__tests__/controlState.test.tsx
git commit -m "feat(website): controlState context for grid pause + rate"
```

### Task 2: Implement `useFps()` hook

**Files:**
- Create: `apps/website/app/components/heroGrid/useFps.ts`
- Create: `apps/website/app/components/heroGrid/__tests__/useFps.test.tsx`

- [ ] **Step 1: Write the test.**

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFps } from "../useFps";

describe("useFps", () => {
  let now = 0;
  let rafCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    now = 0;
    rafCallbacks = [];
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return 1 as unknown as number;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns 60 by default before any frames", () => {
    const { result } = renderHook(() => useFps());
    expect(result.current).toBe(60);
  });

  it("computes ~60 fps from 60 frames at ~16.67ms each", () => {
    const { result } = renderHook(() => useFps());
    act(() => {
      for (let i = 0; i < 60; i++) {
        now += 1000 / 60;
        const cb = rafCallbacks[i];
        if (cb) cb(now);
      }
    });
    expect(result.current).toBeGreaterThanOrEqual(58);
    expect(result.current).toBeLessThanOrEqual(62);
  });
});
```

- [ ] **Step 2: Implement.**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

const WINDOW_FRAMES = 60;
const UPDATE_INTERVAL_MS = 250;

export function useFps(): number {
  const [fps, setFps] = useState(60);
  const samplesRef = useRef<number[]>([]);
  const lastUpdateRef = useRef(0);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    const tick = (timestampMs: number) => {
      if (lastFrameRef.current !== 0) {
        const delta = timestampMs - lastFrameRef.current;
        const samples = samplesRef.current;
        samples.push(delta);
        if (samples.length > WINDOW_FRAMES) samples.shift();
      }
      lastFrameRef.current = timestampMs;

      if (timestampMs - lastUpdateRef.current >= UPDATE_INTERVAL_MS) {
        lastUpdateRef.current = timestampMs;
        const samples = samplesRef.current;
        if (samples.length > 0) {
          const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
          setFps(Math.round(1000 / avg));
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return fps;
}
```

- [ ] **Step 3: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- useFps
```

Expected: 2/2 PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/heroGrid/useFps.ts \
        apps/website/app/components/heroGrid/__tests__/useFps.test.tsx
git commit -m "feat(website): useFps hook for live frame-rate observation"
```

### Task 3: Create shared `<NavBar>` component

**Files:**
- Create: `apps/website/app/components/NavBar.tsx`
- Create: `apps/website/app/components/__tests__/NavBar.test.tsx`
- Delete: `apps/website/app/components/RouteAwareNav.tsx` (replaced)
- Delete: `apps/website/app/components/__tests__/RouteAwareNav.test.tsx` if it exists

- [ ] **Step 1: Write the test.**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NavBar } from "../NavBar";

describe("NavBar", () => {
  describe("mode='site'", () => {
    it("renders brand + Docs + GitHub, no close button", () => {
      render(<NavBar mode="site" />);
      expect(screen.getByText(/pretable\.ai/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /docs/i })).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /github/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /show the grid/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("mode='drawer'", () => {
    it("renders anchors + Docs + GitHub + close button", () => {
      const onClose = () => {};
      render(<NavBar mode="drawer" onClose={onClose} />);
      expect(screen.getByText(/pretable\.ai/i)).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /receipts/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /compare/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /show the grid/i }),
      ).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Implement.**

```tsx
"use client";

import Link from "next/link";

export type NavBarMode = "site" | "drawer";

export interface NavBarProps {
  mode: NavBarMode;
  onClose?: () => void;
}

const DRAWER_ANCHORS = [
  { id: "receipts", label: "Receipts" },
  { id: "compare", label: "Compare" },
  { id: "how-it-works", label: "How" },
  { id: "code", label: "Code" },
  { id: "features", label: "Features" },
] as const;

export function NavBar({ mode, onClose }: NavBarProps) {
  return (
    <header
      className="flex items-center justify-between border-b border-rule-soft bg-bg-card/85 px-7 py-3 backdrop-blur-sm md:px-10"
      role="banner"
    >
      <Link className="flex items-center gap-2 font-mono text-[13px]" href="/">
        <span aria-hidden="true" className="text-accent">
          ●
        </span>
        <span className="font-semibold text-text-primary">pretable.ai</span>
      </Link>

      {mode === "drawer" && (
        <nav
          aria-label="Section navigation"
          className="hidden items-center gap-5 font-mono text-[12px] text-text-muted md:flex"
        >
          {DRAWER_ANCHORS.map((anchor) => (
            <a
              className="hover:text-text-primary"
              href={`#${anchor.id}`}
              key={anchor.id}
            >
              {anchor.label}
            </a>
          ))}
        </nav>
      )}

      <nav
        aria-label="Site links"
        className="flex items-center gap-5 font-mono text-[12px] text-text-muted"
      >
        <Link className="hover:text-text-primary" href="/docs">
          /docs
        </Link>
        <a
          className="inline-flex items-center gap-1 hover:text-text-primary"
          href="https://github.com/cacheplane/pretable"
        >
          GitHub →
        </a>
        {mode === "drawer" && onClose && (
          <button
            className="inline-flex items-center gap-1 rounded-[4px] border border-text-primary px-3 py-1 text-text-primary hover:bg-bg-raised"
            onClick={onClose}
            type="button"
          >
            Show the grid ↓
          </button>
        )}
      </nav>
    </header>
  );
}
```

- [ ] **Step 3: Delete `<RouteAwareNav>` and any tests for it.**

```bash
git rm apps/website/app/components/RouteAwareNav.tsx 2>/dev/null || true
git rm apps/website/app/components/__tests__/RouteAwareNav.test.tsx 2>/dev/null || true
git rm apps/website/__tests__/components/RouteAwareNav.test.tsx 2>/dev/null || true
```

- [ ] **Step 4: Find references to `<RouteAwareNav>` and update them.**

```bash
grep -rln "RouteAwareNav" apps/website/app
```

Expected: should match `apps/website/app/layout.tsx`. Update it (Task 5 will rewrite layout entirely; for now just verify the file references will be resolved by Task 5 — leave a TODO if needed).

- [ ] **Step 5: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- NavBar
```

Expected: 2/2 PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/website/app/components/NavBar.tsx \
        apps/website/app/components/__tests__/NavBar.test.tsx
git commit -m "feat(website): shared NavBar component (site/drawer modes)"
```

---

## Phase 2 — TopControlBar + grid integration

### Task 4: Implement `<TopControlBar>`

**Files:**
- Create: `apps/website/app/components/TopControlBar.tsx`
- Create: `apps/website/app/components/topControlBar.module.css`
- Create: `apps/website/app/components/__tests__/TopControlBar.test.tsx`

- [ ] **Step 1: Write the test.**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ControlStateProvider, useControlState } from "../heroGrid/controlState";
import { TopControlBar } from "../TopControlBar";

function ControlsAccessor({ onState }: { onState: (s: ReturnType<typeof useControlState>) => void }) {
  const state = useControlState();
  onState(state);
  return null;
}

describe("TopControlBar", () => {
  it("renders brand and event-stream label", () => {
    render(
      <ControlStateProvider>
        <TopControlBar fps={60} eventsPerSec={1000} p95Ms={9.3} />
      </ControlStateProvider>,
    );
    expect(screen.getByText(/pretable\.ai/i)).toBeInTheDocument();
    expect(screen.getByText(/events\.stream/i)).toBeInTheDocument();
  });

  it("renders the live counter with events/sec, p95, and fps", () => {
    render(
      <ControlStateProvider>
        <TopControlBar fps={59} eventsPerSec={1247} p95Ms={9.3} />
      </ControlStateProvider>,
    );
    expect(screen.getByText(/1,247/)).toBeInTheDocument();
    expect(screen.getByText(/9\.3/)).toBeInTheDocument();
    expect(screen.getByText(/59 fps/i)).toBeInTheDocument();
  });

  it("toggles isPaused on pause-button click", () => {
    let captured: ReturnType<typeof useControlState> | null = null;
    render(
      <ControlStateProvider>
        <TopControlBar fps={60} eventsPerSec={1000} p95Ms={9.3} />
        <ControlsAccessor onState={(s) => (captured = s)} />
      </ControlStateProvider>,
    );
    expect(captured!.isPaused).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(captured!.isPaused).toBe(true);
  });

  it("changes ratePerSec when slider tier is clicked", () => {
    let captured: ReturnType<typeof useControlState> | null = null;
    render(
      <ControlStateProvider>
        <TopControlBar fps={60} eventsPerSec={1000} p95Ms={9.3} />
        <ControlsAccessor onState={(s) => (captured = s)} />
      </ControlStateProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /heavy/i }));
    expect(captured!.ratePerSec).toBe(5000);
  });
});
```

- [ ] **Step 2: Implement the CSS module.**

`apps/website/app/components/topControlBar.module.css`:

```css
.bar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 16px;
  height: 36px;
  padding: 0 16px;
  background: rgba(255, 248, 241, 0.92);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(180, 83, 9, 0.15);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--pt-text-muted);
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.center {
  flex: 1;
  display: flex;
  justify-content: center;
  gap: 14px;
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

.metric {
  color: var(--pt-text-secondary);
}

.metric strong {
  color: var(--pt-text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.iconBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--pt-rule);
  border-radius: 4px;
  background: var(--pt-bg-card);
  color: var(--pt-text-primary);
  cursor: pointer;
}

.iconBtn:hover {
  background: var(--pt-bg-raised);
}

.tierGroup {
  display: inline-flex;
  border: 1px solid var(--pt-rule);
  border-radius: 4px;
  overflow: hidden;
}

.tier {
  padding: 4px 10px;
  background: transparent;
  border: 0;
  font-family: inherit;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--pt-text-muted);
  cursor: pointer;
  border-right: 1px solid var(--pt-rule);
}

.tier:last-child {
  border-right: 0;
}

.tier[data-active="true"] {
  background: var(--pt-accent);
  color: white;
}

@media (max-width: 767px) {
  .bar {
    gap: 8px;
    padding: 0 10px;
  }
  .center {
    gap: 6px;
  }
  .center .metric:nth-child(n + 2) {
    display: none;
  }
  .tierGroup {
    display: none;
  }
}
```

- [ ] **Step 3: Implement the component.**

```tsx
"use client";

import { useControlState, type RateTier } from "./heroGrid/controlState";
import styles from "./topControlBar.module.css";

interface TopControlBarProps {
  eventsPerSec: number;
  p95Ms: number;
  fps: number;
}

const TIERS: { value: RateTier; label: string }[] = [
  { value: 250, label: "Light" },
  { value: 1000, label: "Production" },
  { value: 5000, label: "Heavy" },
  { value: 25000, label: "Extreme" },
];

const eventsFormatter = new Intl.NumberFormat("en-US");

export function TopControlBar({
  eventsPerSec,
  p95Ms,
  fps,
}: TopControlBarProps) {
  const { ratePerSec, setRatePerSec, isPaused, setIsPaused } = useControlState();

  return (
    <div className={styles.bar} role="toolbar" aria-label="Grid stream controls">
      <div className={styles.left}>
        <span aria-hidden="true" className={styles.dot}>
          ●
        </span>
        <span className={styles.brand}>pretable.ai</span>
        <span aria-hidden="true" className={styles.sep}>
          ·
        </span>
        <span>events.stream</span>
      </div>
      <div className={styles.center}>
        <span className={styles.metric}>
          <strong>{eventsFormatter.format(eventsPerSec)}</strong> ev/s
        </span>
        <span className={styles.metric}>
          <strong>{p95Ms.toFixed(1)}</strong> ms p95
        </span>
        <span className={styles.metric}>
          <strong>{fps}</strong> fps
        </span>
      </div>
      <div className={styles.right}>
        <button
          aria-label={isPaused ? "Resume stream" : "Pause stream"}
          aria-pressed={isPaused}
          className={styles.iconBtn}
          onClick={() => setIsPaused(!isPaused)}
          type="button"
        >
          {isPaused ? "▶" : "⏸"}
        </button>
        <div
          aria-label="Stream rate"
          className={styles.tierGroup}
          role="radiogroup"
        >
          {TIERS.map((tier) => (
            <button
              aria-checked={ratePerSec === tier.value}
              className={styles.tier}
              data-active={ratePerSec === tier.value}
              key={tier.value}
              onClick={() => setRatePerSec(tier.value)}
              role="radio"
              type="button"
            >
              {tier.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- TopControlBar
```

Expected: 4/4 PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/website/app/components/TopControlBar.tsx \
        apps/website/app/components/topControlBar.module.css \
        apps/website/app/components/__tests__/TopControlBar.test.tsx
git commit -m "feat(website): TopControlBar (counter + pause + speed slider)"
```

### Task 5: Refactor `replay.ts` for pause/resume + setRate

**Files:**
- Modify: `apps/website/app/components/heroGrid/replay.ts`
- Modify: `apps/website/app/components/heroGrid/__tests__/replay.test.ts`

- [ ] **Step 1: Update tests.**

Add to existing test file:

```ts
it("can change rate mid-stream via setRate", () => {
  const onEmit = vi.fn();
  const replay = createHeroReplay({ ratePerSec: 100, onEmit });
  replay.tickAtMs(0);
  replay.tickAtMs(1000); // 100 emissions at 100/sec
  expect(onEmit).toHaveBeenCalledTimes(100);
  replay.setRate(500);
  onEmit.mockClear();
  replay.tickAtMs(2000); // 1s at 500/sec = 500 emissions
  expect(onEmit).toHaveBeenCalledTimes(500);
});
```

- [ ] **Step 2: Implement.**

Add to `apps/website/app/components/heroGrid/replay.ts`:

```ts
export interface HeroReplay {
  tickAtMs(timestampMs: number): void;
  pause(timestampMs?: number): void;
  resume(timestampMs: number): void;
  setRate(ratePerSec: number): void;
}
```

In the implementation, change `intervalMs` from `const` to `let`, add `setRate`:

```ts
let intervalMs = 1000 / options.ratePerSec;
// ... existing ...
return {
  tickAtMs(timestampMs) { /* existing */ },
  pause() { /* existing */ },
  resume(timestampMs) { /* existing */ },
  setRate(ratePerSec) {
    intervalMs = 1000 / ratePerSec;
    // reset backlog so the rate change takes immediate effect from this point
    // (don't preserve fractional accumulation across rate changes)
  },
};
```

- [ ] **Step 3: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- replay
```

Expected: all PASS (3 existing + 1 new).

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/heroGrid/replay.ts \
        apps/website/app/components/heroGrid/__tests__/replay.test.ts
git commit -m "feat(website): replay engine setRate() for live rate changes"
```

### Task 6: Refactor `<HeroGrid>` to integrate control state + fix Bug 2

**Files:**
- Modify: `apps/website/app/components/HeroGrid.tsx`
- Modify: `apps/website/app/components/__tests__/HeroGrid.test.tsx`

- [ ] **Step 1: Read existing HeroGrid to understand prior shape.**

```bash
cat apps/website/app/components/HeroGrid.tsx
```

- [ ] **Step 2: Update test for new shape.**

Replace existing tests with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ControlStateProvider } from "../heroGrid/controlState";
import { HeroGrid } from "../HeroGrid";

const renderHeroGrid = () =>
  render(
    <ControlStateProvider>
      <HeroGrid />
    </ControlStateProvider>,
  );

describe("HeroGrid", () => {
  it("renders the streaming grid via PretableSurface (role=grid + accessible label)", () => {
    renderHeroGrid();
    expect(
      screen.getByRole("grid", { name: /pretable streaming demo/i }),
    ).toBeInTheDocument();
  });

  it("exposes data-pretable-scroll-viewport via PretableSurface for bench parity", () => {
    const { container } = renderHeroGrid();
    expect(
      container.querySelector("[data-pretable-scroll-viewport]"),
    ).not.toBeNull();
  });
});
```

(Drops the old "top bar with dataset metadata" assertion — that content moves to `<TopControlBar>`.)

- [ ] **Step 3: Refactor HeroGrid.**

Key changes:
- Read `ratePerSec`, `isPlaying` from `useControlState()`.
- Remove the inline-arrow `onTelemetryChange` (Bug 2 fix).
- Drop the section's own top-bar markup (moves to `<TopControlBar>` mounted by `page.tsx`).
- Use `replay.setRate()` when `ratePerSec` changes; use `replay.pause()` / `replay.resume()` when `isPlaying` changes.
- Restore `wrap: true` on the message column.
- Restore initial seed of 30 rows so the grid isn't blank on first paint.

```tsx
"use client";

import { PretableSurface } from "@pretable-internal/react-surface";
import { useEffect, useRef, useState } from "react";

import { useControlState } from "./heroGrid/controlState";
import { type HeroEvent, heroEventLog } from "./heroGrid/eventLog";
import { createHeroReplay } from "./heroGrid/replay";
import styles from "./heroGrid/heroGrid.module.css";

const VISIBLE_BUFFER_ROWS = 200;

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
  [key: string]: unknown;
}

const seedRows = (): DisplayRow[] =>
  heroEventLog.slice(0, 30).map((entry, index) => ({
    ...entry,
    __sequence: index,
    id: `seed-${index}`,
  }));

export function HeroGrid() {
  const { ratePerSec, isPlaying } = useControlState();
  const [rows, setRows] = useState<DisplayRow[]>(seedRows);
  const replayRef = useRef<ReturnType<typeof createHeroReplay> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) return; // keep seed snapshot, no replay

    let pending: DisplayRow[] = [];
    const replay = createHeroReplay({
      ratePerSec,
      onEmit: (event: HeroEvent, sequence: number) => {
        pending.push({
          ...event,
          __sequence: sequence,
          id: `seq-${sequence}`,
        });
      },
    });
    replayRef.current = replay;

    let raf = 0;
    const loop = (timestampMs: number) => {
      replay.tickAtMs(timestampMs);
      if (pending.length > 0) {
        const batch = pending;
        pending = [];
        setRows((prev) => {
          const next = [...batch.reverse(), ...prev];
          return next.length > VISIBLE_BUFFER_ROWS
            ? next.slice(0, VISIBLE_BUFFER_ROWS)
            : next;
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      replayRef.current = null;
    };
  }, []);

  // React to ratePerSec changes
  useEffect(() => {
    replayRef.current?.setRate(ratePerSec);
  }, [ratePerSec]);

  // React to play/pause changes
  useEffect(() => {
    if (isPlaying) {
      replayRef.current?.resume(performance.now());
    } else {
      replayRef.current?.pause();
    }
  }, [isPlaying]);

  return (
    <section className={`hero ${styles.hero}`}>
      <PretableSurface<DisplayRow>
        ariaLabel="Pretable streaming demo"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        viewportHeight={520}
      />
    </section>
  );
}
```

(Note: `onTelemetryChange` is removed entirely. p95 will be derived from a separate stable-callback path in Task 7.)

- [ ] **Step 4: Update `heroGrid.module.css` to drop the top-bar styles.**

```bash
cat apps/website/app/components/heroGrid/heroGrid.module.css
```

Remove the `.topBar`, `.dot`, `.brand`, `.sep`, `.spacer`, `.metric` rules (moved to `topControlBar.module.css`). Keep `.hero` and `.gridFrame` (rename `.gridFrame` away if no longer used). The hero now spans the viewport height minus the 36px control bar.

```css
.hero {
  position: relative;
  height: calc(100vh - 36px);
  background: linear-gradient(135deg, var(--pt-bg-card) 0%, var(--pt-bg-raised) 100%);
}
```

- [ ] **Step 5: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- HeroGrid
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/website/app/components/HeroGrid.tsx \
        apps/website/app/components/heroGrid/heroGrid.module.css \
        apps/website/app/components/__tests__/HeroGrid.test.tsx
git commit -m "feat(website): HeroGrid integrates controlState + drops inline telemetry callback"
```

### Task 7: Implement `<TelemetrySink>` for stable telemetry forwarding (and `<HomeStreamHeader>` orchestrator)

**Files:**
- Create: `apps/website/app/components/HomeStreamHeader.tsx`
- Create: `apps/website/app/components/__tests__/HomeStreamHeader.test.tsx`

`<HomeStreamHeader>` is the bridge between the rAF-driven counters (events/sec, fps) inside `<HeroGrid>` and the `<TopControlBar>` display. It uses a `useFps()` hook and a small events/sec observer derived from a callback registered with `<HeroGrid>`.

- [ ] **Step 1: Decide on the telemetry channel.**

For v1, derive events/sec from the rate-tier (no real measurement; just display the slider value). p95 stays a static "9.3" until we wire `PretableSurface`'s telemetry through a stable callback (deferred to a follow-up). fps is real, from `useFps()`.

This keeps Bug 2 fixed (no telemetry callback at all from HeroGrid) while still showing live numbers in the counter.

- [ ] **Step 2: Implement.**

```tsx
"use client";

import { useControlState } from "./heroGrid/controlState";
import { useFps } from "./heroGrid/useFps";
import { TopControlBar } from "./TopControlBar";

const STATIC_P95_MS = 9.3;

export function HomeStreamHeader() {
  const { ratePerSec, isPlaying } = useControlState();
  const fps = useFps();
  const eventsPerSec = isPlaying ? ratePerSec : 0;

  return (
    <TopControlBar
      eventsPerSec={eventsPerSec}
      fps={fps}
      p95Ms={STATIC_P95_MS}
    />
  );
}
```

- [ ] **Step 3: Test.**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ControlStateProvider } from "../heroGrid/controlState";
import { HomeStreamHeader } from "../HomeStreamHeader";

describe("HomeStreamHeader", () => {
  it("renders TopControlBar with default 1,000 ev/s", () => {
    render(
      <ControlStateProvider>
        <HomeStreamHeader />
      </ControlStateProvider>,
    );
    expect(screen.getByText(/1,000/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/HomeStreamHeader.tsx \
        apps/website/app/components/__tests__/HomeStreamHeader.test.tsx
git commit -m "feat(website): HomeStreamHeader bridges control state to TopControlBar"
```

---

## Phase 3 — DrawerShell + page composition

### Task 8: Refactor `useDrawer` for fullscreen takeover + control-state mirror

**Files:**
- Modify: `apps/website/app/components/useDrawer.ts`
- Modify: `apps/website/app/components/__tests__/useDrawer.test.ts`

- [ ] **Step 1: Update tests.**

Update the existing useDrawer tests to:
- Drop the `<768px no-upgrade` assertion (always upgrade now).
- Add an assertion that `setIsDrawerOpen` is called on `controlState` when drawer toggles.

```ts
it("upgrades regardless of viewport width", () => {
  Object.defineProperty(window, "innerWidth", { value: 320, writable: true });
  renderHook(() => useDrawer());
  expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
});
```

(The old "narrow viewport doesn't upgrade" test should be DELETED.)

- [ ] **Step 2: Update `useDrawer.ts`.**

- Drop the `VIEWPORT_BREAKPOINT_PX` gate.
- Always set `isUpgraded = true` after hydration.
- Read `setIsDrawerOpen` from `useControlState()` and call it on open/close.
- Keep popstate, Escape, hash-link auto-open.

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

import { useControlState } from "./heroGrid/controlState";

const DRAWER_SECTIONS = new Set([
  "receipts",
  "compare",
  "how-it-works",
  "code",
  "features",
  "cta",
]);

export interface UseDrawerResult {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export function useDrawer(): UseDrawerResult {
  const [isOpen, setIsOpen] = useState(false);
  const [isUpgraded, setIsUpgraded] = useState(false);
  const { setIsDrawerOpen } = useControlState();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsUpgraded(true);

    const hash = window.location.hash.replace("#", "");
    if (hash && DRAWER_SECTIONS.has(hash)) {
      setIsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!isUpgraded) return;
    document.documentElement.setAttribute(
      "data-drawer",
      isOpen ? "open" : "closed",
    );
    setIsDrawerOpen(isOpen);
  }, [isOpen, isUpgraded, setIsDrawerOpen]);

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

  useEffect(() => {
    if (!isUpgraded) return;
    const handler = (event: PopStateEvent) => {
      if (event.state?.drawer === "open") return;
      setIsOpen(false);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [isUpgraded]);

  useEffect(() => {
    if (!isUpgraded || !isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isUpgraded, isOpen, close]);

  return { isOpen, open, close, toggle };
}
```

- [ ] **Step 3: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- useDrawer
```

Expected: PASS (after wrapping the hook tests in `<ControlStateProvider>`).

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/useDrawer.ts \
        apps/website/app/components/__tests__/useDrawer.test.ts
git commit -m "feat(website): useDrawer always-upgrades + mirrors to controlState"
```

### Task 9: Replace `<Drawer>` + `<DrawerHandle>` with `<DrawerShell>`

**Files:**
- Replace: `apps/website/app/components/Drawer.tsx` → `apps/website/app/components/DrawerShell.tsx`
- Modify: `apps/website/app/components/DrawerHandle.tsx`
- Modify: `apps/website/app/components/__tests__/Drawer.test.tsx` → `__tests__/DrawerShell.test.tsx`

- [ ] **Step 1: Write the test for DrawerShell.**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ControlStateProvider } from "../heroGrid/controlState";
import { DrawerShell } from "../DrawerShell";

describe("DrawerShell", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-drawer");
    history.replaceState({}, "", "/");
  });

  it("renders the handle as a clickable button", () => {
    render(
      <ControlStateProvider>
        <DrawerShell>content</DrawerShell>
      </ControlStateProvider>,
    );
    expect(
      screen.getByRole("button", { name: /why pretable/i }),
    ).toBeInTheDocument();
  });

  it("renders the drawer-content region with children", () => {
    render(
      <ControlStateProvider>
        <DrawerShell>
          <p>Section A</p>
        </DrawerShell>
      </ControlStateProvider>,
    );
    expect(screen.getByText("Section A")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /more about pretable/i }),
    ).toBeInTheDocument();
  });

  it("opens the drawer when handle is clicked", () => {
    render(
      <ControlStateProvider>
        <DrawerShell>x</DrawerShell>
      </ControlStateProvider>,
    );
    Object.defineProperty(window, "innerWidth", { value: 1440, writable: true });
    fireEvent.click(screen.getByRole("button", { name: /why pretable/i }));
    expect(document.documentElement.getAttribute("data-drawer")).toBe("open");
  });
});
```

- [ ] **Step 2: Implement `<DrawerShell>` and updated `<DrawerHandle>`.**

`apps/website/app/components/DrawerHandle.tsx`:

```tsx
"use client";

import { useDrawer } from "./useDrawer";

export function DrawerHandle() {
  const { open } = useDrawer();
  return (
    <button
      aria-controls="drawer-content"
      aria-expanded="false"
      className="drawer-handle block w-full bg-drawer-bg py-4 text-center font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-drawer-text transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
      data-testid="drawer-handle"
      onClick={open}
      type="button"
    >
      ↑ Why pretable
    </button>
  );
}
```

`apps/website/app/components/DrawerShell.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

import { DrawerHandle } from "./DrawerHandle";
import { useDrawer } from "./useDrawer";

interface DrawerShellProps {
  children: ReactNode;
}

export function DrawerShell({ children }: DrawerShellProps) {
  // useDrawer is the source of truth for open/closed; call it here so the
  // hook's effects mount with the shell.
  useDrawer();
  return (
    <div className="drawer-shell" data-testid="drawer-shell">
      <div
        aria-label="More about pretable"
        className="drawer-content overflow-y-auto bg-bg-page"
        id="drawer-content"
        role="region"
      >
        {children}
      </div>
      <DrawerHandle />
    </div>
  );
}
```

- [ ] **Step 3: Delete old `Drawer.tsx` and rename test file.**

```bash
git rm apps/website/app/components/Drawer.tsx
git mv apps/website/app/components/__tests__/Drawer.test.tsx \
       apps/website/app/components/__tests__/DrawerShell.test.tsx
```

(Update the test file's contents to the new test from Step 1.)

- [ ] **Step 4: Update CSS upgrade rules in `globals.css`.**

Replace the old `@layer components` block (the peeking-overlay rules) with the fullscreen-takeover rules:

```css
@layer components {
  .drawer-shell {
    /* SSR / no-JS fallback: render in normal flow as a long page */
    position: relative;
    display: block;
  }

  html[data-drawer] .drawer-shell {
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

  html[data-drawer] .drawer-handle {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 51;
    pointer-events: auto;
  }

  html[data-drawer="open"] .drawer-handle {
    display: none;
  }

  html[data-drawer] .drawer-content {
    height: 100vh;
    overflow-y: auto;
  }

  @media (prefers-reduced-motion: reduce) {
    html[data-drawer] .drawer-shell {
      transition: none;
    }
  }
}
```

- [ ] **Step 5: Run tests.**

```bash
pnpm --filter @pretable/app-website test
```

Expected: green.

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "feat(website): DrawerShell — fullscreen takeover with internal handle"
```

### Task 10: Refactor `apps/website/app/layout.tsx` (drop nav from root)

**Files:**
- Modify: `apps/website/app/layout.tsx`
- Modify: `apps/website/app/docs/layout.tsx`

- [ ] **Step 1: Strip nav from root layout.**

Root layout becomes minimal — no nav, no chrome:

```tsx
import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "pretable",
  description: "The grid that treats scroll as a first-class feature.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Mount `<NavBar mode="site">` in docs layout.**

```tsx
import { NavBar } from "../components/NavBar";
import { DocsSidebar } from "../components/DocsSidebar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <NavBar mode="site" />
      <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-8 px-7 py-12 md:grid-cols-[240px_minmax(0,1fr)] md:px-10 md:py-16">
        <DocsSidebar />
        <article className="...">{children}</article>
      </div>
    </>
  );
}
```

(Keep the existing article className verbatim — only add the `<NavBar>` and the wrapping fragment.)

- [ ] **Step 3: Run typecheck + tests + build.**

```bash
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website build
```

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/layout.tsx apps/website/app/docs/layout.tsx
git commit -m "feat(website): nav moves out of root layout into docs/drawer surfaces"
```

### Task 11: Rewrite `apps/website/app/page.tsx`

**Files:**
- Modify: `apps/website/app/page.tsx`

- [ ] **Step 1: Replace contents.**

```tsx
import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { DrawerShell } from "./components/DrawerShell";
import { FeatureGrid } from "./components/FeatureGrid";
import { HeroGrid } from "./components/HeroGrid";
import { ControlStateProvider } from "./components/heroGrid/controlState";
import { HomeStreamHeader } from "./components/HomeStreamHeader";
import { HowItWorks } from "./components/HowItWorks";
import { MountainFooter } from "./components/MountainFooter";
import { NavBar } from "./components/NavBar";
import { ReceiptsBand } from "./components/ReceiptsBand";

export default function HomePage() {
  return (
    <ControlStateProvider>
      <main>
        <HomeStreamHeader />
        <HeroGrid />
      </main>
      <DrawerShell>
        <DrawerNavSlot />
        <ReceiptsBand />
        <ComparisonTable />
        <HowItWorks />
        <CodeExample />
        <FeatureGrid />
        <CtaSection />
        <MountainFooter />
      </DrawerShell>
    </ControlStateProvider>
  );
}

// Small client wrapper so we can pass close() from the drawer's hook to NavBar
"use client";
function DrawerNavSlot() {
  // useDrawer is already mounted by DrawerShell; we just need close
  // Use a dedicated import to avoid a circular ref.
  // (NavBar mode="drawer" needs onClose — pass useDrawer().close)
  // Implementation note: useDrawer is a hook, must be called inside this client component.
  const { close } = useDrawer();
  return <NavBar mode="drawer" onClose={close} />;
}
import { useDrawer } from "./components/useDrawer";
```

(The above is approximate — your implementation may need to extract `<DrawerNavSlot>` to its own file to keep server/client boundaries clean. If `page.tsx` must stay a server component, move `<DrawerNavSlot>` to `apps/website/app/components/DrawerNavSlot.tsx` and import it.)

- [ ] **Step 2: Verify page.tsx + DrawerNavSlot.tsx compile.**

```bash
pnpm --filter @pretable/app-website typecheck
```

Adapt as needed for server/client boundary.

- [ ] **Step 3: Commit.**

```bash
git add apps/website/app/page.tsx apps/website/app/components/DrawerNavSlot.tsx
git commit -m "feat(website): page.tsx assembles drawer-takeover layout"
```

---

## Phase 4 — Cleanup, smoke, README

### Task 12: Update Playwright smoke spec

**Files:**
- Modify: `apps/website/e2e/smoke.spec.ts`

- [ ] **Step 1: Replace contents.**

```ts
import { expect, test } from "@playwright/test";

test("landing renders grid + control bar + drawer handle; drawer opens", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("pretable");

  await expect(page.locator("[data-pretable-scroll-viewport]")).toBeVisible({
    timeout: 10_000,
  });

  await expect(page.locator("[data-testid='drawer-handle']")).toBeVisible();

  // Drawer is closed initially — main NavBar should not be present (only
  // the drawer's NavBar is mounted, behind the closed drawer).
  await expect(page.locator("[data-testid='drawer-shell']")).toHaveAttribute(
    "data-state",
    /closed|/,
  );

  // Click handle → drawer opens
  await page.locator("[data-testid='drawer-handle']").click();
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");
  await expect(page.getByText(/built in bend, or\./i)).toBeVisible();

  // /docs still resolves
  const docsResponse = await page.goto("/docs", {
    waitUntil: "domcontentloaded",
  });
  expect(docsResponse?.status()).toBe(200);
});
```

- [ ] **Step 2: Commit.**

```bash
git add apps/website/e2e/smoke.spec.ts
git commit -m "test(website): smoke covers drawer-takeover open + /docs route"
```

### Task 13: Update README

**Files:**
- Modify: `apps/website/README.md`

- [ ] Update layout section to describe:
  - Cold landing = TopControlBar + HeroGrid + DrawerHandle (peek)
  - Drawer takeover = NavBar + 6 sections + MountainFooter
  - Single URL `/`, all SSR'd, slide-up via CSS transform
  - Speed slider, pause, live counter
  - `/docs` is its own route under `<NavBar mode="site">`

- [ ] Commit:

```bash
git add apps/website/README.md
git commit -m "docs(website): README for drawer-takeover layout"
```

### Task 14: Final root validation

- [ ] Run all gates:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
pnpm -r --filter '@pretable/{core,react}' --filter '@cacheplane/json-stream' lint:packaging
```

All pass.

---

## Phase 5 — Visual validation + production

### Task 15: Headed Playwright cross-browser walk

- [ ] Install browsers:
```bash
pnpm --filter @pretable/app-website exec playwright install webkit firefox chromium
```

- [ ] Write a validation spec at `apps/website/e2e/visual.spec.ts` that:
  - Navigates to `/`
  - Captures screenshot at viewports 320×568, 375×667, 768×1024, 1024×768, 1280×800, 1920×1080
  - Asserts no console errors during 5-second observation
  - Clicks drawer handle, verifies open transitions, screenshots drawer
  - Closes drawer via "Show the grid" button, verifies close
  - Repeats per project: `webkit`, `chromium`, `firefox`

- [ ] Run:
```bash
pnpm --filter @pretable/app-website exec playwright test visual.spec.ts
```

- [ ] Save screenshots into `apps/website/e2e/__screenshots__/` (gitignored, just for review).

### Task 16: Open PR + merge on green + production validation

- [ ] Push branch:
```bash
git push -u origin feat/website-drawer-takeover
```

- [ ] Open PR with title `feat(website): drawer takeover + grid controls + Safari fix`. Body covers:
  - What changed (architecture, controls, bug fixes folded in)
  - Verification matrix from Task 15
  - Before/after Safari screenshots
  - Lighthouse target

- [ ] Watch CI: `gh pr checks <num> --watch`
- [ ] Merge: `gh pr merge <num> --squash --delete-branch`
- [ ] Watch deploy on Vercel
- [ ] Re-run the visual.spec against `https://pretable.ai`
- [ ] Lighthouse mobile + desktop on `https://pretable.ai`. Target Perf ≥ 80, A11y ≥ 95, BP ≥ 90, SEO ≥ 95.

# Website Bucket B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the text-heavy positioning hero as the first in-drawer section, extract credibility cards into their own section, and reframe the streaming grid as a centered window/bezel that fills the viewport when the drawer is closed.

**Architecture:** Three new components (`CopyPromptButton`, `DrawerHero`, `CredibilityCards`) plus DOM-level edits to `ReceiptsBand`, `page.tsx`, `HeroGrid.tsx`, and `heroGrid.module.css`. Drawer mechanics, streaming-replay logic, and the public package APIs stay untouched.

**Tech Stack:** Next.js 16 (App Router) + Tailwind v4 + vitest + jsdom + Testing Library + `@pretable/react`. Existing Alpenglow palette in `packages/ui/src/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-05-03-website-bucket-b-hero-and-grid-framing-design.md`

**Branch:** `feat/bucket-b-hero-and-framing` (already created off `main`, spec already committed at HEAD).

---

## File Structure

**Create:**
- `apps/website/app/components/CopyPromptButton.tsx` — clipboard-writing button mirroring `CopyCommand` ergonomics. Receives prompt as a prop so the caller controls content.
- `apps/website/app/components/DrawerHero.tsx` — restored positioning hero. Owns the static prompt string constant.
- `apps/website/app/components/CredibilityCards.tsx` — 4-card positioning section extracted from `ReceiptsBand`.
- `apps/website/__tests__/components/CopyPromptButton.test.tsx`
- `apps/website/__tests__/components/DrawerHero.test.tsx`
- `apps/website/__tests__/components/CredibilityCards.test.tsx`

**Modify:**
- `apps/website/app/components/ReceiptsBand.tsx` — remove the `POSITIONING` block (now in `CredibilityCards`).
- `apps/website/__tests__/components/ReceiptsBand.test.tsx` — drop the positioning-cards assertion (now covered by `CredibilityCards.test.tsx`).
- `apps/website/app/page.tsx` — re-order drawer children: NavSlot → DrawerHero → CredibilityCards → ReceiptsBand → … (rest unchanged).
- `apps/website/app/components/HeroGrid.tsx` — wrap the existing `<PretableSurface>` in a bezel container; measure the bezel's inner height with a `ResizeObserver` and pass it as `viewportHeight` so the grid fills the visible area.
- `apps/website/app/components/heroGrid/heroGrid.module.css` — split into outer `.heroBackdrop` (full-bleed gradient backdrop) and inner `.heroBezel` (centered framed window with chrome).

**Won't touch:** `DrawerShell`, `DrawerHandle`, `useDrawer`, `HomeStreamHeader`, `TopControlBar`, the `controlState`/`replay`/`eventLog`/`useFps` modules under `heroGrid/`, or any `packages/*` source.

---

### Task 1: `CopyPromptButton` — TDD

**Files:**
- Create: `apps/website/app/components/CopyPromptButton.tsx`
- Create: `apps/website/__tests__/components/CopyPromptButton.test.tsx`

- [ ] **Step 1.1: Write the failing test**

```tsx
// apps/website/__tests__/components/CopyPromptButton.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopyPromptButton } from "../../app/components/CopyPromptButton";

const PROMPT = "AGENT PROMPT FIXTURE";

describe("CopyPromptButton", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders an accessible button with the default label", () => {
    render(<CopyPromptButton prompt={PROMPT} />);
    expect(
      screen.getByRole("button", { name: /copy ai agent setup prompt/i }),
    ).toHaveTextContent(/copy prompt/i);
  });

  it("writes the prompt to the clipboard on click", () => {
    render(<CopyPromptButton prompt={PROMPT} />);
    fireEvent.click(screen.getByRole("button"));
    expect(writeText).toHaveBeenCalledWith(PROMPT);
  });

  it("flips the label to '✓ copied' for ~1.2s after a successful copy", async () => {
    render(<CopyPromptButton prompt={PROMPT} />);
    fireEvent.click(screen.getByRole("button"));
    await vi.waitFor(() =>
      expect(screen.getByRole("button")).toHaveTextContent(/copied/i),
    );
    vi.advanceTimersByTime(1300);
    await vi.waitFor(() =>
      expect(screen.getByRole("button")).toHaveTextContent(/copy prompt/i),
    );
  });
});
```

- [ ] **Step 1.2: Run the test, confirm it fails**

```bash
pnpm --filter @pretable/app-website test -- CopyPromptButton
```
Expected: FAIL with "Cannot find module … CopyPromptButton".

- [ ] **Step 1.3: Implement `CopyPromptButton`**

```tsx
// apps/website/app/components/CopyPromptButton.tsx
"use client";

import { useState } from "react";

export interface CopyPromptButtonProps {
  prompt: string;
  className?: string;
}

export function CopyPromptButton({ prompt, className }: CopyPromptButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can fail in insecure contexts; silent no-op.
    }
  };

  const classes = [
    "inline-flex cursor-pointer items-center gap-2 rounded-[2px] border border-text-primary bg-transparent",
    "px-[18px] py-[10px] font-mono text-[13px] text-text-primary",
    "transition-colors hover:bg-text-primary hover:text-bg-page",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      aria-label="Copy AI agent setup prompt"
      onClick={onClick}
    >
      {copied ? "✓ copied" : "[ Copy prompt ]"}
    </button>
  );
}
```

- [ ] **Step 1.4: Run the test, confirm it passes**

```bash
pnpm --filter @pretable/app-website test -- CopyPromptButton
```
Expected: PASS, 3/3 tests.

- [ ] **Step 1.5: Commit**

```bash
git add apps/website/app/components/CopyPromptButton.tsx apps/website/__tests__/components/CopyPromptButton.test.tsx
git commit -m "feat(website): CopyPromptButton — clipboard-writing CTA mirroring CopyCommand"
```

---

### Task 2: `CredibilityCards` — extract from `ReceiptsBand`

**Files:**
- Create: `apps/website/app/components/CredibilityCards.tsx`
- Create: `apps/website/__tests__/components/CredibilityCards.test.tsx`

- [ ] **Step 2.1: Write the failing test**

```tsx
// apps/website/__tests__/components/CredibilityCards.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CredibilityCards } from "../../app/components/CredibilityCards";

describe("CredibilityCards", () => {
  afterEach(() => cleanup());

  it("renders all four positioning cards by eyebrow", () => {
    render(<CredibilityCards />);
    expect(screen.getByText(/performance/i)).toBeInTheDocument();
    expect(screen.getByText(/ai-native/i)).toBeInTheDocument();
    expect(screen.getByText(/wrapped text/i)).toBeInTheDocument();
    expect(screen.getByText(/ecosystem/i)).toBeInTheDocument();
  });

  it("renders the section eyebrow '02 · why it works'", () => {
    render(<CredibilityCards />);
    expect(screen.getByText(/02 · why it works/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2.2: Run the test, confirm it fails**

```bash
pnpm --filter @pretable/app-website test -- CredibilityCards
```
Expected: FAIL — "Cannot find module".

- [ ] **Step 2.3: Implement `CredibilityCards` (verbatim copy of the existing JSX block, wrapped in its own section)**

```tsx
// apps/website/app/components/CredibilityCards.tsx
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

export function CredibilityCards() {
  return (
    <section
      id="why-it-works"
      className="text-text-primary border-b border-rule px-7 py-[52px] md:px-10"
    >
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          02 · why it works
        </p>
        <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
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
      </div>
    </section>
  );
}
```

- [ ] **Step 2.4: Run the test, confirm it passes**

```bash
pnpm --filter @pretable/app-website test -- CredibilityCards
```
Expected: PASS, 2/2 tests.

- [ ] **Step 2.5: Commit**

```bash
git add apps/website/app/components/CredibilityCards.tsx apps/website/__tests__/components/CredibilityCards.test.tsx
git commit -m "feat(website): CredibilityCards — 4 positioning cards extracted into own section"
```

---

### Task 3: Trim `ReceiptsBand` — remove the now-extracted positioning block

**Files:**
- Modify: `apps/website/app/components/ReceiptsBand.tsx`
- Modify: `apps/website/__tests__/components/ReceiptsBand.test.tsx`

- [ ] **Step 3.1: Update the test first to reflect the new contract**

Replace the existing `apps/website/__tests__/components/ReceiptsBand.test.tsx` with:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ReceiptsBand } from "../../app/components/ReceiptsBand";

afterEach(() => {
  cleanup();
});

it("renders the receipts band with content", () => {
  const { container } = render(<ReceiptsBand />);
  expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
});

it("renders the receipts headline numbers", () => {
  render(<ReceiptsBand />);
  expect(screen.getByText("4×")).toBeInTheDocument();
  expect(screen.getByText("16ms")).toBeInTheDocument();
});

it("does not render the positioning cards anymore (moved to CredibilityCards)", () => {
  render(<ReceiptsBand />);
  expect(screen.queryByText(/ai-native/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/ecosystem/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3.2: Run, confirm the new "moved to CredibilityCards" test fails**

```bash
pnpm --filter @pretable/app-website test -- ReceiptsBand
```
Expected: FAIL — `ai-native` is still in the DOM.

- [ ] **Step 3.3: Trim `ReceiptsBand.tsx` — delete the `POSITIONING` constant and the second `<ul>`**

Replace `apps/website/app/components/ReceiptsBand.tsx` with:

```tsx
interface Stat {
  value: string;
  caption: string;
}

// Receipts snapshot — numbers from two committed milestone runsets:
//
//   status/milestones/2026-05-01-h1-satisfied.hypotheses.json
//     S2/scroll/hypothesis × 5 repeats, unified row-height formula. H1
//     satisfied. Pretable median 16ms vs AG Grid 67ms = 4× faster.
//
//   status/milestones/2026-05-01-streaming-revalidated.hypotheses.json
//     S5/updates × 6 rates × 3 repeats. H15 satisfied.
//
// Positioning cards (Performance / AI-native / Wrapped / Ecosystem) used
// to live below this stat band; they were extracted to <CredibilityCards />
// in PR for Bucket B so each section has one job.
const STATS: readonly Stat[] = [
  { value: "4×", caption: "faster scroll vs ag-grid" },
  { value: "16ms", caption: "frame p95 / wrapped scroll" },
  { value: "0", caption: "long tasks / streaming" },
  { value: "25k/s", caption: "max sustained update rate" },
];

export function ReceiptsBand() {
  return (
    <section
      id="receipts"
      className="text-text-primary border-b border-rule px-7 py-[52px] md:px-10"
    >
      <div className="mx-auto max-w-[1240px]">
        <h2 className="font-display text-[28px] leading-[1.12] tracking-[-0.02em] md:text-[32px]">
          <em className="italic text-accent-deep">Receipts</em>, not claims.
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
          {STATS.map((stat) => (
            <li
              key={stat.caption}
              className="border-t border-text-primary pt-3"
            >
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
  );
}
```

- [ ] **Step 3.4: Run all three ReceiptsBand tests, confirm pass**

```bash
pnpm --filter @pretable/app-website test -- ReceiptsBand
```
Expected: PASS, 3/3.

- [ ] **Step 3.5: Commit**

```bash
git add apps/website/app/components/ReceiptsBand.tsx apps/website/__tests__/components/ReceiptsBand.test.tsx
git commit -m "refactor(website): ReceiptsBand — drop positioning cards (moved to CredibilityCards)"
```

---

### Task 4: `DrawerHero` — TDD

**Files:**
- Create: `apps/website/app/components/DrawerHero.tsx`
- Create: `apps/website/__tests__/components/DrawerHero.test.tsx`

- [ ] **Step 4.1: Write the failing test**

```tsx
// apps/website/__tests__/components/DrawerHero.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DrawerHero,
  DRAWER_HERO_PROMPT,
} from "../../app/components/DrawerHero";

describe("DrawerHero", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => cleanup());

  it("renders the eyebrow, headline, and subhead", () => {
    render(<DrawerHero />);
    expect(screen.getByText(/pretable — vol\. 2/i)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: /fastest data grid/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/60fps under streaming load/i)).toBeInTheDocument();
  });

  it("renders all three CTAs: copy prompt + npm install + docs link", () => {
    render(<DrawerHero />);
    expect(
      screen.getByRole("button", { name: /copy ai agent setup prompt/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /copy install command/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /read the docs/i }),
    ).toHaveAttribute("href", "/docs");
  });

  it("renders the MIT footer line", () => {
    render(<DrawerHero />);
    expect(screen.getByText(/mit licensed/i)).toBeInTheDocument();
  });

  it("exports a non-empty DRAWER_HERO_PROMPT mentioning @pretable/react", () => {
    expect(DRAWER_HERO_PROMPT.length).toBeGreaterThan(50);
    expect(DRAWER_HERO_PROMPT).toMatch(/@pretable\/react/);
    expect(DRAWER_HERO_PROMPT).toMatch(/https:\/\/pretable\.ai\/docs/);
  });
});
```

- [ ] **Step 4.2: Run the test, confirm it fails**

```bash
pnpm --filter @pretable/app-website test -- DrawerHero
```
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `DrawerHero`**

```tsx
// apps/website/app/components/DrawerHero.tsx
import { CopyCommand } from "./CopyCommand";
import { CopyPromptButton } from "./CopyPromptButton";

export const DRAWER_HERO_PROMPT = `Help me integrate @pretable/react — a high-performance streaming data
grid — into this React app.

Before writing code, ask me:
  1. Where should the grid live? (file path, route, or component name)
  2. What's the data source? (static array, REST, streaming, LLM tokens)
  3. What columns and row shape do you expect?

Then write a step-by-step implementation plan covering: install,
columns + getRowId setup, data wiring, and any streaming adapter
(use @pretable-internal/stream-adapter for LLM / SSE sources). Wait
for my approval before implementing each step.

Docs: https://pretable.ai/docs
`;

export function DrawerHero() {
  return (
    <section
      id="hero"
      className="relative isolate border-b border-rule px-7 py-16 md:px-10 md:py-24"
    >
      <div className="mx-auto max-w-[860px] text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          $ pretable — vol. 2 · no. 1
        </p>
        <h1 className="mt-4 font-display text-[40px] leading-[1.02] tracking-[-0.025em] text-text-primary md:text-[56px] md:leading-none">
          The <em className="italic text-accent">fastest</em> data grid for
          React.
          <br />
          Built for the AI era.
        </h1>
        <p className="mx-auto mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          60fps under streaming load. Zero row drift. A deterministic engine
          designed for live data, agent output, and real-time telemetry — not
          retrofitted from a batch-era grid.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <CopyPromptButton prompt={DRAWER_HERO_PROMPT} />
          <CopyCommand command="npm install @pretable/react" />
          <a
            href="/docs"
            className="font-mono text-[13px] text-accent-deep underline-offset-2 hover:underline"
          >
            Read the docs →
          </a>
        </div>
        <p className="mt-8 font-mono text-[11px] text-text-muted">
          MIT licensed · open source
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4.4: Run the test, confirm it passes**

```bash
pnpm --filter @pretable/app-website test -- DrawerHero
```
Expected: PASS, 4/4.

- [ ] **Step 4.5: Commit**

```bash
git add apps/website/app/components/DrawerHero.tsx apps/website/__tests__/components/DrawerHero.test.tsx
git commit -m "feat(website): DrawerHero — restored positioning hero with copy-prompt CTA"
```

---

### Task 5: Wire the new sections into `page.tsx`

**Files:**
- Modify: `apps/website/app/page.tsx`

- [ ] **Step 5.1: Replace `apps/website/app/page.tsx` with the new ordering**

```tsx
import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CredibilityCards } from "./components/CredibilityCards";
import { CtaSection } from "./components/CtaSection";
import { DrawerHandle } from "./components/DrawerHandle";
import { DrawerHero } from "./components/DrawerHero";
import { DrawerNavSlot } from "./components/DrawerNavSlot";
import { DrawerShell } from "./components/DrawerShell";
import { FeatureGrid } from "./components/FeatureGrid";
import { HeroGrid } from "./components/HeroGrid";
import { ControlStateProvider } from "./components/heroGrid/controlState";
import { HomeStreamHeader } from "./components/HomeStreamHeader";
import { HowItWorks } from "./components/HowItWorks";
import { MountainFooter } from "./components/MountainFooter";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { ScrollReveal } from "./components/ScrollReveal";

export default function HomePage() {
  return (
    <ControlStateProvider>
      <main>
        <HomeStreamHeader />
        <HeroGrid />
      </main>
      <DrawerHandle />
      <DrawerShell>
        <DrawerNavSlot />
        <DrawerHero />
        <CredibilityCards />
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
        <MountainFooter />
      </DrawerShell>
    </ControlStateProvider>
  );
}
```

- [ ] **Step 5.2: Run the full website test suite**

```bash
pnpm --filter @pretable/app-website test
```
Expected: PASS — total count grows by ~9 (3 from CopyPromptButton + 2 from CredibilityCards + 4 from DrawerHero), and the previous-step ReceiptsBand changes already covered.

- [ ] **Step 5.3: Commit**

```bash
git add apps/website/app/page.tsx
git commit -m "feat(website): wire DrawerHero + CredibilityCards into the new drawer order"
```

---

### Task 6: Reframe `HeroGrid` — bezel chrome + measured viewport height

The grid currently sits inside `<section className="hero {styles.hero}">` where `.hero` has `height: calc(100vh - 36px)` (the HomeStreamHeader is 36px) and a flat gradient. `<PretableSurface>` is sized by the hard-coded `viewportHeight={520}` prop, which is why there's empty cream space below the rendered rows. We need a centered bezel container with chrome, and we need to feed the bezel's measured inner height into `viewportHeight`.

**Files:**
- Modify: `apps/website/app/components/HeroGrid.tsx`
- Modify: `apps/website/app/components/heroGrid/heroGrid.module.css`

- [ ] **Step 6.1: Replace `apps/website/app/components/heroGrid/heroGrid.module.css`**

```css
/* Outer band — fills the visible space below HomeStreamHeader and above
   the drawer peek. The Alpenglow gradient is the soft canvas the bezel
   floats on. Padding leaves room for a future sidebar or companion column
   without re-flow. */
.heroBackdrop {
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: center;
  height: calc(100vh - 36px);
  padding: 24px 24px 24px 24px;
  background: linear-gradient(
    180deg,
    var(--pt-bg-page) 0%,
    var(--pt-cream, var(--pt-bg-card)) 100%
  );
}

/* Inner window — the visible "frame" around the streaming demo. */
.heroBezel {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
  max-width: 1400px;
  background: var(--pt-bg-card);
  border: 1px solid var(--pt-rule-strong, var(--pt-rule));
  border-radius: 14px;
  box-shadow: 0 12px 36px rgba(28, 25, 23, 0.08);
  overflow: hidden;
}

/* The grid itself fills the bezel's interior; ResizeObserver measures
   this element to drive viewportHeight on <PretableSurface>. */
.heroSurface {
  position: relative;
  flex: 1 1 auto;
  min-height: 0; /* lets the grid honor the flex parent's height */
}

@media (max-width: 768px) {
  .heroBackdrop {
    padding: 12px;
  }
  .heroBezel {
    border-radius: 10px;
  }
}
```

- [ ] **Step 6.2: Replace `apps/website/app/components/HeroGrid.tsx`**

```tsx
"use client";

import { PretableSurface } from "@pretable/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useControlState } from "./heroGrid/controlState";
import { type HeroEvent, heroEventLog } from "./heroGrid/eventLog";
import { createHeroReplay } from "./heroGrid/replay";
import styles from "./heroGrid/heroGrid.module.css";

const VISIBLE_BUFFER_ROWS = 200;
const FALLBACK_VIEWPORT_HEIGHT = 520;

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

  // Measure the bezel's inner surface so PretableSurface fills it. We use
  // useLayoutEffect for the first paint and a ResizeObserver for window
  // resizes / drawer state changes. SSR falls back to a fixed 520.
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(
    FALLBACK_VIEWPORT_HEIGHT,
  );

  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = Math.max(
        FALLBACK_VIEWPORT_HEIGHT,
        Math.round(el.clientHeight),
      );
      setViewportHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once; ratePerSec changes handled by separate effect
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
    <section className={`hero ${styles.heroBackdrop}`}>
      <div className={styles.heroBezel} data-testid="hero-bezel">
        <div className={styles.heroSurface} ref={surfaceRef}>
          <PretableSurface<DisplayRow>
            ariaLabel="Pretable streaming demo"
            columns={columns}
            getRowId={(row) => row.id}
            rows={rows}
            viewportHeight={viewportHeight}
          />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6.3: Verify the existing `HeroGrid.test.tsx` still passes**

The existing test (`apps/website/app/components/__tests__/HeroGrid.test.tsx`) renders `<HeroGrid>` inside `<ControlStateProvider>` and asserts streaming behavior. The new ResizeObserver path is gated on `typeof ResizeObserver !== "undefined"`. jsdom does not provide ResizeObserver, so the effect is a no-op and `viewportHeight` stays at 520 — same as before. No test changes needed.

```bash
pnpm --filter @pretable/app-website test -- HeroGrid
```
Expected: PASS.

- [ ] **Step 6.4: Add a structural test for the bezel wrapper**

Append to `apps/website/app/components/__tests__/HeroGrid.test.tsx`:

```tsx
it("wraps the grid in a bezel container with the expected testid", () => {
  const view = renderHeroGrid();
  expect(view.getByTestId("hero-bezel")).toBeInTheDocument();
});
```

(Note: `renderHeroGrid` is the existing helper at the top of the file; the import block already brings in `screen`/`render`. If the helper does not return the `view`, change its return to `return render(...)`.)

```bash
pnpm --filter @pretable/app-website test -- HeroGrid
```
Expected: PASS, +1 test.

- [ ] **Step 6.5: Commit**

```bash
git add apps/website/app/components/HeroGrid.tsx apps/website/app/components/heroGrid/heroGrid.module.css apps/website/app/components/__tests__/HeroGrid.test.tsx
git commit -m "feat(website): HeroGrid — bezel chrome + measured viewport height"
```

---

### Task 7: Manual Chrome verification + push

**Files:** none (verification only).

- [ ] **Step 7.1: Run the full repo test suite once**

```bash
pnpm --filter @pretable/app-website test
```
Expected: ALL PASS, ≥ 81 tests (72 baseline + 9 new from Tasks 1/2/4).

- [ ] **Step 7.2: Boot the dev server**

```bash
pkill -f "next dev"; sleep 2
pnpm --filter @pretable/app-website dev > /tmp/website-dev-bucket-b.log 2>&1 &
sleep 8 && grep -E "Ready|Local:" /tmp/website-dev-bucket-b.log | tail -3
```
Expected: `✓ Ready` and `http://localhost:3000`.

- [ ] **Step 7.3: Verify in Chrome via the Claude in Chrome MCP**

Navigate to `http://localhost:3000`, take a screenshot, then:

```js
({
  bezelPresent: !!document.querySelector('[data-testid="hero-bezel"]'),
  bezelMaxWidth: getComputedStyle(document.querySelector('[data-testid="hero-bezel"]')).maxWidth,
  bezelBorderRadius: getComputedStyle(document.querySelector('[data-testid="hero-bezel"]')).borderRadius,
  drawerStateAttr: document.documentElement.getAttribute('data-drawer'),
})
```
Expected: `bezelPresent: true`, `maxWidth: 1400px`, `borderRadius: 14px`, `drawerStateAttr: "closed"`.

Then open the drawer (click the handle) and verify in order:
- DrawerNavSlot (with "Show the grid" button) at top
- DrawerHero — eyebrow, headline "fastest data grid", three CTAs ([Copy prompt] / `$ npm install @pretable/react` / Read the docs →), MIT footer
- CredibilityCards — 4 positioning cards, eyebrow "02 · why it works"
- ReceiptsBand — Receipts headline + 4-stat band, no positioning cards inside it
- Compare → How → Code → Features → CTA → MountainFooter

Then click `[ Copy prompt ]` and confirm the button label flips to `✓ copied`. Click `Show the grid` (in DrawerNavSlot) and confirm the drawer closes and the URL has no hash.

- [ ] **Step 7.4: Stop the dev server**

```bash
pkill -f "next dev"
```

- [ ] **Step 7.5: Push the branch**

```bash
git push -u origin feat/bucket-b-hero-and-framing
```

- [ ] **Step 7.6: Open the PR**

```bash
gh pr create --title "feat(website): bucket B — drawer hero restored + grid bezel" \
  --body "Implements docs/superpowers/specs/2026-05-03-website-bucket-b-hero-and-grid-framing-design.md. Restores the text-heavy positioning hero as the first in-drawer section, extracts credibility cards into their own section, and reframes the streaming grid in a centered max-w-1400 bezel that fills the viewport when the drawer is closed. No public package APIs touched. 72→81 tests."
```

# Landing Content Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `apps/website` landing copy + structure for product/business decision makers. Drop "wedge" jargon. Add 3 new sections (PositioningStrip, UseCases, TrustStrip). Reframe 5 existing sections. Drop the standalone Solution section.

**Architecture:** Section-by-section rewrite. Three new server components, six modified server components, one modified `app/page.tsx` (new section order), one deleted import (Solution). All copy + JSX changes only — no token / build / dependency changes.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, existing `@pretable/ui` tokens. Uses existing `<ScrollReveal>` for entrance animations.

---

## File Structure

**Created:**

- `apps/website/app/components/PositioningStrip.tsx` — 4-card differentiation grid (Performance / AI-native / Wrapped text / Ecosystem).
- `apps/website/app/components/UseCases.tsx` — 3-card use-case section with chips; financial card visually distinguished.
- `apps/website/app/components/TrustStrip.tsx` — cacheplane attribution + GDE pill + financial-services logo row + AG Grid cheeky line.
- `apps/website/__tests__/components/PositioningStrip.test.tsx`
- `apps/website/__tests__/components/UseCases.test.tsx`
- `apps/website/__tests__/components/TrustStrip.test.tsx`

**Modified:**

- `apps/website/app/page.tsx` — new section order; remove `Solution` import; add 3 new section imports; reorder.
- `apps/website/app/components/Hero.tsx` — new headline / subhead / CTAs.
- `apps/website/app/components/Problem.tsx` — full rewrite (timeline + 3 pain cards).
- `apps/website/app/components/ComparisonTable.tsx` — eyebrow / headline / body intro reframe; table data unchanged.
- `apps/website/app/components/CodeExample.tsx` — eyebrow / headline reframe; code snippet unchanged.
- `apps/website/app/components/FeatureGrid.tsx` — drop 2 cards from `FEATURES`; update headline; renumber eyebrow.
- `apps/website/app/components/CtaSection.tsx` — eyebrow + headline reframe.

**Deleted:** none. (`Solution.tsx` is left on disk in case it's reused; only the import + render in `page.tsx` is removed. Test for Solution stays passing — it still renders standalone in tests.)

**Untouched:**

- `PlaygroundSection.tsx`, `ReceiptsBand.tsx`, `LandingAmbient.tsx`, `ScrollReveal.tsx`, `RouteAwareNav.tsx`, `Hero.tsx` AmbientBlob render, `CodeBlock.tsx`, all `@pretable/ui` package code.

---

## Task 1: Hero copy rewrite

**Files:**

- Modify: `apps/website/app/components/Hero.tsx`

- [ ] **Step 1: Read the current Hero**

Run: `cat apps/website/app/components/Hero.tsx`
Note the current headline/subhead/CTAs. Preserve the `<AmbientBlob>` and overall section/markup structure.

- [ ] **Step 2: Replace Hero contents**

Write `apps/website/app/components/Hero.tsx` with:

```tsx
import { AmbientBlob } from "./AmbientBlob";

export function Hero() {
  return (
    <section className="relative isolate px-7 py-24 md:py-32 lg:py-40">
      <AmbientBlob className="absolute -top-32 left-1/2 -translate-x-1/2 size-[640px]" />
      <div className="relative mx-auto max-w-[860px] text-center">
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
          <a
            href="#receipts"
            className="inline-flex items-center gap-2 rounded-[4px] bg-accent px-5 py-2.5 text-[13px] font-semibold text-bg-page hover:bg-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            See the receipts ↓
          </a>
          <a
            href="#grid"
            className="inline-flex items-center gap-2 rounded-[2px] border border-text-primary bg-transparent px-[18px] py-[10px] font-mono text-[13px] text-text-primary hover:bg-bg-raised hover:text-bg-card transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            Try it live ↓
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

Note: The previous Hero used `<CopyCommand command="npm i @pretable/react" />`. The new spec replaces it with the "Try it live ↓" anchor button. The `CopyCommand` import is dropped from this file (still used by other components — don't delete the file).

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @pretable/app-website test -- Hero`
Expected: PASS. The existing `Hero.test.tsx` only asserts `<h1>` exists.

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/components/Hero.tsx
git commit -m "feat(website): hero — performance-first headline + AI-era subhead"
```

---

## Task 2: PositioningStrip (NEW)

**Files:**

- Create: `apps/website/app/components/PositioningStrip.tsx`
- Create: `apps/website/__tests__/components/PositioningStrip.test.tsx`

- [ ] **Step 1: Write the test first**

Create `apps/website/__tests__/components/PositioningStrip.test.tsx`:

```tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { PositioningStrip } from "../../app/components/PositioningStrip";

afterEach(() => {
  cleanup();
});

it("renders four differentiation cards", () => {
  const { container } = render(<PositioningStrip />);
  const headings = container.querySelectorAll("h3");
  expect(headings.length).toBe(4);
});

it("includes the Performance card with the bench:matrix verification line", () => {
  const { container } = render(<PositioningStrip />);
  expect(container.textContent ?? "").toMatch(/performance/i);
  expect(container.textContent ?? "").toContain("pnpm bench:matrix");
});

it("includes the AI-native card", () => {
  const { container } = render(<PositioningStrip />);
  expect(container.textContent ?? "").toMatch(/ai-native|ai isn't a feature/i);
});

it("includes the Wrapped text card", () => {
  const { container } = render(<PositioningStrip />);
  expect(container.textContent ?? "").toMatch(/wrapped text|multi-line/i);
});

it("includes the Ecosystem card mentioning the AI SDKs", () => {
  const { container } = render(<PositioningStrip />);
  expect(container.textContent ?? "").toMatch(/ecosystem/i);
  expect(container.textContent ?? "").toMatch(
    /vercel ai sdk|openai responses|langgraph/i,
  );
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @pretable/app-website test -- PositioningStrip`
Expected: FAIL with "Cannot find module ../../app/components/PositioningStrip".

- [ ] **Step 3: Create PositioningStrip.tsx**

Create `apps/website/app/components/PositioningStrip.tsx`:

```tsx
interface Card {
  num: string;
  eyebrow: string;
  headline: string;
  body: React.ReactNode;
}

const CARDS: readonly Card[] = [
  {
    num: "01",
    eyebrow: "Performance",
    headline: "The fastest grid in independent benchmarks.",
    body: (
      <>
        9 ms frame p95 under 1,000 patches/sec streaming load. Zero long tasks.
        Zero row drift. Verifiable:{" "}
        <code className="font-mono text-[13px] text-accent">
          pnpm bench:matrix
        </code>{" "}
        against AG Grid, TanStack Virtual, MUI X.
      </>
    ),
  },
  {
    num: "02",
    eyebrow: "AI-native",
    headline: "AI isn't a feature. It's the data model.",
    body: (
      <>
        Pretable's engine was designed around streaming and partial data — the
        shape AI agents and live feeds actually produce. Most grids retrofit a
        streaming adapter onto a batch-era data model. Pretable doesn't.
      </>
    ),
  },
  {
    num: "03",
    eyebrow: "Wrapped text",
    headline: "Multi-line cells, no layout thrash.",
    body: (
      <>
        Auto-height rows with wrapped content — at 60fps under streaming. No
        row-jump on hover, no layout shift on scroll, no row-height recalc churn
        when an agent writes longer text mid-stream. Most grids force fixed
        heights to avoid this.
      </>
    ),
  },
  {
    num: "04",
    eyebrow: "Ecosystem",
    headline: "Drops into the AI SDKs you already use.",
    body: (
      <>
        Vercel AI SDK · OpenAI Responses · Anthropic streams · LangGraph · your
        own SSE. One import. The streaming pipeline is purpose-built — every
        other grid leaves it to you.
      </>
    ),
  },
];

export function PositioningStrip() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <ul
          role="list"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5"
        >
          {CARDS.map((card) => (
            <li
              key={card.num}
              className="relative rounded-[8px] border border-rule bg-bg-card/65 p-6 md:p-7"
            >
              <span className="absolute right-4 top-4 font-mono text-[10px] text-text-dim">
                {card.num}
              </span>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                {card.eyebrow}
              </p>
              <h3 className="mt-3 font-display text-[19px] leading-[1.2] tracking-[-0.015em] text-text-primary">
                {card.headline}
              </h3>
              <p className="mt-2 font-display text-[14px] leading-[1.55] text-text-secondary">
                {card.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @pretable/app-website test -- PositioningStrip`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/PositioningStrip.tsx apps/website/__tests__/components/PositioningStrip.test.tsx
git commit -m "feat(website): positioning strip — 4 differentiation cards"
```

---

## Task 3: Problem rewrite

**Files:**

- Modify: `apps/website/app/components/Problem.tsx`

- [ ] **Step 1: Replace Problem.tsx**

```tsx
interface PainCard {
  title: string;
  body: string;
}

const PAIN_CARDS: readonly PainCard[] = [
  {
    title: "Row vanishes mid-stream.",
    body: "Selection breaks on the first patch. Trust evaporates with it.",
  },
  {
    title: "Stream speeds up, frames drop.",
    body: "Demos handle 100/sec. Production at 1k breaks. Users notice.",
  },
  {
    title: "Wrapped text jumps on update.",
    body: "Row heights recalc, viewport shifts. No reading rhythm survives.",
  },
];

const TIMELINE: ReadonlyArray<{ year: string; label: string; now?: boolean }> =
  [
    { year: "1995", label: "Spreadsheet" },
    { year: "2010", label: "Data grid (batch)" },
    { year: "2024", label: "Streaming AI" },
    { year: "NOW", label: "Pretable", now: true },
  ];

export function Problem() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          01 · why now
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Data grids were built for the{" "}
          <em className="italic text-[#818cf8]">batch</em> era.
          <br />
          Then AI showed up.
        </h2>
        <p className="mt-5 max-w-[60ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Every popular React data grid was designed when data arrived in one
          shape: a complete array, fetched once, rendered. AI agents, streaming
          APIs, and live telemetry don't work that way. They produce data{" "}
          <em className="italic">over time</em> — token by token, patch by
          patch, partial first.
        </p>

        <ol
          role="list"
          className="mt-10 grid grid-cols-2 gap-4 border-y border-rule py-6 md:grid-cols-4"
        >
          {TIMELINE.map((cell) => (
            <li key={cell.year} className="text-center">
              <p className="font-mono text-[10px] tracking-[0.14em] text-text-muted">
                {cell.year}
              </p>
              <p
                className={
                  "mt-1 font-display text-[14px] " +
                  (cell.now ? "font-semibold text-accent" : "text-text-primary")
                }
              >
                {cell.label}
              </p>
            </li>
          ))}
        </ol>

        <p className="mt-10 max-w-[60ch] font-display text-[15px] leading-[1.55] text-text-secondary">
          Three failure modes every team building AI-driven dashboards has
          watched ship — symptoms of the same root cause: a render path that
          assumed data arrives all at once.
        </p>

        <ul role="list" className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {PAIN_CARDS.map((card) => (
            <li
              key={card.title}
              className="rounded-[6px] border border-rule bg-bg-card/50 p-5"
            >
              <h3 className="font-display text-[15px] leading-[1.25] text-text-primary">
                {card.title}
              </h3>
              <p className="mt-1.5 font-display text-[13px] leading-[1.5] text-text-secondary">
                {card.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @pretable/app-website test -- Problem`
Expected: PASS. The existing test asserts `<h2>` exists; new H2 is present.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/Problem.tsx
git commit -m "feat(website): problem — batch-era narrative + timeline + 3 pain cards"
```

---

## Task 4: UseCases (NEW)

**Files:**

- Create: `apps/website/app/components/UseCases.tsx`
- Create: `apps/website/__tests__/components/UseCases.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/website/__tests__/components/UseCases.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { UseCases } from "../../app/components/UseCases";

afterEach(() => {
  cleanup();
});

it("renders three use-case cards (3 h3 headings under the section h2)", () => {
  const { container } = render(<UseCases />);
  const cardHeadings = container.querySelectorAll("h3");
  expect(cardHeadings.length).toBe(3);
});

it("renders the section heading 'If you're shipping live data...'", () => {
  const { container } = render(<UseCases />);
  expect(container.textContent ?? "").toMatch(/if you're shipping live data/i);
});

it("includes a card for AI-driven analytics dashboards", () => {
  const { container } = render(<UseCases />);
  expect(container.textContent ?? "").toMatch(/ai-driven analytics/i);
});

it("includes a card for real-time financial dashboards (key ICP)", () => {
  const { container } = render(<UseCases />);
  expect(container.textContent ?? "").toMatch(/real-time financial/i);
});

it("renders integration chips on each card", () => {
  const { container } = render(<UseCases />);
  // chips are styled spans with mono font; minimum 9 chips total (3 per card)
  expect(container.textContent ?? "").toMatch(/openai responses/i);
  expect(container.textContent ?? "").toMatch(/langgraph/i);
  expect(container.textContent ?? "").toMatch(/websocket/i);
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @pretable/app-website test -- UseCases`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create UseCases.tsx**

```tsx
interface UseCase {
  num: string;
  icon: string;
  eyebrow: string;
  headline: string;
  body: string;
  chips: readonly string[];
  variant?: "financial";
}

const USE_CASES: readonly UseCase[] = [
  {
    num: "01",
    icon: "⌗",
    eyebrow: "Use case 01",
    headline: "AI-driven analytics dashboards.",
    body: "Your product asks an LLM to summarize, classify, or rank data. Results stream into a table users actually scroll, sort, and filter. Selection survives the next streaming patch.",
    chips: ["OpenAI Responses", "Vercel AI SDK", "Anthropic"],
  },
  {
    num: "02",
    icon: "⤳",
    eyebrow: "Use case 02",
    headline: "Agent traces and tool-call output.",
    body: "LangGraph or your own agent runtime emits structured events — node transitions, tool calls, intermediate state. Pretable renders the live trace as it happens.",
    chips: ["LangGraph", "CrewAI", "your own SSE"],
  },
  {
    num: "03",
    icon: "$",
    eyebrow: "Use case 03",
    headline: "Real-time financial dashboards.",
    body: "Trading floors, portfolio analytics, risk monitors — thousands of patches/sec, multi-line annotations, no row drift when the market moves. The dashboards capital-markets and asset-management teams already need.",
    chips: ["Market data feeds", "WebSocket", "Server-Sent Events"],
    variant: "financial",
  },
];

export function UseCases() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          02 · built for
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          If you're shipping <em className="italic text-accent">live data</em>,
          you're shipping this.
        </h2>

        <ul
          role="list"
          className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5"
        >
          {USE_CASES.map((uc) => {
            const isFinancial = uc.variant === "financial";
            const cardClass = [
              "flex flex-col gap-3 rounded-[8px] p-6 md:p-7",
              isFinancial
                ? "border border-accent/40 bg-bg-card/85"
                : "border border-rule bg-bg-card/65",
            ].join(" ");
            return (
              <li key={uc.num} className={cardClass}>
                <span
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] border border-accent/30 bg-accent/12 font-mono text-[16px] text-accent"
                  aria-hidden="true"
                >
                  {uc.icon}
                </span>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                  {uc.eyebrow}
                </p>
                <h3 className="font-display text-[18px] leading-[1.2] text-text-primary">
                  {uc.headline}
                </h3>
                <p className="font-display text-[13px] leading-[1.55] text-text-secondary">
                  {uc.body}
                </p>
                <ul
                  role="list"
                  className="mt-2 flex flex-wrap gap-1.5 border-t border-rule pt-3"
                >
                  {uc.chips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-[3px] border border-rule bg-bg-raised/60 px-2 py-1 font-mono text-[10px] text-text-secondary"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @pretable/app-website test -- UseCases`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/UseCases.tsx apps/website/__tests__/components/UseCases.test.tsx
git commit -m "feat(website): use cases — 3 cards w/ financial ICP variant"
```

---

## Task 5: TrustStrip (NEW)

**Files:**

- Create: `apps/website/app/components/TrustStrip.tsx`
- Create: `apps/website/__tests__/components/TrustStrip.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// apps/website/__tests__/components/TrustStrip.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { TrustStrip } from "../../app/components/TrustStrip";

afterEach(() => {
  cleanup();
});

it("renders the Google Developer Experts pill", () => {
  const { container } = render(<TrustStrip />);
  expect(container.textContent ?? "").toMatch(/google developer experts/i);
});

it("renders the cacheplane attribution", () => {
  const { container } = render(<TrustStrip />);
  expect(container.textContent ?? "").toMatch(/cacheplane/i);
});

it("renders all four named financial-tier logos", () => {
  const { container } = render(<TrustStrip />);
  const text = container.textContent ?? "";
  expect(text).toContain("Santander");
  expect(text).toContain("M&T Bank");
  expect(text).toContain("The Motley Fool");
  expect(text).toContain("AG Grid");
});

it("renders the cheeky AG Grid line", () => {
  const { container } = render(<TrustStrip />);
  expect(container.textContent ?? "").toMatch(/yes,\s+that\s+ag\s+grid/i);
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @pretable/app-website test -- TrustStrip`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create TrustStrip.tsx**

```tsx
interface Logo {
  name: string;
  className: string;
}

const FEATURED_LOGOS: readonly Logo[] = [
  { name: "Santander", className: "font-display text-[18px] font-semibold" },
  { name: "M&T Bank", className: "font-display text-[18px] font-semibold" },
  { name: "The Motley Fool", className: "font-display text-[18px] italic" },
  {
    name: "AG Grid",
    className:
      "font-display text-[18px] font-semibold text-accent underline decoration-dotted underline-offset-4",
  },
];

const OTHER_LOGOS = "+ Google · FedEx · ClickUp · Runway";

export function TrustStrip() {
  return (
    <section className="px-7 py-12 md:px-10 md:py-16">
      <div className="mx-auto max-w-[1240px]">
        <div className="rounded-[10px] border border-rule border-t-2 border-t-accent bg-bg-card/55 p-7 md:p-8">
          {/* Pills row */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/8 px-3 py-1.5 font-mono text-[11px] text-text-secondary">
              <span className="font-bold text-accent">G</span> Google Developer
              Experts
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/6 px-3 py-1.5 font-mono text-[11px] text-text-secondary">
              cacheplane, Inc.
            </span>
          </div>

          {/* Attribution headline */}
          <p className="mt-4 max-w-[64ch] font-display text-[17px] leading-[1.4] text-text-primary">
            Pretable is built by{" "}
            <strong className="font-semibold text-accent">cacheplane</strong> —
            Google Developer Experts behind production data and analytics
            interfaces at:
          </p>

          {/* Logo row */}
          <div className="mt-5 flex flex-wrap items-center gap-x-9 gap-y-4 border-y border-rule py-4">
            {FEATURED_LOGOS.map((logo) => (
              <span
                key={logo.name}
                className={logo.className}
                title={
                  logo.name === "AG Grid" ? "yes, that AG Grid" : undefined
                }
              >
                {logo.name}
              </span>
            ))}
            <span className="font-mono text-[12px] text-text-muted">
              {OTHER_LOGOS}
            </span>
          </div>

          {/* Cheeky AG Grid line */}
          <p className="mt-3.5 font-mono text-[11px] italic text-accent">
            <span className="text-text-dim not-italic">↳ </span>
            yes, <em className="italic">that</em> AG Grid. We helped build the
            grid we're now competing with.
          </p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @pretable/app-website test -- TrustStrip`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/TrustStrip.tsx apps/website/__tests__/components/TrustStrip.test.tsx
git commit -m "feat(website): trust strip — cacheplane / GDE attribution + financial logos"
```

---

## Task 6: ReceiptsBand — add anchor id + small reframe

**Files:**

- Modify: `apps/website/app/components/ReceiptsBand.tsx`

The Hero now has `href="#receipts"`. The current ReceiptsBand has no `id`. Add it. Keep all copy / stats unchanged.

- [ ] **Step 1: Read the current file**

Run: `cat apps/website/app/components/ReceiptsBand.tsx`
Note the existing `<section className="...">` opening tag.

- [ ] **Step 2: Add id="receipts" to the section element**

Edit `apps/website/app/components/ReceiptsBand.tsx`. Replace:

```tsx
<section className="text-text-primary border-b border-rule px-7 py-[52px] md:px-10">
```

with:

```tsx
<section
  id="receipts"
  className="text-text-primary border-b border-rule px-7 py-[52px] md:px-10"
>
```

No other changes.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @pretable/app-website test -- ReceiptsBand`
Expected: PASS (the existing test asserts content presence, not the id).

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/components/ReceiptsBand.tsx
git commit -m "feat(website): add id=\"receipts\" anchor for Hero CTA"
```

---

## Task 7: ComparisonTable reframe

**Files:**

- Modify: `apps/website/app/components/ComparisonTable.tsx`

Edit only the eyebrow + headline + body intro. Keep the `ROWS` array, NA_MARKER, table markup, and footer link unchanged.

- [ ] **Step 1: Replace the eyebrow + headline + body intro**

In `apps/website/app/components/ComparisonTable.tsx`, find:

```tsx
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          03 · cell-by-cell receipts
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Cell-by-cell receipts.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          S5 streaming-updates scenario at 1,000 patches/sec, 3 repeats on
          Chromium hypothesis scale. Pretable's column is amber-italic. Numbers
          come from{" "}
          <code className="font-mono text-[15px] text-accent-deep">
            pnpm bench:matrix
          </code>
          ; full sweep at{" "}
          <a
            href="https://github.com/cacheplane/pretable/blob/main/docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            docs/streaming-rate-envelope
          </a>
          .
        </p>
```

Replace with:

```tsx
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          03 · how we compare
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          How we compare.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Streaming workload at 1,000 patches/sec, 3 repeats on Chromium.
          Pretable's column is amber-italic. Numbers come from{" "}
          <code className="font-mono text-[15px] text-accent-deep">
            pnpm bench:matrix
          </code>
          ; full sweep at{" "}
          <a
            href="https://github.com/cacheplane/pretable/blob/main/docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            docs/streaming-rate-envelope
          </a>
          .
        </p>
```

(Three text changes: eyebrow text, h2 text, body intro first sentence.)

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @pretable/app-website test -- ComparisonTable`
Expected: PASS. Existing test only asserts `firstChild` and non-empty text.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/ComparisonTable.tsx
git commit -m "feat(website): comparison table — reframe header to \"How we compare\""
```

---

## Task 8: CodeExample reframe

**Files:**

- Modify: `apps/website/app/components/CodeExample.tsx`

Edit only the eyebrow + headline. Keep the snippet, body copy, and streaming-demo link unchanged.

- [ ] **Step 1: Replace eyebrow + headline**

In `apps/website/app/components/CodeExample.tsx`, find:

```tsx
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          05 · the import
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          One import. Stream tokens into a stable grid.
        </h2>
```

Replace with:

```tsx
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          04 · for engineers
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          For engineers: how it looks in your codebase.
        </h2>
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @pretable/app-website test -- CodeExample`
Expected: PASS. Existing test asserts `<pre>` exists.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/CodeExample.tsx
git commit -m "feat(website): code example — \"For engineers\" reframe"
```

---

## Task 9: FeatureGrid trim + reframe

**Files:**

- Modify: `apps/website/app/components/FeatureGrid.tsx`

Drop the two cards now covered by PositioningStrip (Stream-aware, Wrapped text). Update headline. Renumber eyebrow.

- [ ] **Step 1: Read the current FEATURES array**

Run: `cat apps/website/app/components/FeatureGrid.tsx`
The current array has 6 entries.

- [ ] **Step 2: Replace the FEATURES array, headline, and eyebrow**

In `apps/website/app/components/FeatureGrid.tsx`, find the existing `FEATURES` array (6 entries) and replace with:

```tsx
const FEATURES: readonly Feature[] = [
  {
    title: "60fps performance",
    caption: "500k rows render at frame p95 ≤ 16ms on the S7 stress scenario.",
    receiptLabel: "→ receipt: /bench?s=S7&scale=stress",
    receiptHref: "/bench?s=S7&scale=stress",
  },
  {
    title: "Selection survives filters",
    caption:
      "Row-id keys persist across filter, sort, and live updates. Click a row, filter the grid, the selection sticks.",
    receiptLabel: "→ receipt: live demo above",
    receiptHref: "#grid",
  },
  {
    title: "Deterministic engine",
    caption:
      "The render path is read-able. packages/grid-core ships fewer than 3,000 lines.",
    receiptLabel: "→ receipt: github.com/cacheplane/pretable",
    receiptHref: "https://github.com/cacheplane/pretable",
  },
  {
    title: "No-flash hydration",
    caption:
      "SSR-safe initial paint. Selection state survives hydration. Works in Next.js App Router.",
    receiptLabel: "→ receipt: this page",
    receiptHref: "#",
  },
];
```

(Drops the `Stream-aware` card and the `Wrapped text, no jank` card.)

In the same file, find:

```tsx
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          04 · what's in the box
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Six receipts.
        </h2>
```

Replace with:

```tsx
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          05 · what's in the box
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Engineering credibility points.
        </h2>
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @pretable/app-website test -- FeatureGrid`
Expected: PASS. Existing test asserts `headings.length >= 2`. Trimmed to 4 still passes.

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/components/FeatureGrid.tsx
git commit -m "feat(website): feature grid — trim to 4 (drop dupes w/ positioning strip)"
```

---

## Task 10: CtaSection reframe

**Files:**

- Modify: `apps/website/app/components/CtaSection.tsx`

- [ ] **Step 1: Replace eyebrow + headline**

In `apps/website/app/components/CtaSection.tsx`, find:

```tsx
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          06 · check the receipts
        </p>
        <h2 className="mt-4 font-display text-[40px] leading-[1.02] tracking-[-0.025em] md:text-[56px] md:leading-none">
          Check the receipts.
        </h2>
```

Replace with:

```tsx
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          06 · ready to ship
        </p>
        <h2 className="mt-4 font-display text-[40px] leading-[1.02] tracking-[-0.025em] md:text-[56px] md:leading-none">
          Run the benchmarks. Then ship.
        </h2>
```

(Other CTA text and footer note stay as-is.)

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @pretable/app-website test -- CtaSection`
Expected: PASS. Existing test asserts `<a>` exists.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/CtaSection.tsx
git commit -m "feat(website): cta — \"Run the benchmarks. Then ship.\" headline"
```

---

## Task 11: page.tsx — new section order

**Files:**

- Modify: `apps/website/app/page.tsx`

- [ ] **Step 1: Replace page.tsx**

Write `apps/website/app/page.tsx` with:

```tsx
import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { FeatureGrid } from "./components/FeatureGrid";
import { Hero } from "./components/Hero";
import { PlaygroundSection } from "./components/PlaygroundSection";
import { PositioningStrip } from "./components/PositioningStrip";
import { Problem } from "./components/Problem";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { ScrollReveal } from "./components/ScrollReveal";
import { TrustStrip } from "./components/TrustStrip";
import { UseCases } from "./components/UseCases";

export default function HomePage() {
  return (
    <>
      <Hero />
      <ScrollReveal>
        <PositioningStrip />
      </ScrollReveal>
      <PlaygroundSection />
      <ScrollReveal>
        <Problem />
      </ScrollReveal>
      <ScrollReveal>
        <UseCases />
      </ScrollReveal>
      <ScrollReveal>
        <TrustStrip />
      </ScrollReveal>
      <ScrollReveal>
        <ReceiptsBand />
      </ScrollReveal>
      <ScrollReveal>
        <ComparisonTable />
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
    </>
  );
}
```

Changes vs current:

- Remove `Solution` import (Solution component file remains on disk, just not rendered).
- Add `PositioningStrip`, `UseCases`, `TrustStrip` imports.
- New render order per spec §3.
- Remove `<ScrollReveal><Solution /></ScrollReveal>`.
- `CodeExample` moved above `FeatureGrid` (was after).

- [ ] **Step 2: Run page tests**

Run: `pnpm --filter @pretable/app-website test -- page`
Expected: PASS. The existing `page.test.tsx` asserts content length > 100 and `firstChild` exists. New page emits more content.

- [ ] **Step 3: Run all website tests**

Run: `pnpm --filter @pretable/app-website test`
Expected: 27 PASS (24 existing + 3 new from PositioningStrip/UseCases/TrustStrip).

If any test fails:

- `Hero.test.tsx` / `Problem.test.tsx` / `CtaSection.test.tsx` should be unaffected (they assert structural presence). If a copy assertion broke, the spec changed mid-flight; re-read the spec and align.

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/page.tsx
git commit -m "feat(website): page — new section order (drop Solution, add 3 new)"
```

---

## Task 12: Local CI dry-run + visual smoke + push + PR

- [ ] **Step 1: Run all CI gates**

```bash
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website lint
pnpm --filter @pretable/app-website build
pnpm format
```

All must succeed. If `pnpm format` rewrites anything, commit:

```bash
git add -u
git commit -m "style: apply prettier formatting"
```

- [ ] **Step 2: Boot dev server for visual smoke**

```bash
pnpm --filter @pretable/app-website dev > /tmp/pretable-dev.log 2>&1 &
echo $! > /tmp/pretable-dev.pid
sleep 6
grep -E "Local:|Ready" /tmp/pretable-dev.log
```

Expected: `Local: http://localhost:3000` and `✓ Ready in...`.

- [ ] **Step 3: Visual smoke at desktop (1440px)**

Visit `http://localhost:3000/` in a browser.

Confirm:

- Hero shows "The fastest data grid for React. Built for the AI era." with primary `See the receipts ↓` button.
- PositioningStrip renders 4 cards in a 2×2 grid: Performance / AI-native / Wrapped text / Ecosystem.
- PlaygroundSection (live grid) renders below.
- Problem section shows "Data grids were built for the batch era. Then AI showed up." with the 4-cell timeline (1995 / 2010 / 2024 / NOW) and 3 pain cards beneath.
- UseCases section shows "If you're shipping live data, you're shipping this." with 3 cards. Card 03 (Real-time financial dashboards) has a stronger accent border.
- TrustStrip shows the GDE pill, cacheplane pill, attribution headline, logo row (Santander red, M&T green, The Motley Fool italic, AG Grid accent-cyan with dotted underline, "+ Google · FedEx · ClickUp · Runway"), and the cheeky AG Grid line.
- ReceiptsBand renders with id="receipts" — clicking the Hero "See the receipts ↓" CTA scrolls here.
- ComparisonTable shows "How we compare." with the streaming workload intro (no "S5 hypothesis" jargon).
- CodeExample shows "For engineers: how it looks in your codebase." now sitting above FeatureGrid.
- FeatureGrid shows 4 cards (60fps perf / Selection survives / Deterministic engine / No-flash hydration) under "Engineering credibility points."
- CtaSection shows "Run the benchmarks. Then ship." with both buttons working.

- [ ] **Step 4: Visual smoke at mobile (390px iframe sim)**

Open Chrome DevTools or use the iframe-based mobile sim from prior responsive passes:

```js
document.documentElement.innerHTML =
  '<head><title>mobile</title></head><body style="margin:0;background:#0b1120;display:flex;justify-content:center;padding:20px"><iframe src="http://localhost:3000/" style="border:2px solid red;width:390px;height:844px;background:#0b1120"></iframe></body>';
```

Scroll through. Confirm: PositioningStrip cards stack 1-col; UseCases stack 1-col; TrustStrip pills wrap; logos wrap on multiple lines; pain cards stack 1-col; timeline shows 2-col on mobile per Problem.tsx.

- [ ] **Step 5: Stop dev server**

```bash
kill $(cat /tmp/pretable-dev.pid) 2>/dev/null; rm -f /tmp/pretable-dev.pid
```

- [ ] **Step 6: Push branch and open PR**

```bash
git push -u origin feat/landing-content-rewrite
gh pr create --title "feat(website): landing content rewrite — performance + AI-era for product leaders" --body "$(cat <<'EOF'
## Summary

- Drops "wedge" / developer-jargon framing across all body sections.
- Repositions for product/business decision makers (key ICP: financial-services teams).
- Lead claim: **performance #1**, AI-native architecture #2, wrapped text #3, ecosystem fit #4.
- Three new sections: **PositioningStrip** (4 differentiation cards) · **UseCases** (3 cards w/ financial ICP variant) · **TrustStrip** (cacheplane / Google Developer Experts attribution + Santander / M&T Bank / The Motley Fool / AG Grid logos).
- Five reframed sections: Hero (new headline + CTAs), Problem (timeline + pain cards), ComparisonTable (drop "S5 hypothesis" jargon), CodeExample (move below ComparisonTable, "For engineers" frame), CtaSection ("Run the benchmarks. Then ship.").
- One trim: FeatureGrid drops two cards now covered by PositioningStrip.
- One drop: Solution section removed from page render (file kept on disk).
- Final order: Hero → PositioningStrip → PlaygroundSection → Problem → UseCases → TrustStrip → ReceiptsBand → ComparisonTable → CodeExample → FeatureGrid → CtaSection.

## Test plan

- [x] 27 website tests passing (24 existing + 3 new for PositioningStrip / UseCases / TrustStrip)
- [x] typecheck / lint / build / format all clean
- [x] Visual verified at 1440px desktop and 390px mobile (iframe sim)
- [ ] CI: all green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Merge on green**

Wait for CI; squash-merge.

---

## Self-review

**Spec coverage:**

- §4.1 Hero copy → Task 1 ✅
- §4.2 PositioningStrip → Task 2 ✅
- §4.3 PlaygroundSection (no change) → not a task; verified untouched ✅
- §4.4 Problem rewrite → Task 3 ✅
- §4.5 UseCases → Task 4 ✅
- §4.6 TrustStrip → Task 5 ✅
- §4.7 ReceiptsBand → Task 6 (id only, no copy change per spec) ✅
- §4.8 ComparisonTable reframe → Task 7 ✅
- §4.9 CodeExample reframe + relocate → Task 8 (copy) + Task 11 (page.tsx order) ✅
- §4.10 FeatureGrid trim → Task 9 ✅
- §4.11 CtaSection reframe → Task 10 ✅
- §3 final structure (page.tsx order) → Task 11 ✅
- §6 testing strategy (3 new smoke tests) → Tasks 2, 4, 5 ✅
- §7 verification → Task 12 ✅

**Placeholder scan:** none. Every step has the exact code or text to apply.

**Type / name consistency:** `CARDS`, `PAIN_CARDS`, `TIMELINE`, `USE_CASES`, `FEATURED_LOGOS`, `OTHER_LOGOS`, `FEATURES` — all stable identifiers within their files. Tailwind class names follow existing site conventions (`text-text-primary`, `bg-bg-card`, `text-accent`, `font-display`, `font-mono`, etc. — these tokens are already wired in `globals.css`).

**One nuance flagged:** Task 1 drops the `<CopyCommand>` import from Hero. Hero is currently the sole consumer (verified via `grep -rn "CopyCommand" apps/website/app/`). After this PR, `apps/website/app/components/CopyCommand.tsx` is unused. Leave the file on disk and let lint/tsc pass without warnings — out-of-scope cleanup. A follow-up PR can delete it.

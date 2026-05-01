# Landing How-It-Works Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `<HowItWorks>` section between `<ComparisonTable>` and `<CodeExample>` on the landing page, plus a small client-side `<HowItWorksReveal>` wrapper for the per-row stagger animation.

**Architecture:** One server component (`HowItWorks`) renders the full section content from two data tables (5 layers, 4 callouts). One client component (`HowItWorksReveal`) wraps the layer stack and applies the staggered scroll-reveal animation. Three existing-section eyebrow renumbers ripple from inserting at slot 04. No new tokens, no new dependencies.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, IntersectionObserver (already shimmed in tests).

---

## File Structure

**Created:**

- `apps/website/app/components/HowItWorks.tsx` — server component. Owns header, layer-stack data, callout-card data, and the source-link footer.
- `apps/website/app/components/HowItWorksReveal.tsx` — `"use client"` wrapper. Takes `children` as an array; applies a staggered translate-X reveal triggered by IntersectionObserver. One observer per mount, disconnects after first reveal (matches `<ScrollReveal>` pattern).
- `apps/website/__tests__/components/HowItWorks.test.tsx` — 3 smoke tests.

**Modified:**

- `apps/website/app/page.tsx` — add `HowItWorks` import; wrap in `<ScrollReveal>` between `<ComparisonTable>` and `<CodeExample>`.
- `apps/website/app/components/CodeExample.tsx` — eyebrow text only: `04 · for engineers` → `05 · for engineers`.
- `apps/website/app/components/FeatureGrid.tsx` — eyebrow text only: `05 · what's in the box` → `06 · what's in the box`.
- `apps/website/app/components/CtaSection.tsx` — eyebrow text only: `06 · ready to ship` → `07 · ready to ship`.

**Untouched:** Hero, PositioningStrip, PlaygroundSection, Problem, UseCases, TrustStrip, ReceiptsBand, ComparisonTable. All `@pretable/ui`.

---

## Task 1: Create the layer-stagger reveal client wrapper

**Files:**

- Create: `apps/website/app/components/HowItWorksReveal.tsx`

This is a `"use client"` wrapper. It accepts `children` as an array of React nodes and renders each as a wrapped `<li>` (or `<div>`, depending on what the parent passes) that fades + translates from `-12px` to `0` with a per-index transition delay. Triggered by an IntersectionObserver one-shot on the wrapper element. Matches the existing `<ScrollReveal>` pattern but with per-child stagger.

- [ ] **Step 1: Write the component**

Create `apps/website/app/components/HowItWorksReveal.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

interface HowItWorksRevealProps {
  children: ReactNode[];
  /** ms between each child's reveal start. Default 70. */
  staggerMs?: number;
  /** ms before the first child reveals (after observer fires). Default 0. */
  initialDelayMs?: number;
  /** intersection threshold to trigger. Default 0.2. */
  threshold?: number;
  /** className applied to the wrapper element. */
  className?: string;
}

// Staggered scroll-reveal for the HowItWorks layer stack. Each child gets its
// own transition-delay so layers cascade in from the left as the section
// enters view. One-shot — observer disconnects after first intersection.
//
// Reduced-motion: under prefers-reduced-motion: reduce, all children fade
// in together with no translate (matches site-wide ScrollReveal contract).
export function HowItWorksReveal({
  children,
  staggerMs = 70,
  initialDelayMs = 0,
  threshold = 0.2,
  className,
}: HowItWorksRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div ref={ref} className={className}>
      {children.map((child, i) => (
        <div
          key={i}
          style={{ transitionDelay: `${initialDelayMs + i * staggerMs}ms` }}
          className={[
            "transition-all duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none motion-reduce:duration-200",
            revealed
              ? "opacity-100 translate-x-0"
              : "opacity-0 -translate-x-3 motion-reduce:translate-x-0 motion-reduce:opacity-100",
          ].join(" ")}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
```

Notes:

- The wrapper renders a `<div>` outer + per-child `<div>` slots. If the parent passed `<li>` children, they get nested inside an extra `<div>` — semantic but not breaking for assistive tech (the `role="list"` is set on the parent `<ol>`).
- Under `motion-reduce`, the initial translate is overridden to `translate-x-0` and opacity is forced to 1 immediately, so reduced-motion users see the rows fade in (or appear instantly, depending on browser). Tailwind v4 supports `motion-reduce:` variants natively.

- [ ] **Step 2: Verify the file compiles**

Run: `pnpm --filter @pretable/app-website typecheck`
Expected: clean (no new tests yet, just the new component file).

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/HowItWorksReveal.tsx
git commit -m "feat(website): HowItWorksReveal client wrapper for staggered scroll-reveal"
```

---

## Task 2: Write the HowItWorks tests first

**Files:**

- Create: `apps/website/__tests__/components/HowItWorks.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// apps/website/__tests__/components/HowItWorks.test.tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { HowItWorks } from "../../app/components/HowItWorks";

afterEach(() => {
  cleanup();
});

it("renders the section header (eyebrow + h2)", () => {
  const { container } = render(<HowItWorks />);
  expect(container.textContent ?? "").toMatch(/how it works/i);
  const h2 = container.querySelector("h2");
  expect(h2).toBeInTheDocument();
  expect(h2?.textContent ?? "").toMatch(/deterministic pipeline/i);
});

it("renders five layers with correct names", () => {
  const { container } = render(<HowItWorks />);
  // Layer rows are <h3> headings — one per layer.
  const layerHeadings = container.querySelectorAll(
    "[data-testid='howitworks-layers'] h3",
  );
  expect(layerHeadings.length).toBe(5);
  const text = container.textContent ?? "";
  for (const name of ["Source", "Engine", "Viewport", "Renderer", "Frame"]) {
    expect(text).toContain(name);
  }
});

it("renders four callouts including the DOM/math callout", () => {
  const { container } = render(<HowItWorks />);
  const calloutHeadings = container.querySelectorAll(
    "[data-testid='howitworks-callouts'] h4",
  );
  expect(calloutHeadings.length).toBe(4);
  // The DOM/math callout was explicitly tweaked between spec drafts —
  // assert it specifically as a regression guard.
  expect(container.textContent ?? "").toMatch(/dom is expensive/i);
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `pnpm --filter @pretable/app-website test -- HowItWorks`
Expected: FAIL with "Cannot find module ../../app/components/HowItWorks".

- [ ] **Step 3: Don't commit yet**

The test goes with the component. Commit together in Task 3.

---

## Task 3: Create the HowItWorks server component

**Files:**

- Create: `apps/website/app/components/HowItWorks.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { HowItWorksReveal } from "./HowItWorksReveal";

interface Layer {
  num: string;
  name: string;
  responsibility: string;
  bullets: readonly React.ReactNode[];
  output: string;
  pkg: string;
  accent: boolean;
}

interface Callout {
  heading: string;
  body: React.ReactNode;
}

const LAYERS: readonly Layer[] = [
  {
    num: "01",
    name: "Source",
    responsibility: "Streaming patches and static rows treated identically.",
    bullets: [
      "Token-by-token patches via SSE, WebSocket, or any async iterable",
      <>
        Static{" "}
        <code className="font-mono text-[12px] text-text-primary">Row[]</code>{" "}
        arrays use the same input shape
      </>,
      'No "streaming mode" toggle — adapters convert both to engine input',
    ],
    output: "Row[] | Patch",
    pkg: "stream-adapter",
    accent: false,
  },
  {
    num: "02",
    name: "Engine",
    responsibility: "Pure reducer. Sort, filter, selection, row-id stability.",
    bullets: [
      <code className="font-mono text-[12px] text-text-primary">
        (rows, columns, sort, filter, selection) → Snapshot
      </code>,
      "Deterministic — same inputs always produce the same output, every frame",
      "Row-id keys are first-class — selection survives filters, sorts, and live patches",
      "Under 3,000 lines. Read it end-to-end in one sitting.",
    ],
    output: "Snapshot",
    pkg: "grid-core",
    accent: true,
  },
  {
    num: "03",
    name: "Viewport",
    responsibility:
      "Row-height plan + virtualization range. Off-DOM measurement.",
    bullets: [
      "Wrapped row heights computed with character-width tables and font metrics — pure arithmetic",
      <>
        No{" "}
        <code className="font-mono text-[12px] text-text-primary">
          getBoundingClientRect
        </code>
        , no forced reflow, no measure-on-mount
      </>,
      "Virtualization range derived from scroll position + total planned height",
      "Off-screen rows excluded from the plan — no phantom DOM",
    ],
    output: "RenderPlan",
    pkg: "layout-core + text-core",
    accent: true,
  },
  {
    num: "04",
    name: "Renderer",
    responsibility: "The only stage that touches the DOM.",
    bullets: [
      <>
        Diffs the previous{" "}
        <code className="font-mono text-[12px] text-text-primary">
          RenderPlan
        </code>{" "}
        against the new one
      </>,
      "Patches affected rows; reuses unchanged DOM nodes",
      "Selection, sort indicators, filter chips all data-driven from the snapshot — no imperative state",
    ],
    output: "Element[]",
    pkg: "renderer-dom",
    accent: false,
  },
  {
    num: "05",
    name: "Frame",
    responsibility: "RAF coalesces patches per animation frame.",
    bullets: [
      "100 to 25,000 patches/sec all collapse to one snapshot per frame",
      "Long tasks: zero across the operating envelope",
      "Selection, cursor, scroll position never lost mid-frame",
    ],
    output: "60fps",
    pkg: "browser",
    accent: false,
  },
];

const CALLOUTS: readonly Callout[] = [
  {
    heading: "DOM is expensive. We use math instead.",
    body: (
      <>
        Wrapped row heights computed with character-width tables and font
        metrics — pure arithmetic. No{" "}
        <code className="font-mono text-[11.5px] text-text-primary">
          getBoundingClientRect
        </code>
        , no forced reflow, no measure-on-mount. The DOM is touched exactly once
        per frame, at commit.
      </>
    ),
  },
  {
    heading: "Engine is a pure function.",
    body: (
      <>
        <code className="font-mono text-[11.5px] text-text-primary">
          (rows, columns, sort, filter, selection) → Snapshot
        </code>
        . No imperative DOM. Streaming patches and batch arrays hit the same
        reducer — that's why selection survives every update.
      </>
    ),
  },
  {
    heading: "RAF batches the stream.",
    body: (
      <>
        100 to 25,000 patches/sec all collapse to one snapshot per animation
        frame. Long tasks: zero across the operating envelope.
      </>
    ),
  },
  {
    heading: "Telemetry stays off-DOM.",
    body: (
      <>
        Render counts, viewport range, planned height — all data emitted by the
        engine, never read from the DOM. Zero measurement-induced thrash.
      </>
    ),
  },
];

export function HowItWorks() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          04 · how it works
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          A deterministic pipeline.{" "}
          <em className="italic text-accent">No magic.</em>
        </h2>
        <p className="mt-5 max-w-[65ch] font-display text-[15px] leading-[1.6] text-text-secondary">
          The benchmarks aren't a coincidence. They follow from a render path
          designed around five stages — each one readable, each one verifiable
          in source. Engine and viewport are pure functions; data flows one way;
          the DOM is touched exactly once per frame.
        </p>

        <ol
          role="list"
          data-testid="howitworks-layers"
          className="mt-10 flex flex-col gap-2"
        >
          <HowItWorksReveal>
            {LAYERS.map((layer) => (
              <li
                key={layer.num}
                className={[
                  "grid grid-cols-[44px_1fr] gap-4 rounded-[6px] border p-5 md:grid-cols-[56px_1fr_auto] md:gap-5 md:p-6",
                  layer.accent
                    ? "border-accent/40 bg-bg-card/50"
                    : "border-rule bg-bg-card/65",
                ].join(" ")}
              >
                {/* Left: number + dot */}
                <div className="flex flex-col items-center gap-2 pt-1">
                  <span className="font-mono text-[11px] font-bold tracking-[0.1em] text-text-dim">
                    {layer.num}
                  </span>
                  <span
                    aria-hidden="true"
                    className={[
                      "block h-2 w-2 rounded-full",
                      layer.accent
                        ? "bg-accent shadow-[0_0_0_4px_rgba(56,189,248,0.12)]"
                        : "bg-text-dim",
                    ].join(" ")}
                  />
                </div>

                {/* Middle: name + responsibility + bullets */}
                <div>
                  <h3 className="font-display text-[18px] leading-[1.2] text-text-primary">
                    {layer.name}
                  </h3>
                  <p className="mt-1 font-display text-[13px] leading-[1.5] text-text-secondary">
                    {layer.responsibility}
                  </p>
                  <ul role="list" className="mt-3 flex flex-col gap-1">
                    {layer.bullets.map((bullet, i) => (
                      <li
                        key={i}
                        className="relative pl-4 text-[12.5px] leading-[1.55] text-text-muted"
                      >
                        <span
                          aria-hidden="true"
                          className="absolute left-0 text-accent opacity-70"
                        >
                          ▸
                        </span>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Right: output chip + package badge */}
                <div className="col-span-full flex flex-row items-center gap-2 pl-12 pt-2 md:col-auto md:flex-col md:items-end md:gap-2 md:pl-0 md:pt-0">
                  <span className="rounded-[3px] border border-rule bg-bg-raised/50 px-2 py-0.5 font-mono text-[10px] text-text-secondary">
                    <span className="text-text-dim">→ </span>
                    {layer.output}
                  </span>
                  <span className="rounded-[3px] border border-accent/20 bg-accent/8 px-2.5 py-1 font-mono text-[11px] text-accent">
                    {layer.pkg}
                  </span>
                </div>
              </li>
            ))}
          </HowItWorksReveal>
        </ol>

        <ul
          role="list"
          data-testid="howitworks-callouts"
          className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2"
        >
          {CALLOUTS.map((callout) => (
            <li
              key={callout.heading}
              className="rounded-[4px] border border-rule border-l-2 border-l-accent bg-bg-card/50 p-4 md:p-5"
            >
              <h4 className="font-display text-[15px] leading-[1.25] text-text-primary">
                {callout.heading}
              </h4>
              <p className="mt-1.5 font-display text-[12.5px] leading-[1.55] text-text-secondary">
                {callout.body}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-5 font-mono text-[12px] text-text-muted">
          <span className="text-text-dim">↳ </span>
          Read the source:{" "}
          <a
            href="https://github.com/cacheplane/pretable/tree/main/packages"
            className="text-accent underline decoration-dotted underline-offset-[3px] hover:text-accent-deep"
          >
            packages/grid-core, layout-core, text-core, renderer-dom
          </a>{" "}
          — under 3,000 lines combined.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @pretable/app-website test -- HowItWorks`
Expected: 3 PASS.

If the layer-stagger wrapping caused the layer `<li>` elements to lose their direct-child relationship with the `<ol>`, the `[data-testid='howitworks-layers'] h3` selector still finds them via descendant. The test should still pass — `querySelectorAll("[data-testid='howitworks-layers'] h3")` doesn't require direct child.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/HowItWorks.tsx apps/website/__tests__/components/HowItWorks.test.tsx
git commit -m "feat(website): HowItWorks section — deterministic pipeline + 4 callouts"
```

---

## Task 4: Wire HowItWorks into page.tsx

**Files:**

- Modify: `apps/website/app/page.tsx`

- [ ] **Step 1: Update imports + render**

Replace `apps/website/app/page.tsx` with:

```tsx
import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { FeatureGrid } from "./components/FeatureGrid";
import { Hero } from "./components/Hero";
import { HowItWorks } from "./components/HowItWorks";
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
    </>
  );
}
```

Diff vs current: one new import (`HowItWorks`), one new render block (`<ScrollReveal><HowItWorks /></ScrollReveal>`) inserted between ComparisonTable and CodeExample.

- [ ] **Step 2: Run the page test**

Run: `pnpm --filter @pretable/app-website test -- page`
Expected: PASS. The existing `page.test.tsx` asserts `firstChild` and content length > 100 — adding a section grows content, still passes.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/page.tsx
git commit -m "feat(website): wire HowItWorks into page between Comparison and Code"
```

---

## Task 5: Renumber CodeExample eyebrow

**Files:**

- Modify: `apps/website/app/components/CodeExample.tsx`

- [ ] **Step 1: Edit the eyebrow**

In `apps/website/app/components/CodeExample.tsx`, find:

```tsx
          04 · for engineers
```

Replace with:

```tsx
          05 · for engineers
```

(The exact line is the only `04 · for engineers` string in the file.)

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @pretable/app-website test -- CodeExample`
Expected: PASS. Test asserts `<pre>` exists, not eyebrow text.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/CodeExample.tsx
git commit -m "chore(website): renumber CodeExample eyebrow to 05"
```

---

## Task 6: Renumber FeatureGrid eyebrow

**Files:**

- Modify: `apps/website/app/components/FeatureGrid.tsx`

- [ ] **Step 1: Edit the eyebrow**

In `apps/website/app/components/FeatureGrid.tsx`, find:

```tsx
          05 · what's in the box
```

Replace with:

```tsx
          06 · what's in the box
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @pretable/app-website test -- FeatureGrid`
Expected: PASS. Test asserts heading count, not eyebrow text.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/FeatureGrid.tsx
git commit -m "chore(website): renumber FeatureGrid eyebrow to 06"
```

---

## Task 7: Renumber CtaSection eyebrow

**Files:**

- Modify: `apps/website/app/components/CtaSection.tsx`

- [ ] **Step 1: Edit the eyebrow**

In `apps/website/app/components/CtaSection.tsx`, find:

```tsx
          06 · ready to ship
```

Replace with:

```tsx
          07 · ready to ship
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @pretable/app-website test -- CtaSection`
Expected: PASS. Test asserts `<a>` exists, not eyebrow text.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/CtaSection.tsx
git commit -m "chore(website): renumber CtaSection eyebrow to 07"
```

---

## Task 8: Local CI dry-run + visual smoke + push + PR

- [ ] **Step 1: Run all CI gates**

```bash
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website lint
pnpm --filter @pretable/app-website build
pnpm format
```

All must succeed. Final test count: previous 38 + 3 new = **41 passing**.

If `pnpm format` rewrites anything, commit:

```bash
git add -u
git commit -m "style: apply prettier formatting"
```

- [ ] **Step 2: Boot dev server for visual smoke**

```bash
pnpm --filter @pretable/app-website dev > /tmp/pretable-dev-howitworks.log 2>&1 &
echo $! > /tmp/pretable-dev-howitworks.pid
sleep 6
grep -E "Local:|Ready" /tmp/pretable-dev-howitworks.log
```

Expected: `Local: http://localhost:3000` + `✓ Ready`.

- [ ] **Step 3: Visual smoke at desktop (1440px)**

Visit `http://localhost:3000/`. Scroll past ReceiptsBand and ComparisonTable. Confirm:

- HowItWorks section appears between ComparisonTable ("How we compare.") and CodeExample ("For engineers...").
- Eyebrow reads `04 · how it works` (mono accent).
- Headline: "A deterministic pipeline. **No magic.**" — "No magic." is italic accent.
- Five layer rows visible in order: Source → Engine → Viewport → Renderer → Frame.
- Engine + Viewport rows have accent-colored border + brighter accent dot in the left gutter.
- Each layer shows: number, dot, name, responsibility, 3-4 bullet points, output chip (e.g., `→ Snapshot`), package badge (e.g., `grid-core`).
- Four callouts below the layer stack in a 2×2 grid. First callout: "DOM is expensive. We use math instead."
- Footer link: `↳ Read the source: packages/grid-core, layout-core, text-core, renderer-dom — under 3,000 lines combined.`
- Eyebrow renumbering: CodeExample now reads `05 · for engineers`, FeatureGrid `06 · what's in the box`, CtaSection `07 · ready to ship`.
- On scroll into view, layer rows cascade from the left with ~70ms stagger.

- [ ] **Step 4: Visual smoke at mobile (390px iframe sim)**

Open Chrome DevTools or use the iframe pattern:

```js
document.documentElement.innerHTML =
  '<head><title>mobile</title></head><body style="margin:0;background:#0b1120;display:flex;justify-content:center;padding:20px"><iframe src="http://localhost:3000/" style="border:2px solid red;width:390px;height:844px;background:#0b1120"></iframe></body>';
```

Scroll through to HowItWorks. Confirm:

- Layer rows stack: number+dot column on left, content fills the rest, package badge + output chip wrap to a second row beneath the bullets (per the `md:` breakpoint).
- Callouts stack 1-column.
- Footer link wraps cleanly.

- [ ] **Step 5: Stop dev server**

```bash
kill $(cat /tmp/pretable-dev-howitworks.pid) 2>/dev/null; rm -f /tmp/pretable-dev-howitworks.pid
```

- [ ] **Step 6: Push branch and open PR**

```bash
git push -u origin feat/landing-how-it-works
gh pr create --title "feat(website): HowItWorks section — deterministic pipeline" --body "$(cat <<'EOF'
## Summary

Adds a new **HowItWorks** section to the landing between **ComparisonTable** and **CodeExample**. Surfaces the architectural decisions behind Pretable's performance for technical decision makers (and gives product/business buyers an "ask your engineers" page they can point at).

- **Five-stage layered stack**: Source → Engine → Viewport → Renderer → Frame. Each row shows responsibility + 3-4 design choices + output type chip + package badge. Engine + Viewport accent-colored — the two pure functions Pretable controls end-to-end.
- **Four callouts**: DOM is expensive (we use math instead) · Engine is a pure function · RAF batches the stream · Telemetry stays off-DOM.
- **Source link footer**: under 3,000 lines combined across grid-core, layout-core, text-core, renderer-dom.
- **Scroll-reveal animation**: rows cascade in from the left with 70ms stagger; respects `prefers-reduced-motion`.
- **Eyebrow renumbering ripple**: CodeExample 04→05, FeatureGrid 05→06, CtaSection 06→07.

## Test plan

- [x] 41 website tests passing (38 existing + 3 new for HowItWorks)
- [x] typecheck / lint / build / format all clean
- [x] Visual verified at desktop 1440px and mobile 390px (iframe sim)
- [x] Scroll-reveal cascade verified visually
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

- §3 section structure → Task 3 (server component owns header + layers + callouts + footer) ✅
- §4.1 header copy → Task 3 ✅
- §4.2 five layers (data + bullets) → Task 3 LAYERS array ✅
- §4.3 four callouts → Task 3 CALLOUTS array ✅
- §4.4 footer source link → Task 3 ✅
- §5 animation (70ms stagger, ease, reduced-motion) → Task 1 (`HowItWorksReveal`) ✅
- §6 placement + renumbering → Task 4 (placement) + Tasks 5, 6, 7 (renumbering) ✅
- §7 file structure → matches Tasks 1, 3 (created); 4, 5, 6, 7 (modified) ✅
- §8 component shape (data-driven LAYERS/CALLOUTS) → Task 3 ✅
- §9 testing (3 smoke tests) → Task 2 + Task 3 ✅
- §10 verification → Task 8 ✅

**Placeholder scan:** none. Every step has the literal code or string change.

**Type / name consistency:**

- `HowItWorksReveal` exported by Task 1, imported by Task 3 — names match.
- `Layer` and `Callout` interfaces declared in Task 3, consumed in the same file — internal.
- `data-testid="howitworks-layers"` and `data-testid="howitworks-callouts"` — used in Task 2 tests AND Task 3 component, names match exactly.
- Output strings: `Row[] | Patch`, `Snapshot`, `RenderPlan`, `Element[]`, `60fps` — match spec §4.2.
- Package strings: `stream-adapter`, `grid-core`, `layout-core + text-core`, `renderer-dom`, `browser` — match spec §4.2.

**Risks (carried from spec):**

- Layer 03 character-width-tables claim was verified at spec time (`text-core` uses `averageCharWidth × graphemeCount`). No change needed.
- "Under 3,000 lines combined" was verified at spec time (1,661 lines combined source). Conservative claim.
- Animation timing — if 70ms feels off in production, a single literal in `HowItWorksReveal.tsx` (Task 1) tunes it. Plan does not need to change.

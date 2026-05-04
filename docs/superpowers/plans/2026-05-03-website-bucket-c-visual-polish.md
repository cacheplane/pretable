# Website Bucket C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three drawer-section visual polish passes — invert Receipts to a slate band, add a PipelineDiagram above the HowItWorks layer cards (and unify their borders), and replace the single-snippet CodeExample with a 4-tab VS-Code-style interface.

**Architecture:** Two new components (`PipelineDiagram`, `CodeTabs`), one new shared constants file (`howItWorksLayers.ts`), class swaps in `ReceiptsBand`, restructure of `HowItWorks` and `CodeExample` to consume the new components. No public-API changes; no drawer or grid mechanics touched.

**Tech Stack:** Next.js 16 (App Router) + Tailwind v4 + vitest + jsdom + Testing Library + shiki (existing CodeBlock).

**Spec:** `docs/superpowers/specs/2026-05-03-website-bucket-c-visual-polish-design.md`

**Branch:** `feat/bucket-c-receipts-pipeline-codetabs` (already created off `main`, spec already committed at HEAD).

---

## File Structure

**Create:**

- `apps/website/app/components/howItWorksLayers.ts` — `LAYERS` array (5 entries), shared by HowItWorks and PipelineDiagram. Drops the `accent: boolean` field used by the old per-layer border switch.
- `apps/website/app/components/PipelineDiagram.tsx` — pure-SVG horizontal flow diagram (md+) and vertical down-arrow stack (<md). Server component, no client state.
- `apps/website/app/components/CodeTabs.tsx` — client component owning `activeIndex`. Renders `role="tablist"` + tab buttons + the active `<tabpanel>`. Receives pre-rendered code panels as a `panels` prop.
- `apps/website/__tests__/components/PipelineDiagram.test.tsx`
- `apps/website/__tests__/components/CodeTabs.test.tsx`

**Modify:**

- `apps/website/app/components/ReceiptsBand.tsx` — class swaps for inverted slate band (no structural change).
- `apps/website/__tests__/components/ReceiptsBand.test.tsx` — add a regression assertion that the section root has the inverted class.
- `apps/website/app/components/HowItWorks.tsx` — import LAYERS from the new shared file, render `<PipelineDiagram>` above LayerStack, remove per-layer accent-border switch.
- `apps/website/__tests__/components/HowItWorks.test.tsx` — add assertion that the diagram renders.
- `apps/website/app/components/CodeExample.tsx` — define TABS array, pre-render each via `CodeBlock`, hand to `<CodeTabs>`. Fix `<PretableGrid>` typo to `<Pretable>` and add `getRowId` in the chat-grid snippet.
- `apps/website/__tests__/components/CodeExample.test.tsx` — assert tab bar with 4 tab labels.

**Won't touch:** `packages/*`, drawer mechanics, HeroGrid, CredibilityCards, page.tsx ordering, hero/CTA/footer sections.

---

### Task 1: Extract LAYERS to a shared module (drop `accent` field)

**Files:**

- Create: `apps/website/app/components/howItWorksLayers.ts`
- Modify: `apps/website/app/components/HowItWorks.tsx`

This is a pure extraction + minor data shape change. No new behavior — tests should still pass.

- [ ] **Step 1.1: Create the shared LAYERS module**

```tsx
// apps/website/app/components/howItWorksLayers.ts
import type { ReactNode } from "react";

export interface PipelineLayer {
  num: string;
  name: string;
  responsibility: string;
  bullets: readonly ReactNode[];
  output: string;
  pkg: string;
  /** Core stage hint — used by HowItWorks for the dot+glow on the number column. */
  core: boolean;
}

export const LAYERS: readonly PipelineLayer[] = [
  {
    num: "01",
    name: "Source",
    responsibility: "Streaming patches and static rows treated identically.",
    bullets: [
      "Token-by-token patches via SSE, WebSocket, or any async iterable",
      "Static Row[] arrays use the same input shape",
      'No "streaming mode" toggle — adapters convert both to engine input',
    ],
    output: "Row[] | Patch",
    pkg: "stream-adapter",
    core: false,
  },
  {
    num: "02",
    name: "Engine",
    responsibility: "Pure reducer. Sort, filter, selection, row-id stability.",
    bullets: [
      "(rows, columns, sort, filter, selection) → Snapshot",
      "Deterministic — same inputs always produce the same output, every frame",
      "Row-id keys are first-class — selection survives filters, sorts, and live patches",
      "Under 3,000 lines. Read it end-to-end in one sitting.",
    ],
    output: "Snapshot",
    pkg: "grid-core",
    core: true,
  },
  {
    num: "03",
    name: "Viewport",
    responsibility:
      "Row-height plan + virtualization range. Off-DOM measurement.",
    bullets: [
      "Wrapped row heights computed with character-width tables and font metrics — pure arithmetic",
      "No getBoundingClientRect, no forced reflow, no measure-on-mount",
      "Virtualization range derived from scroll position + total planned height",
      "Off-screen rows excluded from the plan — no phantom DOM",
    ],
    output: "RenderPlan",
    pkg: "layout-core + text-core",
    core: true,
  },
  {
    num: "04",
    name: "Renderer",
    responsibility: "The only stage that touches the DOM.",
    bullets: [
      "Diffs the previous RenderPlan against the new one",
      "Patches affected rows; reuses unchanged DOM nodes",
      "Selection, sort indicators, filter chips all data-driven from the snapshot — no imperative state",
    ],
    output: "Element[]",
    pkg: "renderer-dom",
    core: false,
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
    core: false,
  },
];
```

Note: bullets that previously contained `<code>` JSX have been flattened to plain strings here, since the diagram doesn't render bullets and the cards still get readable text. If the cards need the inline-code styling back later, it's a one-line CSS addition.

- [ ] **Step 1.2: Replace `apps/website/app/components/HowItWorks.tsx` to consume the shared module**

The accent-border switch is still in this file at this step — we drop it in Task 3. For now, just import the new LAYERS and keep behavior identical (mapping `core` back to the old `accent` flag locally).

```tsx
// apps/website/app/components/HowItWorks.tsx
import { LayerStack, type LayerStackItem } from "./LayerStack";
import { LAYERS } from "./howItWorksLayers";

interface Callout {
  heading: string;
  body: React.ReactNode;
}

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

        <LayerStack
          testId="howitworks-layers"
          className="mt-10 flex flex-col gap-2"
          items={LAYERS.map(
            (layer): LayerStackItem => ({
              key: layer.num,
              className: [
                "grid grid-cols-[44px_1fr] gap-4 rounded-[6px] border p-5 md:grid-cols-[56px_1fr_auto] md:gap-5 md:p-6",
                layer.core
                  ? "border-accent/40 bg-bg-card/50"
                  : "border-rule bg-bg-card/65",
              ].join(" "),
              children: (
                <>
                  <div className="flex flex-col items-center gap-2 pt-1">
                    <span className="font-mono text-[11px] font-bold tracking-[0.1em] text-text-dim">
                      {layer.num}
                    </span>
                    <span
                      aria-hidden="true"
                      className={[
                        "block h-2 w-2 rounded-full",
                        layer.core
                          ? "bg-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--pt-accent)_12%,transparent)]"
                          : "bg-text-dim",
                      ].join(" ")}
                    />
                  </div>
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
                  <div className="col-span-full flex flex-row items-center gap-2 pl-12 pt-2 md:col-auto md:flex-col md:items-end md:gap-2 md:pl-0 md:pt-0">
                    <span className="rounded-[3px] border border-rule bg-bg-raised/50 px-2 py-0.5 font-mono text-[10px] text-text-secondary">
                      <span className="text-text-dim">→ </span>
                      {layer.output}
                    </span>
                    <span className="rounded-[3px] border border-accent/20 bg-accent/8 px-2.5 py-1 font-mono text-[11px] text-accent">
                      {layer.pkg}
                    </span>
                  </div>
                </>
              ),
            }),
          )}
        />

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

- [ ] **Step 1.3: Run the test suite, confirm green**

```bash
pnpm --filter @pretable/app-website test
```

Expected: ALL PASS (≥ 82). HowItWorks tests still pass since `core` maps to the same JSX behavior `accent` had.

- [ ] **Step 1.4: Commit**

```bash
git add apps/website/app/components/howItWorksLayers.ts apps/website/app/components/HowItWorks.tsx
git commit -m "refactor(website): extract HowItWorks LAYERS to shared module"
```

---

### Task 2: PipelineDiagram component — TDD

**Files:**

- Create: `apps/website/app/components/PipelineDiagram.tsx`
- Create: `apps/website/__tests__/components/PipelineDiagram.test.tsx`

- [ ] **Step 2.1: Write the failing test**

```tsx
// apps/website/__tests__/components/PipelineDiagram.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PipelineDiagram } from "../../app/components/PipelineDiagram";

describe("PipelineDiagram", () => {
  afterEach(() => cleanup());

  it("renders all five stage names", () => {
    render(<PipelineDiagram />);
    for (const name of ["Source", "Engine", "Viewport", "Renderer", "Frame"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("renders all five package badges", () => {
    render(<PipelineDiagram />);
    expect(screen.getByText(/stream-adapter/)).toBeInTheDocument();
    expect(screen.getByText(/grid-core/)).toBeInTheDocument();
    expect(screen.getByText(/layout-core \+ text-core/)).toBeInTheDocument();
    expect(screen.getByText(/renderer-dom/)).toBeInTheDocument();
    expect(screen.getByText(/browser/)).toBeInTheDocument();
  });

  it("renders the four output-shape arrow labels in order", () => {
    const { container } = render(<PipelineDiagram />);
    const text = container.textContent ?? "";
    const order = ["Row[] | Patch", "Snapshot", "RenderPlan", "Element[]"];
    let cursor = 0;
    for (const label of order) {
      const next = text.indexOf(label, cursor);
      expect(
        next,
        `expected to find ${label} after position ${cursor}`,
      ).toBeGreaterThan(-1);
      cursor = next + label.length;
    }
  });

  it("exposes a testid root and an accessible region label", () => {
    render(<PipelineDiagram />);
    const root = screen.getByTestId("pipeline-diagram");
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/render pipeline/i),
    );
  });
});
```

- [ ] **Step 2.2: Run, confirm fails**

```bash
pnpm --filter @pretable/app-website test -- PipelineDiagram
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement PipelineDiagram**

The component is a CSS flex layout, not SVG — that's simpler, accessible by default, and responsive without media-query SVG juggling. The "arrow" between boxes is a `→` glyph (or stacked `↓` on small screens) plus the output-shape label.

```tsx
// apps/website/app/components/PipelineDiagram.tsx
import { LAYERS } from "./howItWorksLayers";

// 4 arrow labels = the 4 output shapes that flow between the 5 stages.
// LAYERS[i].output is what STAGE i emits to STAGE i+1; we map the first
// four (Source..Renderer) onto the arrows. Frame's output ("60fps") is
// the terminal result and is not an arrow label.
const ARROW_LABELS = LAYERS.slice(0, -1).map((layer) => layer.output);

export function PipelineDiagram() {
  return (
    <div
      data-testid="pipeline-diagram"
      role="group"
      aria-label="Pretable's render pipeline"
      className="mt-10 rounded-[10px] border border-rule bg-bg-card/40 p-5 md:p-7"
    >
      <ol
        role="list"
        className="flex flex-col items-stretch gap-3 md:flex-row md:items-center md:gap-2"
      >
        {LAYERS.map((layer, i) => (
          <li key={layer.num} className="contents">
            {/* Stage box */}
            <div className="relative flex min-w-0 flex-1 flex-col rounded-[8px] border border-rule bg-bg-card px-4 py-3">
              {layer.core && (
                <span
                  aria-hidden="true"
                  className="absolute right-2 top-2 block h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--pt-accent)_15%,transparent)]"
                />
              )}
              <span className="font-mono text-[10px] tracking-[0.1em] text-text-dim">
                {layer.num}
              </span>
              <span className="mt-1 font-display text-[16px] leading-[1.15] text-text-primary">
                {layer.name}
              </span>
              <span className="mt-2 truncate font-mono text-[10px] text-accent">
                {layer.pkg}
              </span>
            </div>

            {/* Arrow + output-shape label between stages, except after the last */}
            {i < ARROW_LABELS.length && (
              <div className="flex flex-row items-center justify-center gap-2 px-1 md:flex-col md:gap-0.5">
                <span className="font-mono text-[10px] text-text-muted">
                  {ARROW_LABELS[i]}
                </span>
                <span aria-hidden="true" className="text-accent">
                  <span className="md:hidden">↓</span>
                  <span className="hidden md:inline">→</span>
                </span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2.4: Run, confirm passes**

```bash
pnpm --filter @pretable/app-website test -- PipelineDiagram
```

Expected: PASS, 4/4.

- [ ] **Step 2.5: Commit**

```bash
git add apps/website/app/components/PipelineDiagram.tsx apps/website/__tests__/components/PipelineDiagram.test.tsx
git commit -m "feat(website): PipelineDiagram — 5-stage flow with output-shape arrows"
```

---

### Task 3: Wire PipelineDiagram into HowItWorks + drop per-layer accent border switch

**Files:**

- Modify: `apps/website/app/components/HowItWorks.tsx`
- Modify: `apps/website/__tests__/components/HowItWorks.test.tsx`

- [ ] **Step 3.1: Add an assertion that the diagram renders. Update the test FIRST**

Replace `apps/website/__tests__/components/HowItWorks.test.tsx` with:

```tsx
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

it("renders the pipeline diagram above the layer cards", () => {
  const { container } = render(<HowItWorks />);
  const diagram = container.querySelector('[data-testid="pipeline-diagram"]');
  const layers = container.querySelector('[data-testid="howitworks-layers"]');
  expect(diagram).toBeInTheDocument();
  expect(layers).toBeInTheDocument();
  // Diagram must come before layer cards in the DOM.
  expect(
    diagram!.compareDocumentPosition(layers!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("renders five layer cards with the same border treatment (no per-layer accent)", () => {
  const { container } = render(<HowItWorks />);
  const cards = container.querySelectorAll(
    "[data-testid='howitworks-layers'] > *",
  );
  expect(cards.length).toBe(5);
  // Every card uses border-rule (none uses border-accent/40).
  for (const card of cards) {
    expect(card.className).toContain("border-rule");
    expect(card.className).not.toContain("border-accent/40");
  }
});

it("renders five layers with correct names", () => {
  const { container } = render(<HowItWorks />);
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
  expect(container.textContent ?? "").toMatch(/dom is expensive/i);
});
```

- [ ] **Step 3.2: Run the tests, confirm the new assertions fail**

```bash
pnpm --filter @pretable/app-website test -- HowItWorks
```

Expected: FAIL — diagram not present + cards still have `border-accent/40` from `core`.

- [ ] **Step 3.3: Update `HowItWorks.tsx` — add the diagram, drop the accent-border switch**

Replace the file with:

```tsx
// apps/website/app/components/HowItWorks.tsx
import { LayerStack, type LayerStackItem } from "./LayerStack";
import { LAYERS } from "./howItWorksLayers";
import { PipelineDiagram } from "./PipelineDiagram";

interface Callout {
  heading: string;
  body: React.ReactNode;
}

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

        <PipelineDiagram />

        <LayerStack
          testId="howitworks-layers"
          className="mt-6 flex flex-col gap-2"
          items={LAYERS.map(
            (layer): LayerStackItem => ({
              key: layer.num,
              // All cards use the same neutral border. The core-stage hint is
              // carried by the dot+glow on the number column, not the border.
              className:
                "grid grid-cols-[44px_1fr] gap-4 rounded-[6px] border border-rule bg-bg-card/65 p-5 md:grid-cols-[56px_1fr_auto] md:gap-5 md:p-6",
              children: (
                <>
                  <div className="flex flex-col items-center gap-2 pt-1">
                    <span className="font-mono text-[11px] font-bold tracking-[0.1em] text-text-dim">
                      {layer.num}
                    </span>
                    <span
                      aria-hidden="true"
                      className={[
                        "block h-2 w-2 rounded-full",
                        layer.core
                          ? "bg-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--pt-accent)_12%,transparent)]"
                          : "bg-text-dim",
                      ].join(" ")}
                    />
                  </div>
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
                  <div className="col-span-full flex flex-row items-center gap-2 pl-12 pt-2 md:col-auto md:flex-col md:items-end md:gap-2 md:pl-0 md:pt-0">
                    <span className="rounded-[3px] border border-rule bg-bg-raised/50 px-2 py-0.5 font-mono text-[10px] text-text-secondary">
                      <span className="text-text-dim">→ </span>
                      {layer.output}
                    </span>
                    <span className="rounded-[3px] border border-accent/20 bg-accent/8 px-2.5 py-1 font-mono text-[11px] text-accent">
                      {layer.pkg}
                    </span>
                  </div>
                </>
              ),
            }),
          )}
        />

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

- [ ] **Step 3.4: Run the suite, confirm green**

```bash
pnpm --filter @pretable/app-website test
```

Expected: ALL PASS (count grew by ~6 from Tasks 2/3 minus the dropped/replaced HowItWorks assertions).

- [ ] **Step 3.5: Commit**

```bash
git add apps/website/app/components/HowItWorks.tsx apps/website/__tests__/components/HowItWorks.test.tsx
git commit -m "feat(website): HowItWorks — render PipelineDiagram + unify card borders"
```

---

### Task 4: Receipts inversion — class swaps

**Files:**

- Modify: `apps/website/app/components/ReceiptsBand.tsx`
- Modify: `apps/website/__tests__/components/ReceiptsBand.test.tsx`

- [ ] **Step 4.1: Add the regression assertion FIRST**

Replace `apps/website/__tests__/components/ReceiptsBand.test.tsx` with:

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

it("uses the inverted slate background (regression guard for the boldness pass)", () => {
  const { container } = render(<ReceiptsBand />);
  const section = container.querySelector("section#receipts");
  expect(section).toBeInTheDocument();
  expect(section?.className).toContain("bg-text-primary");
  expect(section?.className).toContain("text-bg-page");
});
```

- [ ] **Step 4.2: Run, confirm the new assertion fails**

```bash
pnpm --filter @pretable/app-website test -- ReceiptsBand
```

Expected: FAIL — `bg-text-primary` not in className yet.

- [ ] **Step 4.3: Update `ReceiptsBand.tsx` — class swaps for the inverted band**

Replace the file with:

```tsx
interface Stat {
  value: string;
  caption: string;
  /** First stat anchors with accent color (warm orange) on the dark band. */
  accent?: boolean;
}

// Receipts snapshot — numbers from two committed milestone runsets:
//
//   status/milestones/2026-05-01-h1-satisfied.hypotheses.json
//     S2/scroll/hypothesis × 5 repeats, unified row-height formula. H1
//     satisfied. Pretable median 16ms vs Grid Alpha 67ms = 4× faster.
//
//   status/milestones/2026-05-01-streaming-revalidated.hypotheses.json
//     S5/updates × 6 rates × 3 repeats. H15 satisfied.
//
// Bucket C: section flipped to an inverted slate band. The first stat
// (4×) anchors with accent (warm orange); the rest are cream on slate.
const STATS: readonly Stat[] = [
  { value: "4×", caption: "faster scroll vs gridalpha", accent: true },
  { value: "16ms", caption: "frame p95 / wrapped scroll" },
  { value: "0", caption: "long tasks / streaming" },
  { value: "25k/s", caption: "max sustained update rate" },
];

export function ReceiptsBand() {
  return (
    <section
      id="receipts"
      className="bg-text-primary text-bg-page border-b border-rule px-7 py-[64px] md:px-10 md:py-[80px]"
    >
      <div className="mx-auto max-w-[1240px]">
        <h2 className="font-display text-[28px] leading-[1.12] tracking-[-0.02em] md:text-[36px]">
          <em className="italic text-accent">Receipts</em>, not claims.
        </h2>
        <ul className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4 md:gap-8">
          {STATS.map((stat) => (
            <li key={stat.caption} className="border-t-2 border-accent pt-4">
              <div
                className={[
                  "font-display text-[44px] leading-[0.95] tracking-[-0.02em] md:text-[56px]",
                  stat.accent ? "text-accent" : "text-bg-page",
                ].join(" ")}
              >
                {stat.value}
              </div>
              <div className="mt-2 font-mono text-[12px] text-text-secondary">
                {stat.caption}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-8 font-mono text-[12px]">
          <a
            href="/bench"
            className="text-accent underline-offset-2 hover:underline"
          >
            See them re-run in the bench →
          </a>
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4.4: Run the suite, confirm green**

```bash
pnpm --filter @pretable/app-website test -- ReceiptsBand
```

Expected: PASS, 4/4.

- [ ] **Step 4.5: Commit**

```bash
git add apps/website/app/components/ReceiptsBand.tsx apps/website/__tests__/components/ReceiptsBand.test.tsx
git commit -m "feat(website): ReceiptsBand — invert to slate band with bigger numbers"
```

---

### Task 5: CodeTabs client component — TDD

**Files:**

- Create: `apps/website/app/components/CodeTabs.tsx`
- Create: `apps/website/__tests__/components/CodeTabs.test.tsx`

- [ ] **Step 5.1: Write the failing test**

```tsx
// apps/website/__tests__/components/CodeTabs.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CodeTabs, type CodeTabsPanel } from "../../app/components/CodeTabs";

const panels: readonly CodeTabsPanel[] = [
  { filename: "a.tsx", lang: "tsx", html: <div data-testid="panel-a">A</div> },
  { filename: "b.ts", lang: "ts", html: <div data-testid="panel-b">B</div> },
  { filename: "c.ts", lang: "ts", html: <div data-testid="panel-c">C</div> },
  { filename: "d.tsx", lang: "tsx", html: <div data-testid="panel-d">D</div> },
];

describe("CodeTabs", () => {
  afterEach(() => cleanup());

  it("renders a tablist with one button per panel", () => {
    render(<CodeTabs panels={panels} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });

  it("shows only the first panel by default", () => {
    render(<CodeTabs panels={panels} />);
    expect(screen.getByTestId("panel-a")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-b")).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel-c")).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel-d")).not.toBeInTheDocument();
  });

  it("respects defaultIndex", () => {
    render(<CodeTabs panels={panels} defaultIndex={2} />);
    expect(screen.getByTestId("panel-c")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-a")).not.toBeInTheDocument();
  });

  it("switches panels on tab click", () => {
    render(<CodeTabs panels={panels} />);
    fireEvent.click(screen.getByRole("tab", { name: /b\.ts/ }));
    expect(screen.getByTestId("panel-b")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-a")).not.toBeInTheDocument();
  });

  it("cycles activeIndex with arrow keys", () => {
    render(<CodeTabs panels={panels} />);
    const tablist = screen.getByRole("tablist");
    const firstTab = screen.getByRole("tab", { name: /a\.tsx/ });
    firstTab.focus();
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByTestId("panel-b")).toBeInTheDocument();
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByTestId("panel-a")).toBeInTheDocument();
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByTestId("panel-d")).toBeInTheDocument();
  });

  it("marks the active tab with aria-selected=true", () => {
    render(<CodeTabs panels={panels} defaultIndex={1} />);
    const active = screen.getByRole("tab", { name: /b\.ts/ });
    const inactive = screen.getByRole("tab", { name: /a\.tsx/ });
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(inactive).toHaveAttribute("aria-selected", "false");
  });
});
```

- [ ] **Step 5.2: Run, confirm fails**

```bash
pnpm --filter @pretable/app-website test -- CodeTabs
```

Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement CodeTabs**

```tsx
// apps/website/app/components/CodeTabs.tsx
"use client";

import { useId, useRef, useState, type ReactNode } from "react";

export interface CodeTabsPanel {
  filename: string;
  lang: "ts" | "tsx";
  html: ReactNode;
}

export interface CodeTabsProps {
  panels: readonly CodeTabsPanel[];
  defaultIndex?: number;
}

export function CodeTabs({ panels, defaultIndex = 0 }: CodeTabsProps) {
  const baseId = useId();
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = (activeIndex + delta + panels.length) % panels.length;
    setActiveIndex(next);
    const tabs =
      listRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    tabs?.[next]?.focus();
  };

  const active = panels[activeIndex];

  return (
    <div className="overflow-hidden rounded-[6px] border border-grid-rule bg-grid-bg">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Code example files"
        onKeyDown={onKeyDown}
        className="flex flex-row items-stretch gap-0 overflow-x-auto border-b border-grid-rule bg-text-primary"
      >
        {panels.map((panel, i) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={panel.filename}
              type="button"
              role="tab"
              id={`${baseId}-tab-${i}`}
              aria-selected={isActive}
              aria-controls={`${baseId}-panel-${i}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveIndex(i)}
              className={[
                "inline-flex shrink-0 cursor-pointer items-center gap-2 px-4 py-2.5 font-mono text-[12px] transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page",
                isActive
                  ? "border-b-2 border-bg-page text-bg-page"
                  : "border-b-2 border-transparent text-text-muted hover:text-bg-page",
              ].join(" ")}
            >
              <span
                aria-hidden="true"
                className={[
                  "rounded-[2px] px-1 py-0.5 text-[9px] font-bold tracking-[0.05em]",
                  panel.lang === "tsx"
                    ? "bg-accent/15 text-accent"
                    : "bg-bg-page/15 text-bg-page",
                ].join(" ")}
              >
                {panel.lang.toUpperCase()}
              </span>
              {panel.filename}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${activeIndex}`}
        aria-labelledby={`${baseId}-tab-${activeIndex}`}
      >
        {active.html}
      </div>
    </div>
  );
}
```

- [ ] **Step 5.4: Run, confirm passes**

```bash
pnpm --filter @pretable/app-website test -- CodeTabs
```

Expected: PASS, 6/6.

- [ ] **Step 5.5: Commit**

```bash
git add apps/website/app/components/CodeTabs.tsx apps/website/__tests__/components/CodeTabs.test.tsx
git commit -m "feat(website): CodeTabs — VS-Code-style tabs with arrow-key nav"
```

---

### Task 6: Rewrite CodeExample to use TABS + CodeTabs

**Files:**

- Modify: `apps/website/app/components/CodeExample.tsx`
- Modify: `apps/website/__tests__/components/CodeExample.test.tsx`

- [ ] **Step 6.1: Update the test FIRST to assert the tab bar**

Replace `apps/website/__tests__/components/CodeExample.test.tsx` with:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { CodeExample } from "../../app/components/CodeExample";

afterEach(() => {
  cleanup();
});

it("renders a tablist with the four expected file tabs", async () => {
  const ui = await CodeExample();
  render(ui);
  expect(screen.getByRole("tablist")).toBeInTheDocument();
  for (const filename of [
    "chat-grid.tsx",
    "columns.ts",
    "openai-client.ts",
    "page.tsx",
  ]) {
    expect(
      screen.getByRole("tab", { name: new RegExp(filename) }),
    ).toBeInTheDocument();
  }
});

it("defaults to the chat-grid tab and renders highlighted code", async () => {
  const ui = await CodeExample();
  const { container } = render(ui);
  const active = container.querySelector('[role="tab"][aria-selected="true"]');
  expect(active?.textContent ?? "").toMatch(/chat-grid\.tsx/);
  expect(container.querySelector('[role="tabpanel"] pre')).toBeInTheDocument();
});
```

- [ ] **Step 6.2: Run, confirm new assertions fail**

```bash
pnpm --filter @pretable/app-website test -- CodeExample
```

Expected: FAIL — no tablist yet.

- [ ] **Step 6.3: Rewrite `CodeExample.tsx` to use TABS + `<CodeTabs>`**

Replace the file with:

```tsx
import { CodeBlock } from "./CodeBlock";
import { CodeTabs, type CodeTabsPanel } from "./CodeTabs";

interface TabSource {
  filename: string;
  lang: "ts" | "tsx";
  code: string;
}

const TABS: readonly TabSource[] = [
  {
    filename: "chat-grid.tsx",
    lang: "tsx",
    code: `"use client";
import { useEffect, useState } from "react";
import { connectElementStream } from "@pretable-internal/stream-adapter";
import { Pretable } from "@pretable/react";
import { columns, type ChatRow } from "./columns";
import { openai } from "./openai-client";

export function ChatGrid({ prompt }: { prompt: string }) {
  const [rows, setRows] = useState<ChatRow[]>([]);

  useEffect(() => {
    void (async () => {
      const stream = await openai.responses.stream({
        model: "gpt-5",
        input: prompt,
      });
      connectElementStream(stream, {
        onElement: (row) => setRows((r) => [...r, row]),
      });
    })();
  }, [prompt]);

  return <Pretable rows={rows} columns={columns} getRowId={(r) => r.id} />;
}`,
  },
  {
    filename: "columns.ts",
    lang: "ts",
    code: `import type { PretableColumn } from "@pretable/react";

export interface ChatRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens: number;
  latencyMs: number;
}

export const columns: PretableColumn<ChatRow>[] = [
  { id: "role",      header: "Role",     widthPx: 100 },
  { id: "content",   header: "Content",  widthPx: 480, wrap: true },
  { id: "tokens",    header: "Tokens",   widthPx: 80 },
  { id: "latencyMs", header: "Latency",  widthPx: 100 },
];`,
  },
  {
    filename: "openai-client.ts",
    lang: "ts",
    code: `import OpenAI from "openai";

export const openai = new OpenAI();`,
  },
  {
    filename: "page.tsx",
    lang: "tsx",
    code: `import { ChatGrid } from "./chat-grid";

export default function Page() {
  return <ChatGrid prompt="Summarize the last 10 incidents" />;
}`,
  },
];

// Pre-render each tab's code via shiki at module load. Mirrors the existing
// CodeExample pattern (top-level await on a static snippet).
const PANELS: CodeTabsPanel[] = await Promise.all(
  TABS.map(async (tab) => ({
    filename: tab.filename,
    lang: tab.lang,
    html: await CodeBlock({ code: tab.code, lang: tab.lang }),
  })),
);

export function CodeExample() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          05 · for engineers
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          For engineers: how it looks in your codebase.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Connect any token-streaming source — OpenAI Responses, Anthropic, or
          your own SSE — to a pretable grid. Selection survives every chunk.
        </p>

        <div className="mt-8">
          <CodeTabs panels={PANELS} />
        </div>

        <p className="mt-5 font-mono text-[12px] text-text-muted">
          Full example:{" "}
          <a
            href="https://github.com/cacheplane/pretable/tree/main/apps/streaming-demo"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            apps/streaming-demo
          </a>
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 6.4: Run, confirm green**

```bash
pnpm --filter @pretable/app-website test
```

Expected: ALL PASS.

- [ ] **Step 6.5: Commit**

```bash
git add apps/website/app/components/CodeExample.tsx apps/website/__tests__/components/CodeExample.test.tsx
git commit -m "feat(website): CodeExample — 4-tab VS-Code interface, fix Pretable typo"
```

---

### Task 7: Manual Chrome verification + push + PR + merge on green

**Files:** none (verification + ship).

- [ ] **Step 7.1: Run the full repo test suite once**

```bash
pnpm --filter @pretable/app-website test
```

Expected: ALL PASS, ≥ 90 tests (82 baseline + ~8 new across PipelineDiagram, CodeTabs, plus the HowItWorks/ReceiptsBand/CodeExample test additions).

- [ ] **Step 7.2: Boot the dev server**

```bash
pkill -f "next dev"; sleep 2
pnpm --filter @pretable/app-website dev > /tmp/website-dev-bucket-c.log 2>&1 &
sleep 10 && grep -E "Ready|Local:" /tmp/website-dev-bucket-c.log | tail -3
```

Expected: `✓ Ready` and `http://localhost:3000`.

- [ ] **Step 7.3: Verify via Assistant in Chrome MCP**

Navigate to `http://localhost:3000`, open the drawer (click the handle), then assert:

```js
({
  receipts: (() => {
    const r = document.querySelector("section#receipts");
    return {
      bgClass: r?.className.includes("bg-text-primary"),
      stat4xColor: getComputedStyle(r.querySelector("li:first-child > div"))
        .color,
    };
  })(),
  pipelineDiagram: !!document.querySelector('[data-testid="pipeline-diagram"]'),
  pipelineStages: [
    ...document.querySelectorAll(
      '[data-testid="pipeline-diagram"] li > div:first-child > span:nth-child(2)',
    ),
  ].map((el) => el.textContent),
  codeTabs: {
    tablist: !!document.querySelector(
      '[role="tablist"][aria-label="Code example files"]',
    ),
    tabCount: document.querySelectorAll('[role="tab"]').length,
    activeFilename: document
      .querySelector('[role="tab"][aria-selected="true"]')
      ?.textContent?.trim(),
  },
});
```

Expected:

- `receipts.bgClass: true`
- Stage list contains `Source`, `Engine`, `Viewport`, `Renderer`, `Frame`
- 4 tabs, active filename is `chat-grid.tsx` (with `TSX` prefix)

Click `columns.ts` tab and verify the active panel changes.

- [ ] **Step 7.4: Stop the dev server**

```bash
pkill -f "next dev"
```

- [ ] **Step 7.5: Push the branch**

```bash
git push -u origin feat/bucket-c-receipts-pipeline-codetabs
```

- [ ] **Step 7.6: Open the PR**

```bash
gh pr create --title "feat(website): bucket C — receipts inversion + pipeline diagram + code tabs" \
  --body "Implements docs/superpowers/specs/2026-05-03-website-bucket-c-visual-polish-design.md.

Three drawer-section visual passes:

1. ReceiptsBand inverts to a slate band — bg-text-primary, cream H2 + stats, accent on the 4× anchor stat, 2px accent top borders, 56px display numbers.
2. HowItWorks gains a PipelineDiagram above the layer cards (5 stages, 4 output-shape arrows: Row[] | Patch → Snapshot → RenderPlan → Element[]). Layer cards now share a unified neutral border; core-stage hint kept via dot+glow.
3. CodeExample becomes a 4-tab VS-Code-style interface (chat-grid.tsx / columns.ts / openai-client.ts / page.tsx) with arrow-key nav and full ARIA. Fixes the existing <PretableGrid> typo to <Pretable> in the chat-grid snippet.

Shared LAYERS module added at apps/website/app/components/howItWorksLayers.ts so the diagram and the cards consume one source.

No public package APIs touched. Tests grow from 82 to ~90."
```

- [ ] **Step 7.7: Watch CI**

```bash
gh pr checks <num> --watch --fail-fast
```

If `format` fails, run `pnpm exec prettier --write` on the affected files, commit `style: prettier --write`, push.

- [ ] **Step 7.8: Merge on green + verify production**

```bash
gh pr merge <num> --squash --delete-branch
```

Wait for the post-merge CI run on `main` to deploy via Vercel + Playwright smoke. Then verify pretable.ai with Chrome MCP:

- Drawer open → Receipts is the slate band (cream text, accent 4×).
- HowItWorks shows the pipeline diagram before the cards; all cards have the same neutral border.
- CodeExample has the 4 tabs; clicking columns.ts swaps panel.
- No console errors.

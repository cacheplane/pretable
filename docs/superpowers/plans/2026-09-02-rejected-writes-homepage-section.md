# Rejected-Writes Homepage Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Homepage section `10 · when the data goes bad` — a live streaming positions grid where the visitor corrupts a server page, sees the grid keep its last good rows with a consumer-built stale-data banner (driven by `onRejectedWriteChange`), and recovers via Refetch or auto-heal.

**Architecture:** Server-component section shell + `"use client"` showcase grid (the ScaleShowcase/ScaleGrid split), a deterministic data module, and a `streaming → diverged → streaming` state machine local to the grid component. Banner visibility is derived from the rejected-writes record, never separate state.

**Tech Stack:** Next.js app router, `@pretable/react` (`PretableSurface`, `onRejectedWriteChange`, `PretableRejectedWrites`), Tailwind (allowed in `apps/*`), vitest + @testing-library/react (jsdom), Playwright smoke.

**Spec:** `docs/superpowers/specs/2026-09-02-rejected-writes-homepage-section-design.md`. One recorded deviation: the component test uses REAL timers with injected `tickMs`/`healMs` props instead of fake timers — `PretableSurface` schedules internally, and fake timers coupling to its internals is exactly the flake class the sibling tests avoid (none use fake timers).

**Environment:**
- Node ^24.15.0 (`~/.nvm/versions/node/v24.19.0/bin` if the shell gives v22).
- Website tests: `cd apps/website && pnpm test` (vitest; pattern args pass through to vitest here). E2E: needs `next build` + `next start` + `--workers=1` locally — in this plan, e2e correctness is verified in CI by the required smoke check; run locally only if debugging.
- `pnpm format` at repo root before every commit. Commits end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Branch: create `blove/rejected-writes-homepage` from current `origin/main` (`git fetch origin main && git checkout -b blove/rejected-writes-homepage origin/main`) — the worktree's current branch already merged as #564.
- The homepage smoke e2e (`apps/website/e2e/smoke.spec.ts`) collects `console.error` only; the one-time production `rows-rejected` `console.warn` the demo triggers is expected and does not fail smoke.

**Files (whole plan):**
- Create: `apps/website/app/components/showcase/rejectedWritesData.ts`
- Create: `apps/website/app/components/showcase/RejectedWritesGrid.tsx`
- Create: `apps/website/app/components/RejectedWritesShowcase.tsx`
- Modify: `apps/website/app/page.tsx` (import + slot between `ColumnLayoutShowcase` and `CtaSection`)
- Test: `apps/website/app/components/__tests__/rejectedWritesData.test.ts`
- Test: `apps/website/app/components/__tests__/RejectedWritesGrid.test.tsx`
- Test: `apps/website/app/components/__tests__/RejectedWritesShowcase.test.tsx`
- Modify: `apps/website/e2e/smoke.spec.ts` (one new test after the existing showcase test at ~L671)

---

### Task 1: Data module

**Files:**
- Create: `apps/website/app/components/showcase/rejectedWritesData.ts`
- Test: `apps/website/app/components/__tests__/rejectedWritesData.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  POSITION_COUNT,
  cleanPage,
  corruptPage,
  makePositionColumns,
  priceFor,
} from "../showcase/rejectedWritesData";

describe("rejectedWritesData", () => {
  it("cleanPage is deterministic per tick, same id set, fresh array identity", () => {
    const a = cleanPage(3);
    const b = cleanPage(3);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect(a).toHaveLength(POSITION_COUNT);
    expect(new Set(a.map((row) => row.id)).size).toBe(POSITION_COUNT);
    expect(cleanPage(3).map((r) => r.id)).toEqual(cleanPage(4).map((r) => r.id));
  });

  it("prices drift between ticks — the fixture can distinguish tick N from N+1", () => {
    // If every price were tick-invariant, the component test's "grid still
    // shows the pre-corruption page" assertion would pass vacuously.
    expect(cleanPage(3).map((r) => r.price)).not.toEqual(
      cleanPage(4).map((r) => r.price),
    );
    expect(priceFor("AAPL", 3)).not.toBe(priceFor("AAPL", 4));
  });

  it("corruptPage carries a duplicate id, and the two variants duplicate different ids", () => {
    const v0 = corruptPage(5, 0);
    const v1 = corruptPage(5, 1);
    const dupOf = (rows: readonly { id: string }[]) => {
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.id)) return row.id;
        seen.add(row.id);
      }
      return undefined;
    };
    expect(dupOf(v0)).toBeDefined();
    expect(dupOf(v1)).toBeDefined();
    expect(dupOf(v0)).not.toBe(dupOf(v1));
  });

  it("columns cover the row fields", () => {
    const ids = makePositionColumns().map((column) => column.id);
    expect(ids).toEqual(
      expect.arrayContaining(["ticker", "qty", "price", "value"]),
    );
  });
});
```

- [ ] **Step 1.2: Run it, verify it fails**

Run: `cd apps/website && pnpm test -- rejectedWritesData`
Expected: FAIL — module does not exist.

- [ ] **Step 1.3: Implement `rejectedWritesData.ts`**

```ts
import type { PretableColumn } from "@pretable/react";

/**
 * Deterministic positions fixture for the rejected-writes showcase. Every
 * value is a pure function of (ticker, tick) so the component test can prove
 * "the grid still shows the pre-corruption page" against exact numbers —
 * a tick-invariant price would make that assertion vacuous.
 */
export interface Position extends Record<string, unknown> {
  id: string;
  ticker: string;
  qty: number;
  price: number;
}

const TICKERS = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOG", "META",
  "TSLA", "AVGO", "COST", "LLY", "JPM", "UNH",
] as const;

export const POSITION_COUNT = TICKERS.length;

const BASE_QTY = 250;

/** Deterministic drifting price: base per ticker + a tick-dependent wobble. */
export function priceFor(ticker: string, tick: number): number {
  let hash = 0;
  for (const ch of ticker) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  const base = 40 + (hash % 400);
  const wobble = Math.sin(tick * 0.7 + hash) * 4;
  return Math.round((base + wobble) * 100) / 100;
}

export function cleanPage(tick: number): Position[] {
  return TICKERS.map((ticker, index) => ({
    id: ticker,
    ticker,
    qty: BASE_QTY + index * 25,
    price: priceFor(ticker, tick),
  }));
}

/**
 * A clean page with one row's id overwritten by another's — the
 * `duplicate-row-id` fault. `variant` picks WHICH id is duplicated so a
 * second corruption produces a different fault detail (the demo's quiet
 * "nothing latches" beat).
 */
export function corruptPage(tick: number, variant: number): Position[] {
  const rows = cleanPage(tick);
  const source = variant % 2 === 0 ? 0 : 2;
  const target = source + 1;
  rows[target] = { ...rows[target]!, id: rows[source]!.id };
  return rows;
}

export function makePositionColumns(): PretableColumn<Position>[] {
  return [
    { id: "ticker", header: "Ticker", widthPx: 96, value: (row) => row.ticker },
    { id: "qty", header: "Qty", widthPx: 88, value: (row) => row.qty },
    {
      id: "price",
      header: "Price",
      widthPx: 104,
      value: (row) => row.price,
      format: ({ value }) => `$${(value as number).toFixed(2)}`,
    },
    {
      id: "value",
      header: "Value",
      widthPx: 120,
      value: (row) => Math.round(row.qty * row.price * 100) / 100,
      format: ({ value }) => `$${(value as number).toLocaleString("en-US")}`,
    },
  ];
}
```

If `PretableColumn`'s real field names differ (`value`/`format`/`widthPx`), crib the exact shape from `apps/website/app/components/showcase/scaleData.ts` — that file is the source of truth for column authoring here.

- [ ] **Step 1.4: Run to green**

Run: `cd apps/website && pnpm test -- rejectedWritesData`
Expected: 4 passed.

- [ ] **Step 1.5: Commit**

```bash
cd /path/to/worktree && pnpm format
git add apps/website/app/components/showcase/rejectedWritesData.ts apps/website/app/components/__tests__/rejectedWritesData.test.ts
git commit -m "feat(website): rejected-writes showcase data module"
```

---

### Task 2: `RejectedWritesGrid` component

**Files:**
- Create: `apps/website/app/components/showcase/RejectedWritesGrid.tsx`
- Test: `apps/website/app/components/__tests__/RejectedWritesGrid.test.tsx`

- [ ] **Step 2.1: Write the failing tests**

Reuse the `FiringIO` IntersectionObserver stub from `ScaleGrid.test.tsx` (copy it — it is 20 lines; the suites keep their own copies). REAL timers with tiny injected durations; every assertion through `waitFor`.

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RejectedWritesGrid } from "../showcase/RejectedWritesGrid";
import { priceFor } from "../showcase/rejectedWritesData";

// ... FiringIO class + beforeEach/afterEach IO swap, exactly as ScaleGrid.test.tsx ...

const FAST = { tickMs: 40, healMs: 300 } as const;

async function readTicks() {
  const sent = Number(screen.getByTestId("rw-sent-tick").textContent);
  const grid = Number(screen.getByTestId("rw-grid-tick").textContent);
  return { sent, grid };
}

describe("RejectedWritesGrid", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it("streams clean ticks with no banner, counters in lockstep", async () => {
    render(<RejectedWritesGrid {...FAST} />);
    await waitFor(async () => {
      const { sent, grid } = await readTicks();
      expect(sent).toBeGreaterThan(2); // ticks advanced
      expect(grid).toBe(sent);         // and every write landed
    });
    expect(screen.queryByTestId("rw-banner")).not.toBeInTheDocument();
  });

  it("corrupt → grid keeps the pre-corruption page, banner names the fault, counters split", async () => {
    const { container } = render(<RejectedWritesGrid {...FAST} />);
    await waitFor(async () => expect((await readTicks()).sent).toBeGreaterThan(1));
    await userEvent.click(screen.getByTestId("rw-corrupt"));
    const banner = await screen.findByTestId("rw-banner");
    expect(within(banner).getByText(/duplicate-row-id/)).toBeInTheDocument();
    const { sent, grid } = await readTicks();
    expect(sent).toBe(grid + 1); // the corrupt page was sent but never landed
    // The AAPL price cell still shows the LANDED tick's price, not the sent one.
    const landedPrice = `$${priceFor("AAPL", grid).toFixed(2)}`;
    expect(container.textContent).toContain(landedPrice);
    // And the stream is paused: sent does not advance while diverged.
    const sentBefore = sent;
    await new Promise((resolve) => setTimeout(resolve, FAST.tickMs * 4));
    expect((await readTicks()).sent).toBe(sentBefore);
  });

  it("Refetch recovers immediately: banner gone, counters re-converge, stream resumes", async () => {
    render(<RejectedWritesGrid {...FAST} />);
    await userEvent.click(screen.getByTestId("rw-corrupt"));
    await screen.findByTestId("rw-banner");
    await userEvent.click(screen.getByTestId("rw-refetch"));
    await waitFor(() =>
      expect(screen.queryByTestId("rw-banner")).not.toBeInTheDocument(),
    );
    await waitFor(async () => {
      const { sent, grid } = await readTicks();
      expect(grid).toBe(sent);
    });
    // Stream resumed.
    const { sent } = await readTicks();
    await waitFor(async () =>
      expect((await readTicks()).sent).toBeGreaterThan(sent),
    );
  });

  it("auto-heal recovers without a click", async () => {
    render(<RejectedWritesGrid {...FAST} />);
    await userEvent.click(screen.getByTestId("rw-corrupt"));
    await screen.findByTestId("rw-banner");
    await waitFor(
      () => expect(screen.queryByTestId("rw-banner")).not.toBeInTheDocument(),
      { timeout: FAST.healMs * 4 },
    );
  });

  it("a second corruption banners again — nothing latches", async () => {
    render(<RejectedWritesGrid {...FAST} />);
    await userEvent.click(screen.getByTestId("rw-corrupt"));
    const first = await screen.findByTestId("rw-banner");
    const firstText = first.textContent;
    await userEvent.click(screen.getByTestId("rw-refetch"));
    await waitFor(() =>
      expect(screen.queryByTestId("rw-banner")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByTestId("rw-corrupt"));
    const second = await screen.findByTestId("rw-banner");
    // Different duplicated id → different fault detail (the variant rotation).
    expect(second.textContent).not.toBe(firstText);
  });
});
```

- [ ] **Step 2.2: Run, verify failure**

Run: `cd apps/website && pnpm test -- RejectedWritesGrid`
Expected: FAIL — component does not exist.

- [ ] **Step 2.3: Implement `RejectedWritesGrid.tsx`**

```tsx
"use client";

import {
  PretableSurface,
  type PretableRejectedWrites,
} from "@pretable/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cleanPage,
  corruptPage,
  makePositionColumns,
  type Position,
} from "./rejectedWritesData";
import { useInView } from "./useInView";

const VIEWPORT_HEIGHT = 360;

export function RejectedWritesGrid(props: {
  tickMs?: number;
  healMs?: number;
}) {
  const [mountRef, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={mountRef} className="w-full">
      {inView ? (
        <RejectedWritesGridLive
          tickMs={props.tickMs ?? 1500}
          healMs={props.healMs ?? 6000}
        />
      ) : (
        <div
          aria-hidden
          style={{ height: VIEWPORT_HEIGHT + 96 }}
          className="w-full rounded-[8px] border border-rule bg-bg-card"
        />
      )}
    </div>
  );
}

function RejectedWritesGridLive({
  tickMs,
  healMs,
}: {
  tickMs: number;
  healMs: number;
}) {
  const columns = useMemo(() => makePositionColumns(), []);
  const [positions, setPositions] = useState<readonly Position[]>(() =>
    cleanPage(1),
  );
  const [sentTick, setSentTick] = useState(1);
  const [rejected, setRejected] = useState<PretableRejectedWrites | null>(
    null,
  );
  /*
   * The tick the grid actually shows while diverged — captured when the rows
   * slot transitions to non-null. While IN SYNC the status line shows
   * `sentTick` because the record says the last sent write landed; this ref
   * only bridges the diverged window, when `sentTick` names a page the model
   * refused. The record, not this ref, decides which branch renders.
   */
  const divergedFromTick = useRef(1);
  const corruptArmed = useRef(false);
  const corruptVariant = useRef(0);
  const healTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const diverged = rejected?.rows != null;

  /* The stream: one clean page per tick, paused while diverged. */
  useEffect(() => {
    if (diverged) return;
    const interval = setInterval(() => {
      setSentTick((tick) => {
        const next = tick + 1;
        if (corruptArmed.current) {
          corruptArmed.current = false;
          divergedFromTick.current = tick;
          setPositions(corruptPage(next, corruptVariant.current));
          corruptVariant.current += 1;
        } else {
          setPositions(cleanPage(next));
        }
        return next;
      });
    }, tickMs);
    return () => clearInterval(interval);
  }, [diverged, tickMs]);

  /* Auto-heal: a diverged section resets itself for the next visitor. */
  useEffect(() => {
    if (!diverged) return;
    healTimer.current = setTimeout(() => refetchRef.current(), healMs);
    return () => {
      if (healTimer.current !== null) clearTimeout(healTimer.current);
    };
  }, [diverged, healMs]);

  const refetch = () => {
    setSentTick((tick) => {
      const next = tick + 1;
      setPositions(cleanPage(next));
      return next;
    });
  };
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  const corrupt = () => {
    if (diverged) return;
    corruptArmed.current = true;
  };

  const gridTick = diverged ? divergedFromTick.current : sentTick;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="font-mono text-[13px] text-text-secondary" data-testid="rw-status">
          server sent tick{" "}
          <strong className="text-text-primary" data-testid="rw-sent-tick">
            {sentTick}
          </strong>{" "}
          · grid shows tick{" "}
          <strong
            className={diverged ? "text-warning" : "text-accent"}
            data-testid="rw-grid-tick"
          >
            {gridTick}
          </strong>
        </p>
        <button
          type="button"
          data-testid="rw-corrupt"
          onClick={corrupt}
          disabled={diverged}
          className="rounded-[6px] border border-rule px-3 py-1.5 font-mono text-[12px] text-text-secondary hover:text-text-primary disabled:opacity-40"
        >
          corrupt the next server page
        </button>
      </div>
      {rejected?.rows ? (
        <div
          role="status"
          data-testid="rw-banner"
          className="mb-3 flex items-center justify-between gap-4 rounded-[6px] border border-warning/40 bg-warning/10 px-4 py-2.5"
        >
          <p className="font-mono text-[12px] text-text-primary">
            <strong>{rejected.rows.code}</strong> — the grid kept tick{" "}
            {gridTick}; the rows on screen no longer match the last page sent.
          </p>
          <button
            type="button"
            data-testid="rw-refetch"
            onClick={refetch}
            className="shrink-0 rounded-[6px] bg-accent px-3 py-1.5 font-mono text-[12px] text-bg-page"
          >
            Refetch positions
          </button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[8px] border border-rule">
        <PretableSurface
          ariaLabel="Streaming portfolio positions"
          columns={columns}
          getRowId={(row) => row.id}
          rows={positions}
          viewportHeight={VIEWPORT_HEIGHT}
          onRejectedWriteChange={setRejected}
        />
      </div>
    </div>
  );
}
```

Notes for the implementer:
- The corrupt click ARMS the next tick rather than sending out-of-band; to keep the click feel immediate is NOT required (tests wait via `waitFor`). Do not add an immediate-send path the spec doesn't ask for.
- Setting state from inside the `setSentTick` updater (`setPositions`) is batched by React 18 — both land in one commit, which is what makes the corrupt page and its tick number atomic. If the react-hooks lint objects to the nested set, restructure to a single `useState` holding `{tick, rows}` — one state object updated atomically is the cleaner shape anyway; keep the testids and behavior identical.
- If `text-warning`/`bg-warning` tokens don't exist in the site's Tailwind theme, check `apps/website/tailwind.config.*` for the real warning/amber token and use that; do not invent a palette.
- The `refetchRef` dance exists because the heal effect must call the latest `refetch` without re-arming on every render; if the repo's lint rejects it, `useEffectEvent`-style patterns used elsewhere in `apps/website` take precedence — search before inventing.

- [ ] **Step 2.4: Run to green**

Run: `cd apps/website && pnpm test -- RejectedWritesGrid`
Expected: 5 passed. Re-run once to shake out timing flakes; if a test is timing-flaky twice, widen its `waitFor` timeout rather than its assertions.

- [ ] **Step 2.5: Mutation checks (perform, verify, revert)**

1. Change the banner conditional from `rejected?.rows ?` to a local `useState(true)`-style constant `true ?` → the "streams clean ticks with no banner" test must FAIL (pins record-driven visibility).
2. Delete the `if (diverged) return;` guard in the stream effect → the "counters split / stream paused" assertion must FAIL.
3. In `corrupt()`, drop `divergedFromTick.current = tick` (leave it 1) → the landed-price assertion must FAIL on any run where corruption happens after tick 1 (the test guarantees `sent > 1` first).

Revert all three; re-run green.

- [ ] **Step 2.6: Commit**

```bash
pnpm format
git add apps/website/app/components/showcase/RejectedWritesGrid.tsx apps/website/app/components/__tests__/RejectedWritesGrid.test.tsx
git commit -m "feat(website): rejected-writes showcase grid with fault injection"
```

---

### Task 3: Section shell + page wiring

**Files:**
- Create: `apps/website/app/components/RejectedWritesShowcase.tsx`
- Modify: `apps/website/app/page.tsx`
- Test: `apps/website/app/components/__tests__/RejectedWritesShowcase.test.tsx`

- [ ] **Step 3.1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RejectedWritesShowcase } from "../RejectedWritesShowcase";

// The grid child needs the IO stub; stub the whole grid instead — the shell
// test is about the section, and the grid has its own suite.
vi.mock("../showcase/RejectedWritesGrid", () => ({
  RejectedWritesGrid: () => <div data-testid="rw-grid-stub" />,
}));

describe("RejectedWritesShowcase", () => {
  it("renders the numbered eyebrow, headline, and the grid", () => {
    render(<RejectedWritesShowcase />);
    expect(screen.getByText("10 · when the data goes bad")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /shouldn't blank your grid/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rw-grid-stub")).toBeInTheDocument();
    expect(document.querySelector("#rejected-writes")).not.toBeNull();
  });

  it("the code strip teaches the real wiring — onRejectedWriteChange is on the page", () => {
    render(<RejectedWritesShowcase />);
    // Drift guard: the strip's key line must not silently vanish (the docs
    // guard cannot see homepage components).
    expect(
      screen.getByTestId("rw-code-strip").textContent,
    ).toContain("onRejectedWriteChange");
    expect(screen.getByTestId("rw-code-strip").textContent).toContain(
      "rejected?.rows",
    );
  });
});
```

- [ ] **Step 3.2: Run, verify failure**

Run: `cd apps/website && pnpm test -- RejectedWritesShowcase`
Expected: FAIL — component does not exist.

- [ ] **Step 3.3: Implement the shell**

```tsx
import { RejectedWritesGrid } from "./showcase/RejectedWritesGrid";

const CODE_STRIP = `<StaleBanner fault={rejected?.rows} onRetry={refetch} />
<PretableSurface
  rows={positions}
  onRejectedWriteChange={setRejected}
  …
/>`;

export function RejectedWritesShowcase() {
  return (
    <section
      id="rejected-writes"
      className="text-text-primary px-7 py-16 md:px-10 md:py-28"
    >
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          10 · when the data goes bad
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          A bad server page shouldn&apos;t blank your grid.{" "}
          <em className="italic text-accent">Or lie to you.</em>
        </h2>
        <p className="mt-5 max-w-[64ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          One malformed row used to unmount the whole grid subtree. Now an
          invalid update is a rejected write: the grid keeps the last good
          rows, stays interactive, and tells your code through{" "}
          <code className="font-mono text-[15px]">onRejectedWriteChange</code>.
          The banner below is ours, not pretable&apos;s — built on that
          callback in a few lines. Corrupt a page and watch nothing break.
        </p>
        <div className="mt-10">
          <RejectedWritesGrid />
        </div>
        <pre
          data-testid="rw-code-strip"
          className="mt-6 overflow-x-auto rounded-[8px] border border-rule bg-bg-card p-4 font-mono text-[13px] leading-[1.6] text-text-secondary"
        >
          <code>{CODE_STRIP}</code>
        </pre>
      </div>
    </section>
  );
}
```

Match the exact eyebrow/heading/prose classes against `ScaleShowcase.tsx` in the tree (source of truth if the classes above have drifted). If the site has a shared code-block component used on the homepage (`CodeBlock.tsx` / `CodeExample.tsx` — check how `CodeExample` renders code), prefer it over the raw `<pre>` IF it works in a server component without props ceremony; keep the `rw-code-strip` testid either way.

- [ ] **Step 3.4: Wire into `page.tsx`**

Add the import alphabetically and slot between `ColumnLayoutShowcase` and `CtaSection`:

```tsx
import { RejectedWritesShowcase } from "./components/RejectedWritesShowcase";
// ...
        <ScrollReveal>
          <ColumnLayoutShowcase />
        </ScrollReveal>
        <ScrollReveal>
          <RejectedWritesShowcase />
        </ScrollReveal>
        <ScrollReveal>
          <CtaSection />
        </ScrollReveal>
```

Check `DrawerNavSlot.tsx` / any section nav registry: if homepage sections are enumerated for in-page nav (search for `#scale` or `#columns` anchors), register `#rejected-writes` with the label `when the data goes bad`; if no registry exists, nothing to do.

- [ ] **Step 3.5: Run the full website unit suite**

Run: `cd apps/website && pnpm test`
Expected: all green (was 104 files / 613 tests before this branch; now +3 files). Any docs-guard failure here is unexpected — homepage components are outside its reach; investigate rather than suppress.

- [ ] **Step 3.6: Commit**

```bash
pnpm format
git add apps/website/app/components/RejectedWritesShowcase.tsx apps/website/app/page.tsx apps/website/app/components/__tests__/RejectedWritesShowcase.test.tsx
git commit -m "feat(website): homepage section 10 — when the data goes bad"
```

---

### Task 4: Smoke e2e

**Files:**
- Modify: `apps/website/e2e/smoke.spec.ts` (add one test after the existing showcase test at ~L671)

- [ ] **Step 4.1: Write the test**

Crib navigation/hydration patterns from the existing `"showcase: scale grid virtualizes; column layout resizes + resets"` test in the same file (~L671) — it is the template for scrolling a drawer section into view and waiting for a lazy grid. Gate interaction on `data-pretable-hydrated` (SSR'd controls are inert before it).

```ts
test("showcase: rejected write keeps the grid and banners; refetch recovers", async ({
  page,
}) => {
  // Same drawer-open + scroll approach as the scale showcase test above.
  await page.goto("/");
  await page.locator("[data-testid='drawer-handle']").click();
  await page.locator("#rejected-writes").scrollIntoViewIfNeeded();

  const grid = page.getByRole("grid", { name: /portfolio positions/i });
  await expect(grid).toBeVisible();
  await expect(grid).toHaveAttribute("data-pretable-hydrated", "true");

  // Baseline: streaming, no banner, counters converge.
  await expect(page.getByTestId("rw-banner")).toHaveCount(0);

  const rowCount = await page.locator("[data-pretable-row]").count();
  await page.getByTestId("rw-corrupt").click();

  // Banner appears (next tick ≤1.5s), grid keeps its rows.
  const banner = page.getByTestId("rw-banner");
  await expect(banner).toBeVisible({ timeout: 5_000 });
  await expect(banner).toContainText("duplicate-row-id");
  await expect(page.locator("[data-pretable-row]")).toHaveCount(rowCount);

  // Counters split.
  const sent = Number(await page.getByTestId("rw-sent-tick").textContent());
  const shown = Number(await page.getByTestId("rw-grid-tick").textContent());
  expect(sent).toBe(shown + 1);

  // Refetch recovers.
  await page.getByTestId("rw-refetch").click();
  await expect(banner).toHaveCount(0);
});
```

Adapt selectors to what the sibling test actually uses (e.g. if it scopes `[data-pretable-row]` to the section, do the same — the page has several grids; scope row counts to `#rejected-writes` with `page.locator("#rejected-writes [data-pretable-row]")`). The hydration-attribute check: confirm the attribute name and element (`data-pretable-hydrated`) by grepping the e2e helpers/specs; use the established helper if one exists in `e2e/helpers.ts`.

- [ ] **Step 4.2: Verify locally IF the environment allows**

Local e2e needs `next build` + `next start` + `--workers=1` and is load-sensitive; a full local run is OPTIONAL. Minimum bar before commit: `cd apps/website && pnpm exec playwright test e2e/smoke.spec.ts --workers=1 -g "rejected write"` against a locally built server (`pnpm build && pnpm start` in another shell). If the environment can't sustain it, commit and let the required CI smoke check adjudicate — but say so in the task report; never claim an unrun test passed.

- [ ] **Step 4.3: Commit**

```bash
pnpm format
git add apps/website/e2e/smoke.spec.ts
git commit -m "test(website): smoke the rejected-writes showcase"
```

---

### Task 5: Gates + PR

- [ ] **Step 5.1: Full local gates**

```bash
pnpm build
cd apps/website && pnpm test
cd ../.. && pnpm format
```

Expected: all green; format a no-op. (`react.api.md` untouched — this branch adds no package exports; `git status` must show no `packages/` changes.)

- [ ] **Step 5.2: Drift check**

```bash
git fetch origin main && git log HEAD..origin/main --oneline
```

Rebase if anything landed (parallel sessions are routine here); re-run Step 5.1 after a rebase.

- [ ] **Step 5.3: PR**

Push `blove/rejected-writes-homepage`, open a PR against `main` titled `feat(website): homepage section — when the data goes bad`, body: what the section demos (visitor-triggered `duplicate-row-id` rejection, consumer-built banner on `onRejectedWriteChange`, refetch + auto-heal, tick-counter divergence line), link the spec, note the smoke coverage. End the body with:

`🤖 Generated with [Claude Code](https://claude.com/claude-code)`

Enable auto-merge (squash) only after confirming the required checks list is unchanged; verify final merge state with `gh pr view` before reporting it anywhere.

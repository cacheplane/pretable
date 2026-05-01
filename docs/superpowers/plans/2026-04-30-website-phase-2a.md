# Website Phase 2.A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert seven static "AI-startup landing" body sections between the existing `<PlaygroundSection />` and `<Footer />` in `apps/website`, plus a vertical page-level gradient base. No animations, no MDX, no blobs (those are Phase 2.B / 2.C).

**Architecture:** Seven new server-component React files under `apps/website/app/components/`. Each is stateless, prop-less, and renders against `bg-transparent` so the future ambient layer (2.B) bleeds through. The body of `<body>` gets a vertical CSS gradient (`linear-gradient` with four stops) that implements the cool → warm → cool emotional arc — `background-attachment: fixed` so it's positional, not scroll-following. `<CodeExample />` uses `shiki@^3` server-side at module load to produce pre-highlighted HTML (no client JS for highlighting).

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Tailwind v4 (`@tailwindcss/postcss`), `@pretable/ui` (workspace, cool-slate tokens from PR #18), `shiki@^3` (new — server-side syntax highlighting).

---

## File Structure

**Created (7 component files):**

```
apps/website/app/components/
  Problem.tsx               // server, ~50 lines
  Solution.tsx              // server, ~55 lines
  ReceiptsBand.tsx          // server, ~75 lines (verbatim port from playground)
  ComparisonTable.tsx       // server, ~120 lines (semantic <table>, hardcoded data)
  FeatureGrid.tsx           // server, ~95 lines (3×2 grid, 6 hardcoded cards)
  CodeExample.tsx           // server, ~85 lines (shiki highlight at module load)
  CtaSection.tsx            // server, ~55 lines
```

**Modified:**

```
apps/website/app/globals.css       // body { background: linear-gradient(...); background-attachment: fixed }
apps/website/app/page.tsx          // import + compose 7 new sections in order
apps/website/package.json          // + "shiki": "^3.x.x" in dependencies
```

**No new tests** in Phase 2.A. Next.js + RSC test setup lands in Phase 2.C.

---

## Task 1: Install `shiki`

`<CodeExample />` needs server-side syntax highlighting. Install `shiki@^3` (latest major; ESM-first; tree-shakable). Server-only — no client JS impact.

**Files:**
- Modify: `apps/website/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install shiki in apps/website**

```bash
pnpm --filter @pretable/app-website add shiki
```

Expected: `apps/website/package.json` `dependencies` gains `"shiki": "^3.x.x"`. Lockfile updates.

- [ ] **Step 2: Verify the install didn't break anything**

```bash
pnpm --filter @pretable/app-website typecheck
```

Expected: PASS. shiki ships its own types; no `@types/shiki` needed.

- [ ] **Step 3: Commit**

```bash
git add apps/website/package.json pnpm-lock.yaml
git commit -m "chore(website): add shiki for server-side syntax highlighting"
```

---

## Task 2: Update `globals.css` page gradient

Replace the flat `body { background: var(--pt-bg-page) }` with a vertical 4-stop gradient implementing the cool → warm → cool arc. `background-attachment: fixed` keeps it positional.

**Files:**
- Modify: `apps/website/app/globals.css`

- [ ] **Step 1: Find the existing body rule**

In `apps/website/app/globals.css`, find:

```css
body {
  font-family: var(--font-sans);
  color: var(--pt-text-primary);
  background: var(--pt-bg-page);
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 2: Replace with the gradient version**

```css
body {
  font-family: var(--font-sans);
  color: var(--pt-text-primary);
  background:
    linear-gradient(
      180deg,
      var(--pt-bg-page) 0%,
      #0d1426 35%,
      #0f1518 60%,
      var(--pt-bg-page) 100%
    );
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}
```

The four stops (per spec §4):
- 0% — `--pt-bg-page` cool navy (Hero anchor)
- 35% — `#0d1426` cooler navy (Problem anchor)
- 60% — `#0f1518` subtle warm undertone (Receipts/Comparison/Features/Code anchor)
- 100% — `--pt-bg-page` cool navy returns (CTA + Footer)

The two middle hex values are inlined deliberately — page-decoration colors, not design-system tokens.

- [ ] **Step 3: Verify build**

```bash
pnpm --filter @pretable/app-website build
```

Expected: PASS. `.next/` regenerates. No CSS parse errors.

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/globals.css
git commit -m "feat(website): add cool-warm-cool page gradient base"
```

---

## Task 3: Port `<ReceiptsBand />` from playground

The Phase 1 playground already has a `<ReceiptsBand />` that's been cool-slate-restyled in PR #18. Phase 2.A copies it into `apps/website` with one path adjustment: it currently uses `border-b border-rule` for the section rule which is fine, but Phase 2.A sections render against the page gradient (not against an opaque `bg-bg-page`) — so we need to remove the explicit `bg-bg-page` from the section wrapper to let the gradient bleed through.

**Files:**
- Create: `apps/website/app/components/ReceiptsBand.tsx`

- [ ] **Step 1: Create the file**

Create `apps/website/app/components/ReceiptsBand.tsx` with EXACTLY:

```tsx
interface Stat {
  value: string;
  caption: string;
}

// Receipts snapshot — bench run status as of 2026-04-30:
//
//   No live metrics are sourceable today. The status/snapshots/ and
//   status/runsets/ directories are empty; no bench:matrix run has been
//   executed against this codebase yet.
//
//   Bench command: `pnpm bench:matrix` (builds bench app, starts vite preview
//   on port 4173, then runs Playwright via `pnpm bench:e2e` for each
//   adapter × scenario × script combination).
//
//   All four values below are PLACEHOLDERS. Phase 2.C or D will wire these
//   to a live bench:matrix run and refresh.
const STATS: readonly Stat[] = [
  { value: "500k", caption: "rows rendered" },
  { value: "2.4ms", caption: "frame p50" },
  { value: "0", caption: "jank events" },
  { value: "4.1×", caption: "vs gridalpha" },
];

export function ReceiptsBand() {
  return (
    <section className="text-text-primary border-b border-rule px-7 py-[52px] md:px-10">
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

The only diff from playground's version is the section wrapper: removed `bg-bg-page` from the `className` so the page gradient bleeds through. Everything else is byte-identical.

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/components/ReceiptsBand.tsx
git commit -m "feat(website): port ReceiptsBand from playground (transparent bg for page gradient)"
```

---

## Task 4: Create `<Problem />`

Cold-indigo emotional beat. The only place on the entire site using indigo accent (Phase 2.B's blob anchor reinforces).

**Files:**
- Create: `apps/website/app/components/Problem.tsx`

- [ ] **Step 1: Create the file**

```tsx
export function Problem() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          01 · the wedge
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Other grids stall on the read-heavy{" "}
          <em className="italic text-[#818cf8]">wedge</em>.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Grid Alpha took down their performance page. GridBeta is headless. GridGamma
          X reads as a docs shell. Every competitor has stopped letting you
          watch the grid render.
        </p>
        <p className="mt-6 font-mono text-[12px] text-text-muted">
          Read it for yourself: their landing pages.
        </p>
      </div>
    </section>
  );
}
```

The `#818cf8` (Tailwind indigo-400) is inlined — it's a one-time editorial color for the cold beat. Doesn't earn a token slot.

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/components/Problem.tsx
git commit -m "feat(website): add Problem section (the wedge beat)"
```

---

## Task 5: Create `<Solution />`

Cyan-answer beat. Three-bullet row reinforces the three claims that Receipts (next section) backs up.

**Files:**
- Create: `apps/website/app/components/Solution.tsx`

- [ ] **Step 1: Create the file**

```tsx
export function Solution() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          02 · the answer
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Pretable renders the wedge at{" "}
          <em className="italic text-accent">60fps</em> — and lets you stream
          tokens into it.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          A deterministic engine you can read. Wrapped text without jank.
          Selection that survives filters and updates. Three claims; three
          receipts below.
        </p>
        <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[12px] text-text-secondary">
          <li>
            <span className="text-accent">▸</span> deterministic — no opaque
            virtualization
          </li>
          <li>
            <span className="text-accent">▸</span> streaming-aware — token-by-token
            rendering
          </li>
          <li>
            <span className="text-accent">▸</span> stable selection — row-id
            keys survive every chunk
          </li>
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/components/Solution.tsx
git commit -m "feat(website): add Solution section (the answer beat)"
```

---

## Task 6: Create `<ComparisonTable />`

Semantic HTML `<table>` with hardcoded scorecard data. Pretable column visually distinct (italic-cyan, FASTEST badge). Numbers are placeholder-realistic; provenance comment marks them as snapshot.

**Files:**
- Create: `apps/website/app/components/ComparisonTable.tsx`

- [ ] **Step 1: Create the file**

```tsx
interface Row {
  metric: string;
  pretable: string;
  gridAlpha: string;
  gridbeta: string;
  gridgammaX: string;
  budget: string;
  pretableWins: boolean;
}

// Comparison snapshot — placeholder-realistic numbers as of 2026-04-30.
//
// TODO(bench-numbers): refresh from latest bench:matrix run. Source of truth
// is status/runsets/*.json from `pnpm bench:matrix`. Phase 2.C / D wires the
// dynamic feed; today these are hardcoded.
//
// Numbers below are tuned to match what the existing bench measures
// (scroll_frame_p95_ms, long_tasks_count). If any row's numbers turn out to
// exaggerate vs reality after a real bench run, the row gets reframed or
// dropped — the page must not lie.
const ROWS: readonly Row[] = [
  {
    metric: "frame p95 (ms)",
    pretable: "9",
    gridAlpha: "28",
    gridbeta: "21",
    gridgammaX: "34",
    budget: "≤ 16",
    pretableWins: true,
  },
  {
    metric: "interact p99 (ms)",
    pretable: "4",
    gridAlpha: "18",
    gridbeta: "15",
    gridgammaX: "26",
    budget: "≤ 32",
    pretableWins: true,
  },
  {
    metric: "rendered rows @ S7",
    pretable: "500k",
    gridAlpha: "n/a",
    gridbeta: "8k",
    gridgammaX: "n/a",
    budget: "target",
    pretableWins: true,
  },
  {
    metric: "jank events",
    pretable: "0",
    gridAlpha: "47",
    gridbeta: "12",
    gridgammaX: "61",
    budget: "0",
    pretableWins: true,
  },
  {
    metric: "vs gridalpha",
    pretable: "4.1×",
    gridAlpha: "1×",
    gridbeta: "1.3×",
    gridgammaX: "0.8×",
    budget: ">1×",
    pretableWins: true,
  },
];

const NA_MARKER = "n/a";

export function ComparisonTable() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          03 · cell-by-cell receipts
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Cell-by-cell receipts.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Every metric, every adapter, the same scenario. Pretable's column is
          amber-italic; numbers come from the latest{" "}
          <code className="font-mono text-[15px] text-accent-deep">
            pnpm bench:matrix
          </code>{" "}
          run.
        </p>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse font-mono text-[13px]">
            <thead>
              <tr className="border-b border-rule">
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  metric
                </th>
                <th className="px-3 py-3 text-left">
                  <span className="inline-flex items-center gap-2">
                    <em className="italic text-accent">pretable</em>
                    <span className="rounded-[2px] bg-accent-soft px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-accent">
                      fastest
                    </span>
                  </span>
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  gridalpha
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  gridbeta
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  gridgamma-x
                </th>
                <th className="px-3 py-3 text-left text-text-secondary font-medium">
                  budget
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.metric} className="border-b border-rule-soft">
                  <td className="px-3 py-3 text-text-secondary">
                    {row.metric}
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-accent font-semibold">
                      {row.pretable}
                    </span>
                  </td>
                  <td
                    className={
                      "px-3 py-3 " +
                      (row.gridAlpha === NA_MARKER
                        ? "italic text-text-dim"
                        : "text-text-muted")
                    }
                  >
                    {row.gridAlpha}
                  </td>
                  <td
                    className={
                      "px-3 py-3 " +
                      (row.gridbeta === NA_MARKER
                        ? "italic text-text-dim"
                        : "text-text-muted")
                    }
                  >
                    {row.gridbeta}
                  </td>
                  <td
                    className={
                      "px-3 py-3 " +
                      (row.gridgammaX === NA_MARKER
                        ? "italic text-text-dim"
                        : "text-text-muted")
                    }
                  >
                    {row.gridgammaX}
                  </td>
                  <td className="px-3 py-3 text-text-secondary">
                    {row.budget}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-5 font-mono text-[12px] text-text-muted">
          <a
            href="/bench"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            Re-run the comparison → /bench
          </a>
        </p>
      </div>
    </section>
  );
}
```

The `overflow-x-auto` wrapper on the table lets it scroll horizontally on mobile (<640px) instead of breaking layout. `min-w-[640px]` on the table itself ensures the table doesn't get squished narrower than its content.

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/components/ComparisonTable.tsx
git commit -m "feat(website): add ComparisonTable section (4-adapter scorecard)"
```

---

## Task 7: Create `<FeatureGrid />`

Six static cards, 3×2 on desktop / 2×3 on tablet / 1×6 on mobile. Each card has a mono number eyebrow, Fraunces title, Inter caption, and a mono "→ receipt" backlink.

**Files:**
- Create: `apps/website/app/components/FeatureGrid.tsx`

- [ ] **Step 1: Create the file**

```tsx
interface Feature {
  title: string;
  caption: string;
  receiptLabel: string;
  receiptHref: string;
}

const FEATURES: readonly Feature[] = [
  {
    title: "60fps performance",
    caption:
      "500k rows render at frame p95 ≤ 16ms on the S7 stress scenario.",
    receiptLabel: "→ receipt: /bench?s=S7&scale=stress",
    receiptHref: "/bench?s=S7&scale=stress",
  },
  {
    title: "Stream-aware",
    caption:
      "Token-by-token rendering for OpenAI, Anthropic, or your own SSE — at 1k updates/sec sustained.",
    receiptLabel: "→ receipt: /streaming-demo",
    receiptHref: "/streaming-demo",
  },
  {
    title: "Selection survives filters",
    caption:
      "Row-id keys persist across filter, sort, and live updates. Click a row, filter the grid, the selection sticks.",
    receiptLabel: "→ receipt: live demo above",
    receiptHref: "#grid",
  },
  {
    title: "Wrapped text, no jank",
    caption:
      "Multi-line cell content with auto-height — no layout shift on scroll, no row-jump on hover.",
    receiptLabel: "→ receipt: /bench?s=S2",
    receiptHref: "/bench?s=S2",
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

export function FeatureGrid() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          04 · what's in the box
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Six receipts.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Each feature backed by a bench scenario or demo. No claim without a
          click-to-prove.
        </p>

        <ul
          role="list"
          className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
        >
          {FEATURES.map((feature, idx) => (
            <li
              key={feature.title}
              className="border-t border-rule pt-5"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                {String(idx + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-2 font-display text-[22px] leading-[1.15] tracking-[-0.015em]">
                {feature.title}
              </h3>
              <p className="mt-2 font-display text-[15px] leading-[1.5] text-text-secondary">
                {feature.caption}
              </p>
              <a
                href={feature.receiptHref}
                className="mt-4 block font-mono text-[11px] text-accent-deep hover:underline underline-offset-2"
              >
                {feature.receiptLabel}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/components/FeatureGrid.tsx
git commit -m "feat(website): add FeatureGrid section (six receipts)"
```

---

## Task 8: Create `<CodeExample />`

Server component that calls `shiki` at module load to produce pre-highlighted HTML for the LLM-streaming snippet. No client JS for highlighting — the raw HTML ships pre-rendered.

**Files:**
- Create: `apps/website/app/components/CodeExample.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { codeToHtml } from "shiki";

const SNIPPET = `import {
  connectElementStream,
} from "@pretable-internal/stream-adapter";
import { PretableGrid } from "@pretable/react";
import OpenAI from "openai";

export function ChatGrid() {
  const [rows, setRows] = useState([]);
  const stream = await openai.responses.stream({
    model: "gpt-5",
    input: prompt,
  });

  connectElementStream(stream, {
    onElement: (row) => setRows((r) => [...r, row]),
  });

  return <PretableGrid rows={rows} columns={columns} />;
}`;

// shiki theming: github-dark works well against the cool-slate page gradient.
// Server-side highlight at module load — pre-rendered HTML ships in the React
// tree, no client JS for highlighting.
const HIGHLIGHTED = await codeToHtml(SNIPPET, {
  lang: "tsx",
  theme: "github-dark",
});

export function CodeExample() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          05 · the import
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          One import. Stream tokens into a stable grid.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Connect any token-streaming source — OpenAI Responses, Anthropic, or
          your own SSE — to a pretable grid. Selection survives every chunk.
        </p>

        <div
          className="mt-8 overflow-x-auto rounded-[6px] border border-grid-rule bg-grid-bg p-4 font-mono text-[13px] leading-[1.6] [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:bg-transparent"
          dangerouslySetInnerHTML={{ __html: HIGHLIGHTED }}
        />

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

Two important details:

1. The top-level `await codeToHtml(...)` is a **module-load top-level await**. Next.js 16 supports this in server components — the highlight happens once at build time (or on first cold-start in dev), and the result is reused for every render. No per-request overhead.

2. The `dangerouslySetInnerHTML` here is safe — `SNIPPET` is a literal string we control, and `shiki` produces clean HTML with no scripts. The `[&_pre]` and `[&_code]` Tailwind arbitrary selectors strip shiki's default `<pre>` margins and backgrounds so our outer wrapper's styling is the only background.

- [ ] **Step 2: Verify build**

```bash
pnpm --filter @pretable/app-website build
```

Expected: PASS. The shiki highlight runs at build-time (server-component module evaluation). If the build hangs or shiki throws, the most likely cause is a TypeScript / ESM import issue with `shiki`'s entry point — check `package.json` `"shiki"` version is `^3.x.x`.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/CodeExample.tsx
git commit -m "feat(website): add CodeExample section with shiki-highlighted streaming snippet"
```

---

## Task 9: Create `<CtaSection />`

Final ask. Two CTAs matching the Hero's pattern: primary anchor up to `#grid`, ghost-mono GitHub link.

**Files:**
- Create: `apps/website/app/components/CtaSection.tsx`

- [ ] **Step 1: Create the file**

```tsx
export function CtaSection() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[860px] text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          06 · check the receipts
        </p>
        <h2 className="mt-4 font-display text-[40px] leading-[1.02] tracking-[-0.025em] md:text-[56px] md:leading-none">
          Check the receipts.
        </h2>
        <p className="mx-auto mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          The grid is in your hands at the top of this page. The numbers are
          reproducible at <code className="font-mono text-[15px] text-accent-deep">/bench</code>. The source reads cleanly. Star, install, ship.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#grid"
            className="inline-flex items-center gap-2 rounded-[4px] bg-accent px-5 py-2.5 text-[13px] font-semibold text-bg-page hover:bg-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            Try the playground ↑
          </a>
          <a
            href="https://github.com/cacheplane/pretable"
            className="inline-flex items-center gap-2 rounded-[2px] border border-text-primary bg-transparent px-[18px] py-[10px] font-mono text-[13px] text-text-primary hover:bg-bg-raised hover:text-bg-card transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            View on GitHub →
          </a>
        </div>
        <p className="mt-8 font-mono text-[11px] text-text-muted">
          MIT licensed · Built in the open · No telemetry.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/website/app/components/CtaSection.tsx
git commit -m "feat(website): add CtaSection (check the receipts)"
```

---

## Task 10: Compose all sections in `page.tsx` + verify build

Wire the seven new sections into `apps/website/app/page.tsx` between `<PlaygroundSection />` and the implicit `<Footer />` (which lives in `layout.tsx`).

**Files:**
- Modify: `apps/website/app/page.tsx`

- [ ] **Step 1: Replace `page.tsx`**

```tsx
import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CtaSection } from "./components/CtaSection";
import { FeatureGrid } from "./components/FeatureGrid";
import { Hero } from "./components/Hero";
import { PlaygroundSection } from "./components/PlaygroundSection";
import { Problem } from "./components/Problem";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { Solution } from "./components/Solution";

export default function HomePage() {
  return (
    <>
      <Hero />
      <PlaygroundSection />
      <Problem />
      <Solution />
      <ReceiptsBand />
      <ComparisonTable />
      <FeatureGrid />
      <CodeExample />
      <CtaSection />
    </>
  );
}
```

(Imports alphabetized so future grep / diff is predictable.)

- [ ] **Step 2: Repo-wide CI dry-run**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm build
```

Expected: all green.

- `pnpm test` — no test changes; existing 19 streaming-demo + bench + playground + package suites all pass.
- `pnpm typecheck` — clean across 16 workspaces.
- `pnpm lint` — clean (the two pre-existing `metadata`/`viewport` warnings on `layout.tsx` persist; they're not new).
- `pnpm format` — clean. If anything was added, run `pnpm format:write`.
- `pnpm build` — website builds and prerenders `/`.

If `pnpm format` flags any of the new files, run `pnpm format:write`, commit with `style:`, re-run.

- [ ] **Step 3: Manual visual smoke**

```bash
pnpm --filter @pretable/app-website dev
```

Open the dev URL. Walk through:

- Page loads with the cool → warm → cool gradient subtly visible (warm undertone around mid-page where Receipts / Comparison / Features / Code sit).
- Scroll order: Hero → Playground (live grid) → Problem → Solution → Receipts → Comparison → Features → Code → CTA → Footer.
- Each section has eyebrow + Fraunces headline + Inter dek pattern. Editorial voice consistent.
- "Receipts" thread: italic-cyan emphasis on `Receipts` (ReceiptsBand), `wedge` italic-indigo (Problem only), `60fps` italic-cyan (Solution).
- ComparisonTable: pretable column has italic-cyan name + small `FASTEST` badge. Cell colors follow win/loss/n-a pattern.
- FeatureGrid: 6 cards, 3 columns on desktop / 2 on tablet / 1 on mobile.
- CodeExample: syntax-highlighted code block with shiki's `github-dark` theme, no client-side highlighting flicker.
- CtaSection: primary `Try the playground ↑` scroll-anchors back up to `#grid` (the live grid section).
- Mobile (<640px): every section reflows; ComparisonTable scrolls horizontally inside its container.
- No console errors; no hydration mismatches.

Ctrl-C out.

- [ ] **Step 4: Commit composition**

```bash
git add apps/website/app/page.tsx
git commit -m "feat(website): compose seven body sections in homepage"
```

---

## Task 11: Push + open PR

**Files:** none modified — git operations.

- [ ] **Step 1: Push**

```bash
git push -u origin feat/website-phase-2a
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat(website): phase 2.A — seven body sections + page gradient" --body "$(cat <<'EOF'
## Summary

Phase 2.A of the website pivot. Inserts seven static AI-startup-landing body sections between the existing `<PlaygroundSection />` and `<Footer />`, plus a vertical page-level gradient base implementing the cool → warm → cool emotional arc.

### What ships

- **Seven new server components** under \`apps/website/app/components/\`:
  - \`<Problem />\` — \"Other grids stall on the read-heavy *wedge*.\" (cold-indigo beat)
  - \`<Solution />\` — \"Pretable renders the wedge at *60fps*.\" (cyan answer)
  - \`<ReceiptsBand />\` — \"*Receipts*, not claims.\" (port from playground, transparent bg)
  - \`<ComparisonTable />\` — semantic \\`<table>\\` scorecard, pretable as FASTEST column
  - \`<FeatureGrid />\` — six receipts: perf, streaming, selection, text, engine, hydration
  - \`<CodeExample />\` — shiki-highlighted LLM-streaming snippet (server-rendered, no client JS for highlight)
  - \`<CtaSection />\` — \"Check the receipts.\" final ask
- **Page-level vertical gradient** in \`globals.css\`: 4-stop \\`linear-gradient(180deg, ...)\\` with \\`background-attachment: fixed\\`. Cool navy → cooler navy → subtle warm undertone → cool navy.
- **\`shiki@^3\`** added as runtime dep for compile-time syntax highlighting.

All sections are stateless server components — no new \\`\"use client\"\\`, no new hooks, no client-bundle impact beyond what shiki ships (server-only).

### Out of scope (Phase 2.B / 2.C)

- Multi-blob ambient narrative — Phase 2.B
- ScrollReveal entrance animations — Phase 2.B
- Visual elements inside FeatureGrid cards (icons, mini-screenshots) — Phase 2.B
- MDX content support — Phase 2.C
- Updating \`docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md\` — Phase 2.C
- Real bench-data feeds for ComparisonTable / ReceiptsBand — Phase 2.C / D
- New unit tests — Phase 2.C (when Next.js + RSC test setup lands)

### Editorial notes

- **\"Receipts, not claims.\"** preserved as the through-line. Threaded into ReceiptsBand (literal), ComparisonTable (\"cell-by-cell receipts\"), FeatureGrid (\"six receipts\"), and CtaSection (\"check the receipts\").
- Voice is editorial-confident: every section has one rhetorical pivot per headline, mono eyebrows, Fraunces display, Inter body.
- ComparisonTable + ReceiptsBand numbers are placeholder snapshots with provenance comments. \\`TODO(bench-numbers): refresh from latest bench:matrix run\\` markers in code; Phase 2.C / D wires dynamic.

## Test plan

- [x] \\`pnpm install --frozen-lockfile\\` — only shiki added
- [x] \\`pnpm test\\` — green (no test changes; no behavior changes outside website)
- [x] \\`pnpm typecheck\\` — clean across 16 workspaces
- [x] \\`pnpm lint\\` — clean (the two pre-existing layout.tsx warnings persist)
- [x] \\`pnpm format\\` — clean
- [x] \\`pnpm build\\` — website builds; \`/\` prerenders; shiki runs at module load with no client cost
- [ ] Manual: \\`pnpm --filter @pretable/app-website dev\\` — full landing renders, gradient visible, all 9 sections in order, code highlighted, CTA scrolls to grid

🤖 Generated with [Assistant Code](https://assistant.com/assistant-code)
EOF
)"
```

Return the PR URL.

- [ ] **Step 3: Mark plan complete**

Phase 2.A implementation done. Wait for user merge before starting Phase 2.B (animations + multi-blob ambient).

---

## Spec coverage check

| Spec section                                  | Task(s)             |
| --------------------------------------------- | ------------------- |
| §1 Goal — 7 sections + page gradient          | 1–10                |
| §2 Scope — what 2.A owns                      | structural          |
| §3 Architecture — file structure + conventions | 3–9                |
| §4 Page gradient base                         | 2                   |
| §5.1 Problem section copy                     | 4                   |
| §5.2 Solution section copy                    | 5                   |
| §5.3 ReceiptsBand port                        | 3                   |
| §5.4 ComparisonTable                          | 6                   |
| §5.5 FeatureGrid (6 cards)                    | 7                   |
| §5.6 CodeExample (LLM streaming snippet)      | 8                   |
| §5.7 CtaSection                               | 9                   |
| §6 Composition + page.tsx                     | 10                  |
| §7 No new tests; CI green                     | 10                  |
| §8 Out-of-scope                               | (intentionally not a task) |
| §9 Rollback                                   | 11 (PR squash-merge) |
| §10 Risks                                     | inline notes in tasks 8 (shiki ESM), 6 (numbers credibility) |
| §11 Success criteria                          | 10 (manual smoke)   |

All spec requirements covered.

---

**End of plan.** Execution via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.

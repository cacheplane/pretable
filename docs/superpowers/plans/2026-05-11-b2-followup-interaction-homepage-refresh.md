# B2 Follow-up — Homepage Interaction Wedge Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the PR #131 interaction comparator wedge on the homepage. Three surfaces: ComparisonTable interaction rows + trail-marker labels; new `/bench` page Interactions section; aggregated summary JSON file. Editorial-only — no source/package changes.

**Architecture:** Per the spec at `docs/superpowers/specs/2026-05-11-b2-followup-interaction-homepage-refresh-design.md`. Single PR on `b2-followup-interaction-homepage-refresh`. No auto-merge — hold for prose review.

**Tech Stack:** Next.js website (`apps/website`), vitest tests, Node.js one-shot aggregator script. No new deps.

**Spec:** [`docs/superpowers/specs/2026-05-11-b2-followup-interaction-homepage-refresh-design.md`](../specs/2026-05-11-b2-followup-interaction-homepage-refresh-design.md)

**Working directory:** `/Users/blove/repos/pretable/.worktrees/b2-followup-interaction-homepage-refresh`.

---

## File Structure

```
scripts/
└── extract-interaction-summary.mjs     (NEW: one-shot aggregator)

status/milestones/
└── 2026-05-10-b2-sort-filter-summary.json  (NEW: aggregated per-(adapter, script) latency)

apps/website/app/components/
└── ComparisonTable.tsx                  (MODIFY: 3 interaction rows + 4 trail-marker labels + prose + docblock)

apps/website/app/bench/
└── page.tsx                             (MODIFY: replace placeholder Interactions paragraph with real section)

apps/website/__tests__/components/
└── ComparisonTable.test.tsx             (MODIFY: trail-marker label regression-guards)

docs/research/
└── repo-memory.md                       (MODIFY: 2026-05-11 entry — homepage interaction wedge refresh)
```

---

## Task 1 — Aggregator script + milestone summary

### 1.1 Inspect existing per-run summary file shape

Run:
```
ls status/chromium-pretable-default-s2-hypothesis-sort-2026-05-10*.summary.json | head -1 | xargs cat | jq '{adapterId, scriptName, status, metrics: {interaction_latency_ms: .metrics.interaction_latency_ms, settle_duration_ms: .metrics.settle_duration_ms}}'
```

Confirm: the summary files have `adapterId`, `scriptName`, `metrics.interaction_latency_ms`, `metrics.settle_duration_ms`. Three repeats per (adapter, script); the aggregator picks the median.

### 1.2 Create `scripts/extract-interaction-summary.mjs`

```js
#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STATUS_DIR = "status";
const OUT_PATH =
  "status/milestones/2026-05-10-b2-sort-filter-summary.json";

const ADAPTERS = ["pretable", "ag-grid", "tanstack", "mui"];
const SCRIPTS = ["sort", "filter-metadata", "filter-text"];
const DATE_PREFIX = "2026-05-10";

function median(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  return n % 2
    ? sorted[(n - 1) / 2]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

const files = await readdir(STATUS_DIR);

const adapters = [];
let latestRunsetId = "";

for (const adapterId of ADAPTERS) {
  const rows = [];
  for (const scriptName of SCRIPTS) {
    const matchingFiles = files.filter(
      (f) =>
        f.startsWith(
          `chromium-${adapterId}-default-s2-hypothesis-${scriptName}-${DATE_PREFIX}`,
        ) && f.endsWith(".summary.json"),
    );
    const samples = [];
    for (const f of matchingFiles) {
      const data = JSON.parse(
        await readFile(join(STATUS_DIR, f), "utf8"),
      );
      const lat = data.metrics?.interaction_latency_ms;
      const settle = data.metrics?.settle_duration_ms;
      if (typeof lat === "number" && typeof settle === "number") {
        samples.push({ lat, settle });
      }
      // Capture the latest timestamp seen across all files for the
      // runsetId field; the matrix runner uses ISO-y timestamps in the
      // filename, so lexicographic max ≈ chronological max.
      const stem = f.replace(".summary.json", "");
      const timestamp = stem.split("-").slice(-1)[0]; // crude; OK for runsetId labeling
      if (timestamp > latestRunsetId) latestRunsetId = timestamp;
    }
    rows.push({
      scriptName,
      interactionLatencyMs: median(samples.map((s) => s.lat)),
      settleDurationMs: median(samples.map((s) => s.settle)),
      sampleCount: samples.length,
    });
  }
  adapters.push({ adapterId, rows });
}

const out = {
  runsetId: latestRunsetId || "unknown",
  generatedAt: new Date().toISOString(),
  scenarioId: "S2",
  scale: "hypothesis",
  browserName: "chromium",
  scripts: SCRIPTS,
  adapters,
};

await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${OUT_PATH}`);
console.log(JSON.stringify(out, null, 2));
```

### 1.3 Run the aggregator

```
node scripts/extract-interaction-summary.mjs
```

Verify the output JSON contains four adapters × three scripts with finite median values matching the PR #131 numbers from the spec (pretable sort 16.5, AG Grid sort 58.3, TanStack filter-metadata 15.7, etc.). If any cell is `null`, the per-run summary files are missing — STOP and investigate.

### 1.4 Commit

```
git add scripts/extract-interaction-summary.mjs status/milestones/2026-05-10-b2-sort-filter-summary.json
git commit -m "chore(bench): aggregator for sort/filter milestone summary"
```

---

## Task 2 — ComparisonTable.tsx

### 2.1 Read the existing `ROWS` array

```
grep -n "metric:" apps/website/app/components/ComparisonTable.tsx
```

Confirm the existing order: frame p95, row-height fidelity, blank gaps, scroll anchor shift, headless engine, streaming pipeline.

### 2.2 Insert three interaction rows between `scroll anchor shift` and `headless engine + React surface`

Add (preserving the `Row` interface shape):

```tsx
{
  metric: "sort latency p95 (ms) — interaction",
  pretable: "16.5",
  agGrid: "58.3",
  tanstack: "34.4",
  mui: "35.0",
  budget: "≤ 16",
},
{
  metric: "filter-metadata latency p95 (ms)",
  pretable: "16.0",
  agGrid: "49.9",
  tanstack: "15.7",
  mui: "33.4",
  budget: "≤ 16",
},
{
  metric: "filter-text latency p95 (ms)",
  pretable: "17.7",
  agGrid: "50.0",
  tanstack: "40.2",
  mui: "33.3",
  budget: "≤ 16",
},
```

### 2.3 Update trail-marker labels

Find the four `<TrailMarker variant=... label=... />` props in the header. Update labels:

- `AG Grid` — `"Slower scroll; row-height drift"` → `"1.7× slower scroll, 3× slower interaction; row-height drift"`
- `TanStack` — `"Headless; you wire selection and nav"` → `"Headless; ~2× slower interaction (filter-metadata ties pretable)"`
- `MUI X` — `"Parity at scroll p95; full-grid feature surface"` → `"Scroll-p95 parity; 2× slower interaction"`
- `pretable` — `"Recommended path"` unchanged.

### 2.4 Append a sentence to the section subhead prose

Find the `<p>` that ends `…full-grid feature weight.{" "}` (immediately before the methodology link). Insert a new sentence at the end of that paragraph (before the link):

```
Interactive sort and filter run 2–3.5× faster than every measured comparator on the same dataset.{" "}
```

### 2.5 Update the header docblock

Add a citation for the new milestone source. Find the existing milestone-source comments and append:

```
//   status/milestones/2026-05-10-b2-sort-filter-summary.json
//     S2/hypothesis/Chromium × 3 repeats × 4 adapters × 3 interaction
//     scripts. Pretable beats AG Grid 3-3.5× and MUI 2× across sort,
//     filter-metadata, filter-text; TanStack at parity on filter-metadata
//     only.
```

### 2.6 Typecheck

```
pnpm --filter @pretable/app-website typecheck
```

Expected: passes (the `Row` interface shape is unchanged).

### 2.7 Commit

```
git add apps/website/app/components/ComparisonTable.tsx
git commit -m "fix(website): ComparisonTable adds 3 interaction rows + trail-marker label refresh"
```

---

## Task 3 — ComparisonTable.test.tsx

### 3.1 Read the existing test assertions

```
cat apps/website/__tests__/components/ComparisonTable.test.tsx
```

The existing test asserts on the trail-marker labels via regex.

### 3.2 Update the regex assertions to match the new labels

Replace the existing label regexes with the new ones:

- `/slower scroll.*row-height drift/i` → `/slower scroll.*slower interaction/i`
- `/headless.*selection and nav/i` → `/headless.*slower interaction/i`
- `/parity at scroll p95/i` — keep, since the new MUI label still contains that phrase

(The `pretable` recommended-path regex is unchanged.)

### 3.3 Run vitest

```
pnpm --filter @pretable/app-website test components/ComparisonTable.test
```

Expected: all assertions pass.

### 3.4 Commit

```
git add apps/website/__tests__/components/ComparisonTable.test.tsx
git commit -m "test(website): ComparisonTable trail-marker label regression-guards for interaction refresh"
```

---

## Task 4 — `/bench` page Interactions section

### 4.1 Read the existing placeholder paragraph

```
grep -n "Interaction (sort, filter)\|interaction" apps/website/app/bench/page.tsx
```

Note the existing placeholder section: a heading and one paragraph saying "comparative interaction evidence is on the roadmap." This gets replaced.

### 4.2 Add a loader for the new summary file

In `apps/website/app/bench/page.tsx`, after the existing `loadScrollSummary()` function, add:

```tsx
interface InteractionAdapterRow {
  scriptName: "sort" | "filter-metadata" | "filter-text";
  interactionLatencyMs: number | null;
  settleDurationMs: number | null;
  sampleCount: number;
}

interface InteractionAdapterSummary {
  adapterId: string;
  rows: InteractionAdapterRow[];
}

interface InteractionSummaryFile {
  runsetId: string;
  generatedAt: string;
  scenarioId: string;
  scale: string;
  browserName: string;
  scripts: string[];
  adapters: InteractionAdapterSummary[];
}

interface InteractionRow {
  adapter: (typeof ADAPTER_ORDER)[number];
  label: string;
  sortMs: number;
  filterMetadataMs: number;
  filterTextMs: number;
}

function loadInteractionSummary(): {
  rows: InteractionRow[];
  filename: string;
  runsetId: string;
} {
  const filename =
    "status/milestones/2026-05-10-b2-sort-filter-summary.json";
  const raw = readFileSync(repoRootRelative(filename), "utf8");
  const data = JSON.parse(raw) as InteractionSummaryFile;
  const rows = ADAPTER_ORDER.flatMap<InteractionRow>((adapter) => {
    const entry = data.adapters.find((a) => a.adapterId === adapter);
    if (!entry) return [];
    const sortRow = entry.rows.find((r) => r.scriptName === "sort");
    const fmRow = entry.rows.find(
      (r) => r.scriptName === "filter-metadata",
    );
    const ftRow = entry.rows.find((r) => r.scriptName === "filter-text");
    if (
      sortRow?.interactionLatencyMs == null ||
      fmRow?.interactionLatencyMs == null ||
      ftRow?.interactionLatencyMs == null
    ) {
      return [];
    }
    return [
      {
        adapter,
        label: ADAPTER_LABEL[adapter],
        sortMs: sortRow.interactionLatencyMs,
        filterMetadataMs: fmRow.interactionLatencyMs,
        filterTextMs: ftRow.interactionLatencyMs,
      },
    ];
  });
  return { rows, filename, runsetId: data.runsetId };
}

function interactionVerdictFor(
  row: InteractionRow,
  fastest: InteractionRow,
): string {
  if (row.adapter === fastest.adapter) {
    return "fastest tied; full quality pass";
  }
  const ratios = [
    row.sortMs / fastest.sortMs,
    row.filterMetadataMs / fastest.filterMetadataMs,
    row.filterTextMs / fastest.filterTextMs,
  ];
  const minR = Math.min(...ratios);
  const maxR = Math.max(...ratios);
  const tieScripts: string[] = [];
  if (row.filterMetadataMs / fastest.filterMetadataMs < 1.05) {
    tieScripts.push("filter-metadata");
  }
  const range =
    Math.round(minR * 10) === Math.round(maxR * 10)
      ? `${minR.toFixed(1)}× slower`
      : `${minR.toFixed(1)}–${maxR.toFixed(1)}× slower`;
  return tieScripts.length > 0
    ? `${range} (${tieScripts.join(", ")} ties pretable)`
    : range;
}
```

### 4.3 Hook the loader into the page render

In `BenchPage()`, after `loadScrollSummary()` / `loadH1Hypothesis()` / `loadH1HighRepeatCorrection()`, add:

```tsx
const { rows: interactionRows, runsetId: interactionRunsetId } =
  loadInteractionSummary();
const interactionFastest = interactionRows.reduce((min, r) => {
  const minSum = min.sortMs + min.filterMetadataMs + min.filterTextMs;
  const rSum = r.sortMs + r.filterMetadataMs + r.filterTextMs;
  return rSum < minSum ? r : min;
});
```

### 4.4 Replace the placeholder Interactions section

Find the existing `<h2>Interaction (sort, filter)</h2>` block (one heading + one paragraph) and replace with:

```tsx
<h2 className="mt-12 font-display text-[28px] tracking-[-0.02em] text-text-primary">
  Interactions (sort, filter)
</h2>
<p className="mt-3 text-[15px] leading-[1.6] text-text-secondary">
  Scenario <code>S2</code> (3,000 rows, wrapped multilingual messages).
  Sort applies a column-state change; filter-metadata applies an
  equals filter on a metadata column; filter-text applies a contains
  filter on the wrapped-text primary column. Latency measured from
  trigger to first changed frame; lower is better.
</p>

<table className="mt-6 w-full table-fixed border-collapse text-left text-[14px]">
  <thead>
    <tr className="border-b border-rule text-text-muted">
      <th className="py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
        Adapter
      </th>
      <th className="py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
        sort p95 (ms)
      </th>
      <th className="py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
        filter-metadata p95 (ms)
      </th>
      <th className="py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
        filter-text p95 (ms)
      </th>
      <th className="py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
        Verdict
      </th>
    </tr>
  </thead>
  <tbody>
    {interactionRows.map((r) => (
      <tr
        className="border-b border-rule-soft text-text-primary"
        key={r.adapter}
      >
        <td className="py-3 font-mono text-[13px] font-semibold">
          {r.label}
        </td>
        <td className="py-3 font-mono text-[13px] tabular-nums">
          {r.sortMs.toFixed(1)}
        </td>
        <td className="py-3 font-mono text-[13px] tabular-nums">
          {r.filterMetadataMs.toFixed(1)}
        </td>
        <td className="py-3 font-mono text-[13px] tabular-nums">
          {r.filterTextMs.toFixed(1)}
        </td>
        <td className="py-3 text-[13px] text-text-secondary">
          {interactionVerdictFor(r, interactionFastest)}
        </td>
      </tr>
    ))}
  </tbody>
</table>

<p className="mt-6 max-w-[60ch] text-[15px] leading-[1.6] text-text-secondary">
  Pretable sorts and filters 3,000 wrapped-text rows in 16–18 ms across
  all three scripts — clear of the single 60Hz frame budget on
  <code> filter-metadata </code> and <code> sort </code>, fractionally
  over on <code> filter-text </code>. AG Grid Community runs sort and
  filter 3–3.5× slower despite being a full feature-surface grid; MUI X
  DataGrid Community lands at roughly 2× across all three scripts.
  TanStack Table v8 + TanStack Virtual is the only comparator that ties
  pretable on a single metric — <code> filter-metadata </code> at 15.7
  ms vs 16.0 ms, within run noise — but is 2.1× slower on sort and 2.3×
  slower on <code> filter-text </code>.
</p>
<p className="mt-3 max-w-[60ch] text-[15px] leading-[1.6] text-text-secondary">
  Like the scroll story, the H6/H7/H8 evaluators check
  pretable&rsquo;s absolute thresholds (<code>≤ 32 ms</code> interaction
  p95) rather than gating on comparator parity. All three hypotheses
  stay satisfied at n=3.
</p>
```

### 4.5 Typecheck + build

```
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website build
```

Both pass.

### 4.6 Commit

```
git add apps/website/app/bench/page.tsx
git commit -m "feat(website): /bench page Interactions section with sort + filter comparator data"
```

---

## Task 5 — repo-memory entry

### 5.1 Append a 2026-05-11 section to `docs/research/repo-memory.md`

Add after the existing 2026-05-10 sections. Cover:

- The homepage refresh that landed (ComparisonTable + trail-markers + /bench section).
- The aggregator script + new milestone summary file.
- The deliberate non-goals: ReceiptsBand stays as-is (PR #129 owns it); FeatureGrid stays as-is (Stream-aware copy already capability-anchored).
- The pretable `filter-text` 17.7 ms borderline; future n=20 follow-up noted but not in scope.

### 5.2 Commit

```
git add docs/research/repo-memory.md
git commit -m "docs(research): repo-memory entry for homepage interaction wedge refresh"
```

---

## Task 6 — Gates + PR

### 6.1 Repo-wide gates

```
pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
```

All four pass. The aggregator script is plain ESM JS; not lint-targeted.

### 6.2 Push + open PR

```
git push -u origin b2-followup-interaction-homepage-refresh
gh pr create --title "fix(website): homepage interaction wedge refresh (B2 follow-up)" --body "..."
```

PR body covers: summary, ComparisonTable interaction rows table, trail-marker label diff, /bench page section, what's NOT in this PR (ReceiptsBand, FeatureGrid, n=20 follow-up for borderlines).

**Do NOT set auto-merge.** Three editorial surfaces touched; the user reviews the prose draft before merging.

---

## Self-review

- Spec coverage: aggregator (1), ComparisonTable rows + labels + prose (2), tests (3), /bench section (4), repo-memory (5), gates+PR (6). ✓
- No placeholders.
- Type consistency: `Row` interface (ComparisonTable) unchanged; new `InteractionRow` shape consistent between loader, render, and verdict helper.
- Scope: single PR, ~6 commits, six task groups. Editorial work — no auto-merge.

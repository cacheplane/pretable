import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bench results — pretable",
  description:
    "Comparative bench results for pretable vs AG Grid Community, TanStack Table, and MUI X DataGrid Community on wrapped-text scroll and streaming row stability.",
};

interface ScrollAdapterSummary {
  adapterId: string;
  status: string;
  sampleCount: number;
  metrics?: {
    scroll_frame_p95_ms?: number;
    row_height_error_p95_px?: number;
    blank_gap_frames?: number;
    long_tasks_count?: number;
    scroll_anchor_shift_backward_p95_px?: number;
    [k: string]: unknown;
  };
}

interface ScrollSummaryFile {
  runsetId: string;
  generatedAt: string;
  adapters: ScrollAdapterSummary[];
}

interface Hypothesis {
  id: string;
  status: string;
  summary: string;
  evidence: { adapterId: string; metrics: Record<string, unknown> }[];
}

interface MilestoneFile {
  hypotheses: Hypothesis[];
}

interface H1HighRepeatCorrectionFile {
  predecessor: string;
  evidenceSource: string;
  reason: string;
  highRepeatEvidence: {
    matrix: { repeats: number };
    perAdapter: Record<
      string,
      {
        n: number;
        mean_scroll_frame_p95_ms: number;
        sd_scroll_frame_p95_ms: number;
      }
    >;
    twoSigmaTest: {
      meanDiffPretableMinusMui: number;
      noiseFloor: number;
      verdict: "noise" | "real-pretable-slower" | "real-mui-slower";
    };
  };
  correctedH1: { id: string; status: string; summary: string };
}

const REPO = "cacheplane/pretable";
const ADAPTER_ORDER = ["pretable", "ag-grid", "tanstack", "mui"] as const;
const ADAPTER_LABEL: Record<(typeof ADAPTER_ORDER)[number], string> = {
  pretable: "pretable",
  "ag-grid": "AG Grid Community",
  tanstack: "TanStack Table",
  mui: "MUI X DataGrid Community",
};

function repoRootRelative(...segments: string[]): string {
  // app/bench/page.tsx → ../../../  → apps/website root → ../../  → repo root
  return join(process.cwd(), "..", "..", ...segments);
}

interface ScrollRow {
  adapter: (typeof ADAPTER_ORDER)[number];
  label: string;
  p95Ms: number;
  rhePx: number;
  blankGaps: number;
  anchorShiftPx: number;
}

function loadScrollSummary(): {
  rows: ScrollRow[];
  filename: string;
  runsetId: string;
} {
  const filename = "status/milestones/2026-05-08-b2-scroll-summary.json";
  const raw = readFileSync(repoRootRelative(filename), "utf8");
  const data = JSON.parse(raw) as ScrollSummaryFile;
  const rows = ADAPTER_ORDER.flatMap<ScrollRow>((adapter) => {
    const entry = data.adapters.find((a) => a.adapterId === adapter);
    if (!entry || entry.status !== "completed" || !entry.metrics) return [];
    const m = entry.metrics;
    if (
      m.scroll_frame_p95_ms == null ||
      m.row_height_error_p95_px == null ||
      m.blank_gap_frames == null
    ) {
      return [];
    }
    return [
      {
        adapter,
        label: ADAPTER_LABEL[adapter],
        p95Ms: m.scroll_frame_p95_ms,
        rhePx: m.row_height_error_p95_px,
        blankGaps: m.blank_gap_frames,
        anchorShiftPx: m.scroll_anchor_shift_backward_p95_px ?? 0,
      },
    ];
  });
  return { rows, filename, runsetId: data.runsetId };
}

function loadH1Hypothesis(): Hypothesis | undefined {
  const raw = readFileSync(
    repoRootRelative(
      "status/milestones/2026-05-08-b2-comparative-bench.hypotheses.json",
    ),
    "utf8",
  );
  const data = JSON.parse(raw) as MilestoneFile;
  return data.hypotheses.find((h) => h.id === "H1");
}

function loadH1HighRepeatCorrection(): H1HighRepeatCorrectionFile {
  const raw = readFileSync(
    repoRootRelative(
      "status/milestones/2026-05-09-b2-h1-high-repeat-correction.json",
    ),
    "utf8",
  );
  return JSON.parse(raw) as H1HighRepeatCorrectionFile;
}

function verdictFor(
  row: ScrollRow,
  fastest: ScrollRow,
  parityAdapters: ReadonlySet<string>,
): string {
  const issues: string[] = [];
  if (row.blankGaps > 0) issues.push(`${row.blankGaps} blank gap`);
  if (row.rhePx > 1) issues.push(`row height drift ${row.rhePx}px`);
  const issueStr = issues.length > 0 ? `; ${issues.join(", ")}` : "";

  // High-repeat data confirmed parity for these adapters — don't crown a
  // "fastest" off n=3 noise.
  if (parityAdapters.has(row.adapter)) {
    return `parity at n=20 (full quality pass)${issueStr}`;
  }

  const ratio = row.p95Ms / fastest.p95Ms;
  if (row.adapter === fastest.adapter) {
    return `${row.p95Ms.toFixed(1)}ms p95; full quality pass${issueStr}`;
  }
  const ratioStr = ratio < 1.05 ? "≈ tied" : `${ratio.toFixed(1)}× slower`;
  return `${ratioStr}${issueStr}`;
}

export default function BenchPage() {
  const {
    rows: scrollRows,
    filename: scrollFile,
    runsetId,
  } = loadScrollSummary();
  const h1Original = loadH1Hypothesis();
  const h1Correction = loadH1HighRepeatCorrection();
  const h1Status = h1Correction.correctedH1.status;
  const highRepeat = h1Correction.highRepeatEvidence;
  const parityAdapters = new Set(
    highRepeat.twoSigmaTest.verdict === "noise"
      ? Object.keys(highRepeat.perAdapter)
      : [],
  );

  // Fastest by raw scroll frame p95.
  const fastest = scrollRows.reduce((min, r) =>
    r.p95Ms < min.p95Ms ? r : min,
  );
  // Pretable's row, for prose anchoring.
  const pretableRow = scrollRows.find((r) => r.adapter === "pretable");
  const pretableHighRepeat = highRepeat.perAdapter.pretable;
  const muiHighRepeat = highRepeat.perAdapter.mui;

  return (
    <article className="prose">
      <h1 className="font-display text-[44px] leading-[1.05] tracking-[-0.025em] text-text-primary">
        Bench results
      </h1>
      <p className="mt-4 max-w-[60ch] text-[16px] leading-[1.6] text-text-secondary">
        These numbers anchor every claim on the homepage. Generated by running
        the same dataset through{" "}
        <a
          className="text-accent underline-offset-2 hover:underline"
          href={`https://github.com/${REPO}/tree/main/apps/bench`}
        >
          <code>apps/bench</code>
        </a>{" "}
        — pretable against three real third-party grids: AG Grid Community,
        TanStack Table v8 with TanStack Virtual, and MUI X DataGrid Community.
        We measure scroll frame timings, blank gaps under scroll, row-height
        fidelity for wrapped text, and anchor stability across rebuilds. All raw
        data is in the repo; this page renders one milestone JSON file.
      </p>
      <p className="mt-3 max-w-[60ch] text-[14px] italic leading-[1.6] text-text-muted">
        Runset <code>{runsetId}</code> · Chromium · S2 (3,000 rows, wrapped
        multilingual messages) · hypothesis scale · 3 repeats per adapter.
        Pretable / MUI scroll p95 also re-measured at 20 repeats — parity
        confirmed (see below).
      </p>

      <h2 className="mt-12 font-display text-[28px] tracking-[-0.02em] text-text-primary">
        H1 — wrapped-text scroll
      </h2>
      <p className="mt-3 text-[15px] leading-[1.6] text-text-secondary">
        Scenario <code>S2</code> (3,000 rows, wrapped multilingual messages,
        scroll script). Frame p95 measured via Performance Observer; row-height
        error measured by comparing each adapter&rsquo;s rendered DOM row height
        against the engine&rsquo;s planned height. Lower is better for every
        column.
      </p>

      <table className="mt-6 w-full table-fixed border-collapse text-left text-[14px]">
        <thead>
          <tr className="border-b border-rule text-text-muted">
            <th className="py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
              Adapter
            </th>
            <th className="py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
              Frame p95 (ms)
            </th>
            <th className="py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
              Row height error (px)
            </th>
            <th className="py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
              Blank gaps
            </th>
            <th className="py-3 font-mono text-[11px] uppercase tracking-[0.14em]">
              Verdict
            </th>
          </tr>
        </thead>
        <tbody>
          {scrollRows.map((r) => (
            <tr
              className="border-b border-rule-soft text-text-primary"
              key={r.adapter}
            >
              <td className="py-3 font-mono text-[13px] font-semibold">
                {r.label}
              </td>
              <td className="py-3 font-mono text-[13px] tabular-nums">
                {r.p95Ms.toFixed(1)}
              </td>
              <td className="py-3 font-mono text-[13px] tabular-nums">
                {r.rhePx}
              </td>
              <td className="py-3 font-mono text-[13px] tabular-nums">
                {r.blankGaps}
              </td>
              <td className="py-3 text-[13px] text-text-secondary">
                {verdictFor(r, fastest, parityAdapters)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-6 max-w-[60ch] text-[15px] leading-[1.6] text-text-secondary">
        On this dataset, pretable and MUI X DataGrid Community sit at parity on
        scroll frame p95: a 20-repeat re-measurement gives pretable{" "}
        {pretableHighRepeat.mean_scroll_frame_p95_ms.toFixed(2)}ms ± {""}
        {pretableHighRepeat.sd_scroll_frame_p95_ms.toFixed(2)} and MUI {""}
        {muiHighRepeat.mean_scroll_frame_p95_ms.toFixed(2)}ms ± {""}
        {muiHighRepeat.sd_scroll_frame_p95_ms.toFixed(2)}. The single-repeat
        snapshot above (pretable {pretableRow?.p95Ms.toFixed(1)}ms vs{" "}
        {fastest.p95Ms.toFixed(1)}ms) read as a small MUI lead; under tighter
        sampling that gap is well inside the 2σ noise floor (≈ 0.40ms). Both
        adapters clear the single 60Hz frame budget with zero blank gaps and ≤
        1px row-height drift.
      </p>
      <p className="mt-3 max-w-[60ch] text-[15px] leading-[1.6] text-text-secondary">
        AG Grid Community and TanStack Table land at roughly twice that frame
        p95 (~16.7ms) and both drop a blank gap during the scripted scroll; AG
        Grid additionally drifts 2px on row height, a sign that wrapped-cell
        layout doesn&rsquo;t round-trip through its line-height pipeline as
        cleanly as pretable&rsquo;s text-core does.
      </p>
      <p className="mt-3 max-w-[60ch] text-[15px] leading-[1.6] text-text-secondary">
        The honest read: pretable&rsquo;s wedge on this script isn&rsquo;t a raw
        frame-speed lead over the best comparator — it&rsquo;s parity on raw
        frame timing, with the combination of zero blank gaps, zero anchor
        shift, and ≤ 1px row-height fidelity at full-grid feature weight. MUI
        matches pretable on quality but ships a fundamentally different feature
        surface (no headless engine, no streaming primitives, no
        theming-as-data). The H1 evaluator marks this run{" "}
        <strong className="text-text-primary">{h1Status}</strong> after the
        high-repeat correction; the original{" "}
        <code>{h1Original?.status ?? "—"}</code> verdict from the n=3 snapshot
        was a low-sample artifact, not a real regression.
      </p>

      <h2 className="mt-12 font-display text-[28px] tracking-[-0.02em] text-text-primary">
        Interaction (sort, filter)
      </h2>
      <p className="mt-3 max-w-[60ch] text-[15px] leading-[1.6] text-text-secondary">
        Sort, metadata-filter, and wrapped-text-filter scripts (H6, H7, H8) all
        stay within pretable&rsquo;s single-frame interaction budget on the same
        dataset and remain satisfied on this runset. The comparator grids each
        carry their own sort/filter pipelines, but our matrix gates interaction
        scripts to pretable for now — comparative interaction evidence is on the
        roadmap.
      </p>

      <h2 className="mt-12 font-display text-[28px] tracking-[-0.02em] text-text-primary">
        Streaming
      </h2>
      <p className="mt-3 max-w-[60ch] text-[15px] leading-[1.6] text-text-secondary">
        H13&ndash;H15 (streaming update frame budget, operating envelope, and
        row stability under stream) require S5 and rate-tagged update runs; this
        matrix run is S2 only, so those hypotheses are reported as{" "}
        <em>insufficient</em> rather than re-evaluated. The last full streaming
        evidence remains in the milestone archive.
      </p>

      <h2 className="mt-12 font-display text-[28px] tracking-[-0.02em] text-text-primary">
        Methodology
      </h2>
      <ul className="mt-3 list-disc pl-6 text-[15px] leading-[1.65] text-text-secondary">
        <li>
          <strong className="text-text-primary">
            Same dataset, same script.
          </strong>{" "}
          Each adapter runs the canonical S2 scenario from{" "}
          <code>@pretable-internal/scenario-data</code> through identical
          interaction plans. The harness is in{" "}
          <code>@pretable-internal/bench-runner</code>.
        </li>
        <li>
          <strong className="text-text-primary">Repeated-run medians.</strong> 3
          samples per (adapter, scenario, script) tuple in this runset. Reported
          value is the median; full per-sample data is in the runset JSON.
        </li>
        <li>
          <strong className="text-text-primary">
            Idiomatic out-of-the-box config.
          </strong>{" "}
          AG Grid uses <code>themeQuartz</code> with Community modules
          registered, sortable + filterable + resizable defaults, and{" "}
          <code>applyTransaction</code> updates. TanStack uses{" "}
          <code>useReactTable</code> with <code>getCoreRowModel</code>/
          <code>getSortedRowModel</code>/<code>getFilteredRowModel</code> plus
          TanStack Virtual for row virtualization. MUI X uses{" "}
          <code>DataGrid</code> from <code>@mui/x-data-grid</code> with default
          sort/filter/resizable enabled. Pretable uses RAF-batched{" "}
          <code>grid.applyTransaction</code> via{" "}
          <code>@pretable/stream-adapter</code>. None of the adapters carry
          per-bench tuning — what we measure is what each library ships out of
          the box.
        </li>
        <li>
          <strong className="text-text-primary">Wedge integrity:</strong> the
          pretable adapter renders the same{" "}
          <a
            className="text-accent underline-offset-2 hover:underline"
            href="/docs/grid/pretable-surface"
          >
            <code>&lt;PretableSurface&gt;</code>
          </a>{" "}
          the website&rsquo;s homepage hero uses. What we measure is what you
          ship.
        </li>
      </ul>

      <h2 className="mt-12 font-display text-[28px] tracking-[-0.02em] text-text-primary">
        Run it yourself
      </h2>
      <p className="mt-3 text-[15px] leading-[1.6] text-text-secondary">
        The bench is part of the open-source repo. Clone, install, run:
      </p>
      <pre className="mt-4 overflow-x-auto rounded-[4px] bg-bg-card p-4 font-mono text-[13px] text-text-primary">
        <code>{`git clone https://github.com/${REPO}.git
cd pretable
pnpm install
pnpm bench:matrix \\
  --project=chromium \\
  --adapters=pretable,ag-grid,tanstack,mui \\
  --scenarios=S2 --scripts=initial,scroll \\
  --scale=hypothesis --repeats=3
# Output: status/runsets/<timestamp>.hypotheses.json`}</code>
      </pre>
      <p className="mt-4 text-[15px] leading-[1.6] text-text-secondary">
        For the full contributor walkthrough, see{" "}
        <a
          className="text-accent underline-offset-2 hover:underline"
          href={`https://github.com/${REPO}/blob/main/apps/bench/README.md`}
        >
          <code>apps/bench/README.md</code>
        </a>
        .
      </p>

      <h2 className="mt-12 font-display text-[28px] tracking-[-0.02em] text-text-primary">
        Raw data
      </h2>
      <ul className="mt-3 list-disc pl-6 text-[15px] leading-[1.65] text-text-secondary">
        <li>
          <a
            className="text-accent underline-offset-2 hover:underline"
            href={`https://github.com/${REPO}/blob/main/${scrollFile}`}
          >
            <code>{scrollFile}</code>
          </a>{" "}
          — per-adapter scroll medians (this page&rsquo;s table)
        </li>
        <li>
          <a
            className="text-accent underline-offset-2 hover:underline"
            href={`https://github.com/${REPO}/blob/main/status/milestones/2026-05-08-b2-comparative-bench.hypotheses.json`}
          >
            <code>
              status/milestones/2026-05-08-b2-comparative-bench.hypotheses.json
            </code>
          </a>{" "}
          — full H1&ndash;H21 evaluator report for this runset
        </li>
        <li>
          <a
            className="text-accent underline-offset-2 hover:underline"
            href={`https://github.com/${REPO}/tree/main/status/milestones`}
          >
            <code>status/milestones/</code>
          </a>{" "}
          — milestone archive (H1 baseline, S3 column virtualization, streaming,
          selection/nav)
        </li>
      </ul>
    </article>
  );
}

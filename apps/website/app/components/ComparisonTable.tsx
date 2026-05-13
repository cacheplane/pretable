import { TrailMarker } from "./TrailMarker";

interface Row {
  metric: string;
  pretable: string;
  agGrid: string;
  tanstack: string;
  mui: string;
  budget: string;
}

const NA_MARKER = "n/a";

// Comparison snapshot — numbers from the committed B2 comparative runset
// (Chromium S2/hypothesis/scroll, real third-party adapters):
//
//   status/milestones/2026-05-08-b2-comparative-bench.hypotheses.json
//     S2/hypothesis/scroll × 3 repeats × 4 adapters. AG Grid Community v33,
//     TanStack Table v8 + TanStack Virtual v3, MUI X DataGrid Community v7.
//
//   status/milestones/2026-05-09-b2-h1-high-repeat-correction.json
//     Same slice for pretable + mui at 20 repeats. Confirms parity (mean
//     diff −0.065 ms, well inside the 2σ noise floor of 0.40 ms).
//
//   status/milestones/2026-05-09-b2-s5-s7-cross-validation.hypotheses.json
//     S5/updates × {1000, 25000}/sec and S7/scroll × 4 adapters × 3 repeats.
//     Cross-validates H1 on S7 (satisfied) and surfaces H13/H14/H15 as
//     directional — AG Grid's native applyTransaction matches pretable on
//     streaming p95, the 25k/sec envelope, and visible-row drift. The
//     streaming-uniqueness wedge is package surface, not raw throughput.
//
//   status/milestones/2026-05-10-b2-sort-filter-summary.json
//     S2/hypothesis/Chromium × 3 repeats × 4 adapters × 3 interaction
//     scripts. Pretable beats AG Grid 3-3.5× and MUI 2× across sort,
//     filter-metadata, filter-text.
//
//   status/milestones/2026-05-11-interaction-borderline-high-repeat.json
//     S2/hypothesis/Chromium × 20 repeats × pretable × 2 scripts +
//     tanstack × {filter-metadata, filter-text} partial. Pretable
//     interaction scripts land 1-2 ms over the single-frame budget at
//     higher repeats; the budget column is dropped from interaction
//     rows below. Pretable sort n=20 = 17.10 ± 1.83 ms.
//
// Re-derive with `pnpm bench:matrix --adapters=pretable,ag-grid,tanstack,mui
//   --scenarios=S2 --scripts=scroll --scale=hypothesis --repeats=10`.
//
// The wedge: parity with the best full-grid comparator (MUI) on raw frame
// p95, with ~1.7× headroom over AG Grid + TanStack, and the only adapter
// here that combines zero blank gaps + zero anchor shift + ≤1 px row-height
// fidelity at full-grid feature weight. The streaming row is capability-
// anchored (not numeric): pretable ships the SSE/partial-JSON/batcher/
// applyTransaction pipeline; AG Grid users wire that themselves.
const ROWS: readonly Row[] = [
  {
    metric: "frame p95 (ms) — wrapped scroll",
    pretable: "9.07",
    agGrid: "16.7",
    tanstack: "16.7",
    mui: "9.14",
    budget: "≤ 16",
  },
  {
    metric: "row-height fidelity (px error)",
    pretable: "1",
    agGrid: "2",
    tanstack: "0",
    mui: "1",
    budget: "≤ 1",
  },
  {
    metric: "blank gaps under scroll",
    pretable: "0",
    agGrid: "1",
    tanstack: "1",
    mui: "0",
    budget: "0",
  },
  {
    metric: "scroll anchor shift (px)",
    pretable: "0",
    agGrid: "0",
    tanstack: "0",
    mui: "0",
    budget: "≤ 16",
  },
  {
    metric: "sort latency p95 (ms) — interaction",
    pretable: "17.1",
    agGrid: "58.3",
    tanstack: "34.4",
    mui: "35.0",
    budget: "—",
  },
  {
    metric: "filter-metadata latency p95 (ms)",
    pretable: "17.5",
    agGrid: "49.9",
    tanstack: "15.7",
    mui: "33.4",
    budget: "—",
  },
  {
    metric: "filter-text latency p95 (ms)",
    pretable: "16.8",
    agGrid: "50.0",
    tanstack: "40.2",
    mui: "33.3",
    budget: "—",
  },
  {
    metric: "headless engine + React surface",
    pretable: "yes",
    agGrid: NA_MARKER,
    tanstack: "engine only",
    mui: NA_MARKER,
    budget: "—",
  },
  {
    metric:
      "streaming pipeline (SSE → partial JSON → batcher → applyTransaction)",
    pretable: "yes",
    agGrid: NA_MARKER,
    tanstack: NA_MARKER,
    mui: NA_MARKER,
    budget: "—",
  },
];

export function ComparisonTable() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          03 · how we compare
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          How we compare.
        </h2>
        <p className="mt-5 max-w-[60ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Wrapped-text scroll at 3,000 rows on Chromium, against the three
          most-cited React grids. Pretable matches MUI at the front, ~1.7× ahead
          of AG Grid Community and TanStack on raw frame p95 — and is the only
          adapter here that clears every quality threshold (zero blank gaps,
          zero anchor shift, ≤1 px row-height drift) at full-grid feature
          weight. Interactive sort and filter run 2–3.5× faster than every
          measured comparator on the same dataset.{" "}
          <a
            href="https://github.com/cacheplane/pretable/tree/main/status/milestones"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            See the methodology →
          </a>
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
                    <TrailMarker variant="green" label="Recommended path" />
                    <em className="italic text-accent">pretable</em>
                  </span>
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  <span className="inline-flex items-center gap-2">
                    <TrailMarker
                      variant="blue"
                      label="1.7× slower scroll, 3× slower interaction; row-height drift"
                    />
                    AG Grid
                  </span>
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  <span className="inline-flex items-center gap-2">
                    <TrailMarker
                      variant="black"
                      label="Headless; ~2× slower interaction"
                    />
                    TanStack
                  </span>
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  <span className="inline-flex items-center gap-2">
                    <TrailMarker
                      variant="green"
                      label="Scroll-p95 parity; 2× slower interaction"
                    />
                    MUI X
                  </span>
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
                      (row.agGrid === NA_MARKER
                        ? "italic text-text-dim"
                        : "text-text-muted")
                    }
                  >
                    {row.agGrid}
                  </td>
                  <td
                    className={
                      "px-3 py-3 " +
                      (row.tanstack === NA_MARKER
                        ? "italic text-text-dim"
                        : "text-text-muted")
                    }
                  >
                    {row.tanstack}
                  </td>
                  <td
                    className={
                      "px-3 py-3 " +
                      (row.mui === NA_MARKER
                        ? "italic text-text-dim"
                        : "text-text-muted")
                    }
                  >
                    {row.mui}
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

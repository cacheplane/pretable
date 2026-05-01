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

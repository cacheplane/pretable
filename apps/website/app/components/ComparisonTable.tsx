interface Row {
  metric: string;
  pretable: string;
  gridAlpha: string;
  gridbeta: string;
  gridgammaX: string;
  budget: string;
  pretableWins: boolean;
}

// Comparison snapshot — numbers from the streaming rate sweep documented at
// docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md. Source of
// truth: status/runsets/*.hypotheses.json from `pnpm bench:matrix`.
//
// The previous version of this table showed placeholder numbers (Pretable
// 9 ms, Grid Alpha 28 ms, GridBeta 21 ms, GridGamma 34 ms; "vs gridalpha 4.1×") that
// implied a 4× streaming wedge. Real bench data (S5/updates at 1k patches/
// sec, hypothesis scale, 3 repeats, Chromium) shows Pretable, Grid Alpha
// Community, and GridBeta Virtual tied on the top-line streaming metrics —
// all 9–10 ms p95, all zero long tasks. Only GridGamma X Community fails.
//
// The streaming wedge is purpose-built integration + row stability, not raw
// speed. The rows below reflect that. The page must not lie.
const ROWS: readonly Row[] = [
  {
    metric: "frame p95 (ms) — streaming",
    pretable: "9",
    gridAlpha: "10",
    gridbeta: "10",
    gridgammaX: "100",
    budget: "≤ 16",
    // Three-way tie within run noise. Only GridGamma fails the budget. This
    // row reflects "streaming-capable", not "fastest" — Pretable does
    // not have a unique numeric win here.
    pretableWins: false,
  },
  {
    metric: "long task ms / 3 s test",
    pretable: "0",
    gridAlpha: "0",
    gridbeta: "0",
    gridgammaX: "5,341",
    budget: "0",
    pretableWins: false,
  },
  {
    metric: "visible row drift",
    pretable: "0",
    gridAlpha: "22",
    gridbeta: "1",
    gridgammaX: "2",
    budget: "0",
    // Only Pretable + GridBeta hold drift at zero; Grid Alpha recycles
    // 22 rows mid-stream. Real differentiator vs Grid Alpha.
    pretableWins: true,
  },
  {
    metric: "max sustained rate",
    pretable: "25,000/s",
    gridAlpha: "25,000/s",
    gridbeta: "25,000/s",
    gridgammaX: "< 500/s",
    budget: "—",
    pretableWins: false,
  },
  {
    metric: "purpose-built streaming pipeline",
    pretable: "yes",
    gridAlpha: "no",
    gridbeta: "no",
    gridgammaX: "no",
    budget: "—",
    // @cacheplane/json-stream + @pretable-internal/stream-adapter is the
    // only adapter shipping a documented end-to-end streaming pipeline.
    pretableWins: true,
  },
];

const NA_MARKER = "n/a";

export function ComparisonTable() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
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
                      streaming-capable
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

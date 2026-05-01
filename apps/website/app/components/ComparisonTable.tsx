interface Row {
  metric: string;
  pretable: string;
  agGrid: string;
  tanstack: string;
  muiX: string;
  budget: string;
  pretableWins: boolean;
}

const NA_MARKER = "n/a";

// Comparison snapshot — numbers from two committed milestone runsets:
//
//   status/milestones/2026-05-01-h1-satisfied.hypotheses.json
//     S2/scroll/hypothesis × 3 repeats. H1 satisfied. Pretable 9.3ms p95,
//     0px row-height-error, 4.6× faster than AG Grid (42.5ms, 153px).
//
//   status/milestones/2026-05-01-streaming-revalidated.hypotheses.json
//     S5/updates × {100, 500, 1k, 5k, 10k, 25k}/sec × 3 repeats. H15
//     satisfied. Pretable max visible-row drift = 1 vs AG Grid's 28.
//
// Re-derive with `pnpm bench:matrix`. Background memo:
// docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md.
//
// The wedge has two sides. Scroll: real comparative win (4.6×) vs AG Grid.
// Streaming: tied with AG Grid + TanStack on raw frame budget; the win is
// row stability + integration. The rows below reflect both halves honestly.
const ROWS: readonly Row[] = [
  // ── Scroll proof (S2 wrapped-text @ 3k rows). The decisive comparative
  // ── numeric win — 4.6× faster than AG Grid on the canonical wedge.
  {
    metric: "frame p95 (ms) — wrapped scroll",
    pretable: "9.3",
    agGrid: "42.5",
    tanstack: "9.3",
    muiX: NA_MARKER,
    budget: "≤ 16",
    pretableWins: true,
  },
  {
    metric: "row-height fidelity (px error)",
    pretable: "0",
    agGrid: "153",
    tanstack: "0",
    muiX: NA_MARKER,
    budget: "≤ 1",
    // DOM-truth check: row.height vs cell.scrollHeight + padding + border.
    // AG Grid's row container is 153px out of sync with the cell content.
    pretableWins: true,
  },
  // ── Streaming proof (S5 updates @ 1k/sec, hypothesis scale).
  {
    metric: "frame p95 (ms) — streaming",
    pretable: "9",
    agGrid: "9",
    tanstack: "9",
    muiX: "100",
    budget: "≤ 16",
    // Three-way tie within run noise. Only MUI fails the budget. This
    // row reflects "streaming-capable", not "fastest" — Pretable does
    // not have a unique numeric win here.
    pretableWins: false,
  },
  {
    metric: "long task ms / 3 s test",
    pretable: "0",
    agGrid: "0",
    tanstack: "0",
    muiX: "5,341",
    budget: "0",
    pretableWins: false,
  },
  {
    metric: "visible row drift",
    pretable: "≤ 1",
    agGrid: "28",
    tanstack: "≤ 2",
    muiX: "2",
    budget: "≤ 1",
    // Pretable holds drift at the threshold. AG Grid recycles 22-28 rows
    // at sub-5k rates — real user-visible streaming differentiator.
    pretableWins: true,
  },
  {
    metric: "max sustained rate",
    pretable: "25,000/s",
    agGrid: "25,000/s",
    tanstack: "25,000/s",
    muiX: "< 500/s",
    budget: "—",
    pretableWins: false,
  },
  {
    metric: "purpose-built streaming pipeline",
    pretable: "yes",
    agGrid: "no",
    tanstack: "no",
    muiX: "no",
    budget: "—",
    // @cacheplane/json-stream + @pretable-internal/stream-adapter is the
    // only adapter shipping a documented end-to-end streaming pipeline.
    pretableWins: true,
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
        <p className="mt-5 max-w-[64ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Two windows: wrapped-text scroll at 3,000 rows, and streaming updates
          at 1,000 patches/sec. Three repeats each on Chromium. Pretable's
          column is amber-italic. Numbers come from{" "}
          <code className="font-mono text-[15px] text-accent-deep">
            pnpm bench:matrix
          </code>
          ; committed evidence in{" "}
          <a
            href="https://github.com/cacheplane/pretable/tree/main/status/milestones"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            status/milestones
          </a>
          ; full streaming sweep at{" "}
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
                      4.6× faster scroll
                    </span>
                  </span>
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  ag-grid
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  tanstack
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  mui-x
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
                      (row.muiX === NA_MARKER
                        ? "italic text-text-dim"
                        : "text-text-muted")
                    }
                  >
                    {row.muiX}
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

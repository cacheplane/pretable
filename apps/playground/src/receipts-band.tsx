interface Stat {
  value: string;
  caption: string;
}

// Receipts snapshot — bench run status as of 2026-04-23 at 90253ce:
//
//   No live metrics are sourceable today. The status/snapshots/ and
//   status/runsets/ directories are empty; no bench:matrix run has been
//   executed against this codebase yet.
//
//   Bench command: `pnpm bench:matrix` (builds bench app, starts vite preview
//   on port 4173, then runs Playwright via `pnpm bench:e2e` for each
//   adapter × scenario × script combination).
//
//   What the bench WOULD produce for S7 scroll (pretable adapter):
//     - "rows rendered"  → result_row_count from the summary JSON.
//                          S7/target scale = 50,000 rows.
//     - "frame p50"      → CAPTION MISMATCH: the bench only tracks
//                          scroll_frame_p95_ms (p95), not p50. Caption
//                          would need to be changed to "frame p95" when
//                          populated, or a p50 metric must be added to
//                          @pretable-internal/bench-runner first.
//     - "jank events"    → long_tasks_count (browser Long Tasks API,
//                          threshold ≥ 50ms) from the summary JSON.
//     - "vs ag-grid"     → ratio of pretable scroll_frame_p95_ms to
//                          ag-grid scroll_frame_p95_ms from a paired run.
//                          ag-grid adapter IS present in DEFAULT_ADAPTERS
//                          (bench-matrix.mjs line 7), so this ratio is
//                          computable once the matrix runs.
//
//   All four values below are PLACEHOLDERS. Direction D will wire these
//   to a live bench:matrix run and refresh.
const STATS: readonly Stat[] = [
  { value: "500k", caption: "rows rendered" },
  { value: "2.4ms", caption: "frame p50" },
  { value: "0", caption: "jank events" },
  { value: "4.1×", caption: "vs ag-grid" },
];

export function ReceiptsBand() {
  return (
    <section className="bg-cream text-ink border-b border-cream-rule px-7 py-[52px] md:px-10">
      <div className="mx-auto max-w-[1240px]">
        <h2 className="font-display text-[28px] leading-[1.12] tracking-[-0.02em] md:text-[32px]">
          <em className="italic text-amber-ink">Receipts</em>, not claims.
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
          {STATS.map((stat) => (
            <li
              key={stat.caption}
              className="border-t border-ink pt-3"
            >
              <div className="font-display text-[44px] leading-[1] tracking-[-0.02em]">
                {stat.value}
              </div>
              <div className="mt-1 font-mono text-[12px] text-ink-dim">
                {stat.caption}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-5 font-mono text-[12px] text-ink-softer">
          <a
            href="/bench"
            className="text-amber-ink underline-offset-2 hover:underline"
          >
            See them re-run in the bench →
          </a>
        </p>
      </div>
    </section>
  );
}

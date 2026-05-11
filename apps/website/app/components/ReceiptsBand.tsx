interface Stat {
  value: string;
  caption: string;
  /** First stat anchors with accent color (warm orange) on the dark band. */
  accent?: boolean;
  /**
   * Render the value at a smaller size for non-numeric labels (e.g., a
   * source list). The grid still uses four cells; this slot just trades
   * hero-number weight for legible text.
   */
  compact?: boolean;
}

// Receipts snapshot — numbers from the committed B2 comparative runset
// and its high-repeat correction; final slot is a capability anchor.
//
//   status/milestones/2026-05-09-b2-h1-high-repeat-correction.json
//     S2/hypothesis/scroll × 20 repeats. Pretable mean p95 = 9.07 ms ± 0.20;
//     parity with MUI X DataGrid Community. Quality wedge: 0 blank gaps,
//     0 anchor shift, ≤1 px row-height drift.
//
//   status/milestones/2026-05-09-b2-s5-s7-cross-validation.hypotheses.json
//     S5/updates × 4 adapters × 3 repeats. AG Grid Community matches
//     pretable on raw streaming throughput (9.2 ms p95, 25k/sec, 0 drift),
//     so the streaming wedge is reframed as the shipped pipeline rather
//     than the throughput number. Final receipts slot is the source list
//     pretable ships integrations for.
//
// First stat (0) anchors the quality wedge with accent (warm orange). All
// numerics are pretable's own; the comparative ranking lives on the /bench
// page and ComparisonTable.
const STATS: readonly Stat[] = [
  { value: "0", caption: "blank gaps under scroll", accent: true },
  { value: "9ms", caption: "frame p95 / wrapped scroll" },
  { value: "≤1px", caption: "row-height fidelity" },
  {
    value: "OpenAI · Anthropic · SSE",
    caption: "streaming sources, one import",
    compact: true,
  },
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
                  "font-display leading-[0.95] tracking-[-0.02em]",
                  stat.compact
                    ? "text-[20px] md:text-[24px]"
                    : "text-[44px] md:text-[56px]",
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

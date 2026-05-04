interface Stat {
  value: string;
  caption: string;
  /** First stat anchors with accent color (warm orange) on the dark band. */
  accent?: boolean;
}

// Receipts snapshot — numbers from two committed milestone runsets:
//
//   status/milestones/2026-05-01-h1-satisfied.hypotheses.json
//     S2/scroll/hypothesis × 5 repeats, unified row-height formula. H1
//     satisfied. Pretable median 16ms vs Grid Alpha 67ms = 4× faster.
//
//   status/milestones/2026-05-01-streaming-revalidated.hypotheses.json
//     S5/updates × 6 rates × 3 repeats. H15 satisfied.
//
// Bucket C: section flipped to an inverted slate band. The first stat
// (4×) anchors with accent (warm orange); the rest are cream on slate.
const STATS: readonly Stat[] = [
  { value: "4×", caption: "faster scroll vs gridalpha", accent: true },
  { value: "16ms", caption: "frame p95 / wrapped scroll" },
  { value: "0", caption: "long tasks / streaming" },
  { value: "25k/s", caption: "max sustained update rate" },
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
                  "font-display text-[44px] leading-[0.95] tracking-[-0.02em] md:text-[56px]",
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

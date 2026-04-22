interface Stat {
  value: string;
  caption: string;
}

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

interface Feature {
  title: string;
  caption: string;
  receiptLabel: string;
  receiptHref: string;
}

const FEATURES: readonly Feature[] = [
  {
    title: "60fps performance",
    caption: "500k rows render at frame p95 ≤ 16ms on the S7 stress scenario.",
    receiptLabel: "→ receipt: /bench?s=S7&scale=stress",
    receiptHref: "/bench?s=S7&scale=stress",
  },
  {
    title: "Stream-aware",
    caption:
      "Token-by-token rendering for OpenAI, Anthropic, or your own SSE. Sustains 100 to 25,000 updates/sec on S5 hypothesis scale without exceeding 60 fps.",
    receiptLabel: "→ receipt: /streaming-demo",
    receiptHref: "/streaming-demo",
  },
  {
    title: "Selection survives filters",
    caption:
      "Row-id keys persist across filter, sort, and live updates. Click a row, filter the grid, the selection sticks.",
    receiptLabel: "→ receipt: live demo above",
    receiptHref: "#grid",
  },
  {
    title: "Wrapped text, no jank",
    caption:
      "Multi-line cell content with auto-height — no layout shift on scroll, no row-jump on hover.",
    receiptLabel: "→ receipt: /bench?s=S2",
    receiptHref: "/bench?s=S2",
  },
  {
    title: "Deterministic engine",
    caption:
      "The render path is read-able. packages/grid-core ships fewer than 3,000 lines.",
    receiptLabel: "→ receipt: github.com/cacheplane/pretable",
    receiptHref: "https://github.com/cacheplane/pretable",
  },
  {
    title: "No-flash hydration",
    caption:
      "SSR-safe initial paint. Selection state survives hydration. Works in Next.js App Router.",
    receiptLabel: "→ receipt: this page",
    receiptHref: "#",
  },
];

export function FeatureGrid() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          04 · what's in the box
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Six receipts.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Each feature backed by a bench scenario or demo. No claim without a
          click-to-prove.
        </p>

        <ul
          role="list"
          className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
        >
          {FEATURES.map((feature, idx) => (
            <li key={feature.title} className="border-t border-rule pt-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                {String(idx + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-2 font-display text-[22px] leading-[1.15] tracking-[-0.015em]">
                {feature.title}
              </h3>
              <p className="mt-2 font-display text-[15px] leading-[1.5] text-text-secondary">
                {feature.caption}
              </p>
              <a
                href={feature.receiptHref}
                className="mt-4 block font-mono text-[11px] text-accent-deep hover:underline underline-offset-2"
              >
                {feature.receiptLabel}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

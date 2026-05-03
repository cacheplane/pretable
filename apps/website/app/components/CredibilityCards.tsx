const POSITIONING = [
  {
    num: "01",
    eyebrow: "Performance",
    headline: "The fastest grid in independent benchmarks.",
  },
  {
    num: "02",
    eyebrow: "AI-native",
    headline: "AI isn't a feature. It's the data model.",
  },
  {
    num: "03",
    eyebrow: "Wrapped text",
    headline: "Multi-line cells, no layout thrash.",
  },
  {
    num: "04",
    eyebrow: "Ecosystem",
    headline: "Drops into the AI SDKs you already use.",
  },
];

export function CredibilityCards() {
  return (
    <section
      id="why-it-works"
      className="text-text-primary border-b border-rule px-7 py-[52px] md:px-10"
    >
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          02 · why it works
        </p>
        <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {POSITIONING.map((card) => (
            <li
              key={card.num}
              className="rounded-[8px] border border-rule bg-bg-card p-6"
            >
              <span className="font-mono text-[10px] text-text-muted">
                {card.num}
              </span>
              <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                {card.eyebrow}
              </span>
              <h3 className="mt-3 font-display text-[18px] tracking-[-0.01em]">
                {card.headline}
              </h3>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

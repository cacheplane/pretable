interface PainCard {
  title: string;
  body: string;
}

const PAIN_CARDS: readonly PainCard[] = [
  {
    title: "Row vanishes mid-stream.",
    body: "Selection breaks on the first patch. Trust evaporates with it.",
  },
  {
    title: "Stream speeds up, frames drop.",
    body: "Demos handle 100/sec. Production at 1k breaks. Users notice.",
  },
  {
    title: "Wrapped text jumps on update.",
    body: "Row heights recalc, viewport shifts. No reading rhythm survives.",
  },
];

const TIMELINE: ReadonlyArray<{ year: string; label: string; now?: boolean }> =
  [
    { year: "1995", label: "Spreadsheet" },
    { year: "2010", label: "Data grid (batch)" },
    { year: "2024", label: "Streaming AI" },
    { year: "NOW", label: "Pretable", now: true },
  ];

export function Problem() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          01 · why now
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Data grids were built for the{" "}
          <em className="italic text-[#818cf8]">batch</em> era.
          <br />
          Then AI showed up.
        </h2>
        <p className="mt-5 max-w-[60ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Every popular React data grid was designed when data arrived in one
          shape: a complete array, fetched once, rendered. AI agents, streaming
          APIs, and live telemetry don't work that way. They produce data{" "}
          <em className="italic">over time</em> — token by token, patch by
          patch, partial first.
        </p>

        <ol
          role="list"
          className="mt-10 grid grid-cols-2 gap-4 border-y border-rule py-6 md:grid-cols-4"
        >
          {TIMELINE.map((cell) => (
            <li key={cell.year} className="text-center">
              <p className="font-mono text-[10px] tracking-[0.14em] text-text-muted">
                {cell.year}
              </p>
              <p
                className={
                  "mt-1 font-display text-[14px] " +
                  (cell.now ? "font-semibold text-accent" : "text-text-primary")
                }
              >
                {cell.label}
              </p>
            </li>
          ))}
        </ol>

        <p className="mt-10 max-w-[60ch] font-display text-[15px] leading-[1.55] text-text-secondary">
          Three failure modes every team building AI-driven dashboards has
          watched ship — symptoms of the same root cause: a render path that
          assumed data arrives all at once.
        </p>

        <ul role="list" className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {PAIN_CARDS.map((card) => (
            <li
              key={card.title}
              className="rounded-[6px] border border-rule bg-bg-card/50 p-5"
            >
              <h3 className="font-display text-[15px] leading-[1.25] text-text-primary">
                {card.title}
              </h3>
              <p className="mt-1.5 font-display text-[13px] leading-[1.5] text-text-secondary">
                {card.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

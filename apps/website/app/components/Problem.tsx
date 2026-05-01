export function Problem() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          01 · the wedge
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Other grids stall on the read-heavy{" "}
          <em className="italic text-[#818cf8]">wedge</em>.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Grid Alpha took down their performance page. GridBeta is headless. GridGamma X
          reads as a docs shell. Every competitor has stopped letting you watch
          the grid render.
        </p>
        <p className="mt-6 font-mono text-[12px] text-text-muted">
          Read it for yourself: their landing pages.
        </p>
      </div>
    </section>
  );
}

export function CtaSection() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[860px] text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          06 · check the receipts
        </p>
        <h2 className="mt-4 font-display text-[40px] leading-[1.02] tracking-[-0.025em] md:text-[56px] md:leading-none">
          Check the receipts.
        </h2>
        <p className="mx-auto mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          The grid is in your hands at the top of this page. The numbers are
          reproducible at{" "}
          <code className="font-mono text-[15px] text-accent-deep">/bench</code>
          . The source reads cleanly. Star, install, ship.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#grid"
            className="inline-flex items-center gap-2 rounded-[4px] bg-accent px-5 py-2.5 text-[13px] font-semibold text-bg-page hover:bg-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            Try it live ↑
          </a>
          <a
            href="https://github.com/cacheplane/pretable"
            className="inline-flex items-center gap-2 rounded-[2px] border border-text-primary bg-transparent px-[18px] py-[10px] font-mono text-[13px] text-text-primary hover:bg-bg-raised hover:text-bg-card transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            View on GitHub →
          </a>
        </div>
        <p className="mt-8 font-mono text-[11px] text-text-muted">
          MIT licensed · Built in the open · No telemetry.
        </p>
      </div>
    </section>
  );
}

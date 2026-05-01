export function Solution() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          02 · the answer
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Pretable renders the wedge at{" "}
          <em className="italic text-accent">60fps</em> — and lets you stream
          tokens into it.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          A deterministic engine you can read. Wrapped text without jank.
          Selection that survives filters and updates. Three claims; three
          receipts below.
        </p>
        <ul className="mt-8 flex flex-wrap gap-x-8 gap-y-3 font-mono text-[12px] text-text-secondary">
          <li>
            <span className="text-accent">▸</span> deterministic — no opaque
            virtualization
          </li>
          <li>
            <span className="text-accent">▸</span> streaming-aware — token-by-token
            rendering
          </li>
          <li>
            <span className="text-accent">▸</span> stable selection — row-id
            keys survive every chunk
          </li>
        </ul>
      </div>
    </section>
  );
}

import { RejectedWritesGrid } from "./showcase/RejectedWritesGrid";

const CODE_STRIP = `<StaleBanner fault={rejected?.rows} onRetry={refetch} />
<PretableSurface
  rows={positions}
  onRejectedWriteChange={setRejected}
  …
/>`;

export function RejectedWritesShowcase() {
  return (
    <section
      id="rejected-writes"
      className="text-text-primary px-7 py-16 md:px-10 md:py-28"
    >
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          10 · when the data goes bad
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          A bad server page shouldn&apos;t blank your grid.{" "}
          <em className="italic text-accent">Or lie to you.</em>
        </h2>
        <p className="mt-5 max-w-[64ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          One malformed row used to unmount the whole grid subtree. Now an
          invalid update is a rejected write: the grid keeps the last good rows,
          stays interactive, and tells your code through{" "}
          <code className="font-mono text-[15px]">onRejectedWriteChange</code>.
          The banner below is ours, not pretable&apos;s — built on that callback
          in a few lines. Corrupt a page and watch nothing break.
        </p>
        <div className="mt-10">
          <RejectedWritesGrid />
        </div>
        <pre
          data-testid="rw-code-strip"
          className="mt-6 overflow-x-auto rounded-[8px] border border-rule bg-bg-card p-4 font-mono text-[13px] leading-[1.6] text-text-secondary"
        >
          <code>{CODE_STRIP}</code>
        </pre>
      </div>
    </section>
  );
}

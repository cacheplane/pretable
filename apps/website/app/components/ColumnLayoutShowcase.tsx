import { ColumnLayoutGrid } from "./showcase/ColumnLayoutGrid";

export function ColumnLayoutShowcase() {
  return (
    <section
      id="column-layout"
      className="text-text-primary px-7 py-16 md:px-10 md:py-28"
    >
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          09 · columns, your way
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Resize and reorder. <em className="italic text-accent">Built in.</em>
        </h2>
        <p className="mt-5 max-w-[64ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Drag a column border to resize, drag a header to reorder — no config,
          no plugins. Make a mess, then hit reset.
        </p>
        <div className="mt-10">
          <ColumnLayoutGrid />
        </div>
      </div>
    </section>
  );
}

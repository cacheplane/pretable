import { ScaleGrid } from "./showcase/ScaleGrid";

export function ScaleShowcase() {
  return (
    <section
      id="scale"
      className="text-text-primary px-7 py-16 md:px-10 md:py-28"
    >
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          08 · scale
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          2,500 rows × 500 columns.{" "}
          <em className="italic text-accent">~160 cells in the DOM.</em>
        </h2>
        <p className="mt-5 max-w-[64ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Pretable virtualizes both axes. The grid below holds 1.25 million
          cells; scroll anywhere and the live counter shows how few actually
          exist in the DOM at once — matching our published 2,500 × 500
          benchmark (~160 peak nodes).
        </p>
        <div className="mt-10">
          <ScaleGrid />
        </div>
      </div>
    </section>
  );
}

import { TrailMarker } from "./TrailMarker";

interface Row {
  metric: string;
  pretable: string;
  gridAlpha: string;
  gridbeta: string;
  gridgammaX: string;
  budget: string;
  pretableWins: boolean;
}

const NA_MARKER = "n/a";

// Comparison snapshot — numbers from two committed milestone runsets:
//
//   status/milestones/2026-05-01-h1-satisfied.hypotheses.json
//     S2/scroll/hypothesis × 5 repeats, unified row-height formula across
//     adapters. H1 satisfied. Pretable median 16ms p95 vs Grid Alpha 67ms
//     (4× faster). Pretable holds 0px row-height-error; Grid Alpha 152px
//     (autoHeight + wrapText + virtualization at hypothesis scale clips
//     wrapped content to one line).
//
//   status/milestones/2026-05-01-streaming-revalidated.hypotheses.json
//     S5/updates × {100, 500, 1k, 5k, 10k, 25k}/sec × 3 repeats. H15
//     satisfied. Pretable max visible-row drift = 1 vs Grid Alpha's 28.
//
// Re-derive with `pnpm bench:matrix`. Background memo:
// docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md.
//
// The wedge has two sides. Scroll: 4× faster than Grid Alpha AND zero
// content overflow vs Grid Alpha's 152px clipping. Streaming: tied on raw
// frame budget; the win is row stability + integration.
const ROWS: readonly Row[] = [
  // ── Scroll proof (S2 wrapped-text @ 3k rows, 5 repeats). The decisive
  // ── numeric win — 4× faster than Grid Alpha on the canonical wedge.
  {
    metric: "frame p95 (ms) — wrapped scroll",
    pretable: "16",
    gridAlpha: "67",
    gridbeta: "17",
    gridgammaX: NA_MARKER,
    budget: "≤ 16",
    pretableWins: true,
  },
  {
    metric: "row-height fidelity (px error)",
    pretable: "0",
    gridAlpha: "152",
    gridbeta: "0",
    gridgammaX: NA_MARKER,
    budget: "≤ 1",
    // DOM-truth check: row.height vs cell.scrollHeight + padding + border.
    // Grid Alpha's row container is 152 px out of sync with the cell content
    // because its autoHeight + wrapText doesn't fully apply during
    // virtualization at hypothesis scale — wrapped content gets clipped to
    // a single line. Pretable's rows hold their cell content (0 px error).
    pretableWins: true,
  },
  // ── Streaming proof (S5 updates @ 1k/sec, hypothesis scale).
  {
    metric: "frame p95 (ms) — streaming",
    pretable: "9",
    gridAlpha: "9",
    gridbeta: "9",
    gridgammaX: "100",
    budget: "≤ 16",
    // Three-way tie within run noise. Only GridGamma fails the budget. This
    // row reflects "streaming-capable", not "fastest" — Pretable does
    // not have a unique numeric win here.
    pretableWins: false,
  },
  {
    metric: "long task ms / 3 s test",
    pretable: "0",
    gridAlpha: "0",
    gridbeta: "0",
    gridgammaX: "5,341",
    budget: "0",
    pretableWins: false,
  },
  {
    metric: "visible row drift",
    pretable: "≤ 1",
    gridAlpha: "28",
    gridbeta: "≤ 2",
    gridgammaX: "2",
    budget: "≤ 1",
    // Pretable holds drift at the threshold. Grid Alpha recycles 22-28 rows
    // at sub-5k rates — real user-visible streaming differentiator.
    pretableWins: true,
  },
  {
    metric: "max sustained rate",
    pretable: "25,000/s",
    gridAlpha: "25,000/s",
    gridbeta: "25,000/s",
    gridgammaX: "< 500/s",
    budget: "—",
    pretableWins: false,
  },
  {
    metric: "purpose-built streaming pipeline",
    pretable: "yes",
    gridAlpha: "no",
    gridbeta: "no",
    gridgammaX: "no",
    budget: "—",
    // @cacheplane/json-stream + @pretable/stream-adapter is the
    // only adapter shipping a documented end-to-end streaming pipeline.
    pretableWins: true,
  },
];

export function ComparisonTable() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          03 · how we compare
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          How we compare.
        </h2>
        <p className="mt-5 max-w-[60ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Wrapped-text scroll at 3,000 rows; streaming at 1,000 patches/sec.
          Both on Chromium.{" "}
          <a
            href="https://github.com/cacheplane/pretable/tree/main/status/milestones"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            See the methodology →
          </a>
        </p>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse font-mono text-[13px]">
            <thead>
              <tr className="border-b border-rule">
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  metric
                </th>
                <th className="px-3 py-3 text-left">
                  <span className="inline-flex items-center gap-2">
                    <TrailMarker variant="green" label="Recommended path" />
                    <em className="italic text-accent">pretable</em>
                    <span className="rounded-[2px] bg-accent-soft px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-accent">
                      4× faster scroll
                    </span>
                  </span>
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  <span className="inline-flex items-center gap-2">
                    <TrailMarker variant="blue" label="Familiar but slower" />
                    gridalpha
                  </span>
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  <span className="inline-flex items-center gap-2">
                    <TrailMarker variant="black" label="Powerful but DIY" />
                    gridbeta
                  </span>
                </th>
                <th className="px-3 py-3 text-left text-text-muted font-medium">
                  <span className="inline-flex items-center gap-2">
                    <TrailMarker
                      variant="double-black"
                      label="Broken at scale"
                    />
                    gridgamma-x
                  </span>
                </th>
                <th className="px-3 py-3 text-left text-text-secondary font-medium">
                  budget
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.metric} className="border-b border-rule-soft">
                  <td className="px-3 py-3 text-text-secondary">
                    {row.metric}
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-accent font-semibold">
                      {row.pretable}
                    </span>
                  </td>
                  <td
                    className={
                      "px-3 py-3 " +
                      (row.gridAlpha === NA_MARKER
                        ? "italic text-text-dim"
                        : "text-text-muted")
                    }
                  >
                    {row.gridAlpha}
                  </td>
                  <td
                    className={
                      "px-3 py-3 " +
                      (row.gridbeta === NA_MARKER
                        ? "italic text-text-dim"
                        : "text-text-muted")
                    }
                  >
                    {row.gridbeta}
                  </td>
                  <td
                    className={
                      "px-3 py-3 " +
                      (row.gridgammaX === NA_MARKER
                        ? "italic text-text-dim"
                        : "text-text-muted")
                    }
                  >
                    {row.gridgammaX}
                  </td>
                  <td className="px-3 py-3 text-text-secondary">
                    {row.budget}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-5 font-mono text-[12px] text-text-muted">
          <a
            href="/bench"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            Re-run the comparison → /bench
          </a>
        </p>
      </div>
    </section>
  );
}

import type { CSSProperties } from "react";

interface Blob {
  readonly top: string;
  readonly side: "left" | "right" | "center";
  readonly offset: string;
  readonly size: number;
  readonly color: string;
}

// Six-blob narrative arc: cool → cold → cyan → amber → amber → cyan.
// Each blob anchors a specific section's emotional beat. The cool→warm→cool
// shape mirrors the page-gradient base from Phase 2.A.
//
// Tuning: scroll `top:` values are first-pass estimates derived from the
// section-height table in docs/superpowers/specs/2026-05-01-website-phase-2b-design.md §3.
// To re-tune after a section's height changes:
//   1. Boot dev: `pnpm --filter @pretable/app-website dev`
//   2. In DevTools console, run for each section:
//        document.querySelector('section h2')
//          ?.closest('section')
//          ?.getBoundingClientRect();
//      Record the top + height.
//   3. Recompute cumulative tops (Hero start + Hero height + Playground height + ...).
//   4. Adjust the `top:` values below to bleed into their target sections.
const BLOBS: readonly Blob[] = [
  // ① cyan / hero / cool entry
  {
    top: "40px",
    side: "left",
    offset: "-120px",
    size: 320,
    color: "rgba(56, 189, 248, 0.14)",
  },
  // ② indigo / problem / cold beat (only indigo on the page)
  {
    top: "1300px",
    side: "right",
    offset: "-100px",
    size: 360,
    color: "rgba(99, 102, 241, 0.12)",
  },
  // ③ cyan / solution / cyan answer
  {
    top: "1900px",
    side: "left",
    offset: "-80px",
    size: 300,
    color: "rgba(56, 189, 248, 0.16)",
  },
  // ④ amber / receipts + comparison / proof opens
  {
    top: "2400px",
    side: "center",
    offset: "-200px",
    size: 400,
    color: "rgba(245, 158, 11, 0.10)",
  },
  // ⑤ amber / features + code / proof continues
  {
    top: "3300px",
    side: "right",
    offset: "-80px",
    size: 360,
    color: "rgba(245, 158, 11, 0.08)",
  },
  // ⑥ cyan / cta / cool crescendo (peak alpha)
  {
    top: "4200px",
    side: "center",
    offset: "-180px",
    size: 360,
    color: "rgba(56, 189, 248, 0.18)",
  },
];

function blobStyle(blob: Blob): CSSProperties {
  const positionStyle: CSSProperties = { top: blob.top };
  if (blob.side === "left") positionStyle.left = blob.offset;
  if (blob.side === "right") positionStyle.right = blob.offset;
  if (blob.side === "center") {
    positionStyle.left = "50%";
    positionStyle.transform = `translateX(calc(-50% + ${blob.offset}))`;
  }
  return {
    ...positionStyle,
    width: blob.size,
    height: blob.size,
    background: `radial-gradient(circle at center, ${blob.color}, transparent 70%)`,
    filter: "blur(40px)",
  };
}

/**
 * Page-level ambient layer: six absolute-positioned, heavily-blurred
 * radial-gradient blobs at scroll-height milestones. Sits at -z-40 behind
 * everything else; sections render on top. aria-hidden + pointer-events:
 * none keep this out of a11y and interaction trees.
 *
 * Layout: parent div spans the full body (`absolute inset-0`); each blob
 * positions itself within using its own `top:` and side anchoring.
 */
export function LandingAmbient() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-40 overflow-hidden"
    >
      {BLOBS.map((blob, idx) => (
        <div
          key={idx}
          className="absolute rounded-full"
          style={blobStyle(blob)}
        />
      ))}
    </div>
  );
}

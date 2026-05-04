import type { ReactNode } from "react";

export interface PipelineLayer {
  num: string;
  name: string;
  responsibility: string;
  bullets: readonly ReactNode[];
  output: string;
  pkg: string;
  /** Core stage hint — used by HowItWorks for the dot+glow on the number column. */
  core: boolean;
}

export const LAYERS: readonly PipelineLayer[] = [
  {
    num: "01",
    name: "Source",
    responsibility: "Streaming patches and static rows treated identically.",
    bullets: [
      "Token-by-token patches via SSE, WebSocket, or any async iterable",
      "Static Row[] arrays use the same input shape",
      'No "streaming mode" toggle — adapters convert both to engine input',
    ],
    output: "Row[] | Patch",
    pkg: "stream-adapter",
    core: false,
  },
  {
    num: "02",
    name: "Engine",
    responsibility: "Pure reducer. Sort, filter, selection, row-id stability.",
    bullets: [
      "(rows, columns, sort, filter, selection) → Snapshot",
      "Deterministic — same inputs always produce the same output, every frame",
      "Row-id keys are first-class — selection survives filters, sorts, and live patches",
      "Under 3,000 lines. Read it end-to-end in one sitting.",
    ],
    output: "Snapshot",
    pkg: "grid-core",
    core: true,
  },
  {
    num: "03",
    name: "Viewport",
    responsibility:
      "Row-height plan + virtualization range. Off-DOM measurement.",
    bullets: [
      "Wrapped row heights computed with character-width tables and font metrics — pure arithmetic",
      "No getBoundingClientRect, no forced reflow, no measure-on-mount",
      "Virtualization range derived from scroll position + total planned height",
      "Off-screen rows excluded from the plan — no phantom DOM",
    ],
    output: "RenderPlan",
    pkg: "layout-core + text-core",
    core: true,
  },
  {
    num: "04",
    name: "Renderer",
    responsibility: "The only stage that touches the DOM.",
    bullets: [
      "Diffs the previous RenderPlan against the new one",
      "Patches affected rows; reuses unchanged DOM nodes",
      "Selection, sort indicators, filter chips all data-driven from the snapshot — no imperative state",
    ],
    output: "Element[]",
    pkg: "renderer-dom",
    core: false,
  },
  {
    num: "05",
    name: "Frame",
    responsibility: "RAF coalesces patches per animation frame.",
    bullets: [
      "100 to 25,000 patches/sec all collapse to one snapshot per frame",
      "Long tasks: zero across the operating envelope",
      "Selection, cursor, scroll position never lost mid-frame",
    ],
    output: "60fps",
    pkg: "browser",
    core: false,
  },
];

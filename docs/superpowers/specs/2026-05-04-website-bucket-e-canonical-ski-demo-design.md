# Website Bucket E — Canonical hero demo (ski racing) + streaming-demo removal

Date: 2026-05-04
Status: design (pre-implementation)

## Background

The homepage `<HeroGrid>` currently streams a synthetic multilingual event log (kind / message / status / latency) via a hardcoded `eventLog.ts` array and a rate-only replay engine. The wedge claims it should demonstrate — `applyTransaction.update` patches survive selection, multi-line wrapped content streams token-by-token, parseElementStream is the canonical entry point — are not actually shown.

A separate Vite SPA at `apps/streaming-demo/` (the "Bloomberg-style stock ticker replay") demonstrates the full update model, but it's not deployed anywhere — it lives only as reference code reachable via a GitHub link. That split has two costs: visitors never see the full streaming story, and the canonical demo for the marketing wedge is structurally divorced from the site.

This spec consolidates both: the homepage hero becomes the **single canonical streaming demo**, and `apps/streaming-demo/` is deleted entirely.

The demo content also pivots from the synthetic event log to **live ski racing telemetry** — Giant Slalom from Mt. Bachelor (Bend, OR — the company's home turf). Brand alignment with the existing Alpenglow palette + MountainFooter + TrailMarker components. The marketing copy stays AI-era ("Hybrid C" from the brainstorm — hero demo is ski racing; CodeExample tabs and `/docs/streaming/*` recipes stay LLM-focused).

## Goals

1. Replace the synthetic event-log hero with a ski-racing live-timing demo that demonstrates four concurrent update shapes (split-time fill, status flip, leaderboard re-rank, commentary token streaming).
2. Use `parseElementStream` from the public `@pretable/stream-adapter` API for the phase-1 starting-list fill — make the marketing demo align with what `/docs/streaming/parsers` preaches.
3. Add an inside-bezel right sidebar containing a stylized course visualization (SVG side-elevation with timing-gate ticks and animated dots tracking each in-flight racer).
4. Replace the four-tier rate envelope (LIGHT / PRODUCTION / HEAVY / EXTREME at 250 / 1k / 5k / 25k ev/s) with a three-tier human-comprehensible envelope (LIGHT / PRODUCTION / HEAVY at 10 / 60 / 250 ev/s). The 25k claim stays — backed by `/bench`, not the homepage hero.
5. Delete `apps/streaming-demo/` entirely and sweep all references.

## Non-goals

- A picker / multiple demo scenarios on the homepage. Single ski-racing demo is canonical for now; a future bucket can introduce a picker.
- Migration of `apps/streaming-demo`'s parser-AST inspector or recent-events panel content into the new sidebar. The sidebar is a course visualization only — the inspector panels are dropped along with the streaming-demo source.
- New tokens, palette additions, drawer-mechanic changes, HeroGrid bezel changes, or any modifications to the marketing copy outside the rate-envelope label set in `<TopControlBar>`.
- Real-time WebSocket / SSE / actual streaming source. The demo plays a checked-in deterministic recording; live mode is a future bucket if ever.
- Custom cell renderers + CSS class-based flash animations on delta/status changes. Explicitly future-extension (see §10).

## 1. Streaming-demo removal

### Files to delete

The entire `apps/streaming-demo/` directory: 30 files, including the Vite app, recordings (516KB phase1 + 3.6MB phase2), Bloomberg theme, capture scripts, and tests.

### Workspace consumers to sweep

Search the repo for `streaming-demo` references and update each. Expected (verify with grep before editing):

- `pnpm-workspace.yaml` — drop the workspace entry if the directory was explicitly listed
- `pnpm-lock.yaml` — auto-updated by `pnpm install`
- `apps/website/app/components/CodeExample.tsx` — the "Full example: apps/streaming-demo" link in the section footer. Change to point at `/docs/streaming` (the docs we shipped in Bucket D) or remove the link entirely.
- `apps/website/app/docs/getting-started/page.mdx` — references `apps/streaming-demo` as working code. Update to point at the new HeroGrid replay engine source path or `/docs/streaming`.
- `apps/website/app/docs/getting-started/concepts/page.mdx` — same.
- `apps/website/app/docs/streaming/element-streams/page.mdx` — if any "see apps/streaming-demo" links exist (Bucket D's docs were authored before this decision).
- `.github/workflows/*.yml` — verify no CI step references `streaming-demo` (the existing workflows run repo-wide tests; check `--filter` patterns).
- `tsconfig.json` references / project references at the root if any.

### Changeset

Not required — `apps/streaming-demo` was always private (`private: true` in its `package.json`), so removing it has no npm-publication impact. The deletion is a no-op for external consumers.

## 2. Hero data shape — ski racing

### Row type

Replace `HeroEvent` in `apps/website/app/components/heroGrid/eventLog.ts` (or its successor) with:

```ts
export interface RaceRow extends Record<string, unknown> {
  /** Stable row id; matches `bib` for race rows, `tel-{n}` for telemetry rows at HEAVY tier. */
  id: string;
  /** Bib number — 1..30 for race rows, "—" for telemetry rows. */
  bib: number | "—";
  /** Racer display: "Marco Odermatt 🇨🇭" — flag is a Unicode emoji. */
  racer: string;
  /** Intermediate split times in mm:ss.cc format. Empty until racer crosses the gate. */
  gate1: string;
  gate2: string;
  gate3: string;
  /** Final run time. Empty until racer finishes. */
  finish: string;
  /** Signed delta to current leader: "+0.32" / "-0.04" / "LEADER". Empty until racer finishes. */
  delta: string;
  /** Lifecycle: "dns" → "running" → "finished" / "DNF" / "DSQ". */
  status: "dns" | "running" | "finished" | "DNF" | "DSQ";
  /** Race commentary; multiline; streams in token-by-token at PROD+ tiers. */
  notes: string;
}
```

### Column definitions (9 columns)

Module-level constant in the new `apps/website/app/components/heroGrid/raceColumns.ts`:

```ts
import type { PretableColumn } from "@pretable/react";
import type { RaceRow } from "./types";

export const raceColumns: PretableColumn<RaceRow>[] = [
  { id: "bib", header: "Bib", widthPx: 50, pinned: "left" },
  { id: "racer", header: "Racer", widthPx: 180 },
  { id: "gate1", header: "G1", widthPx: 70 },
  { id: "gate2", header: "G2", widthPx: 70 },
  { id: "gate3", header: "G3", widthPx: 70 },
  { id: "finish", header: "Finish", widthPx: 90 },
  { id: "delta", header: "Δ", widthPx: 90 },
  { id: "status", header: "Status", widthPx: 100 },
  { id: "notes", header: "Notes", widthPx: 280, wrap: true },
];
```

Total declared width = 1000px. Bezel interior is `max-w-[1400px]` minus 300px sidebar minus padding ≈ 1080px usable, so the grid fits without horizontal scroll at desktop. At narrower widths the existing `gridFrame` overflow-x scroll absorbs it.

### Status enum

5 values matching FIS Live Timing conventions:

| Value      | Color token                        | Meaning                                                      |
| ---------- | ---------------------------------- | ------------------------------------------------------------ |
| `dns`      | `text-text-dim`                    | Did not start — placeholder before the racer leaves the gate |
| `running`  | `text-accent` (warm orange)        | On course                                                    |
| `finished` | `text-emerald` or token equivalent | Crossed the line                                             |
| `DNF`      | `text-red`                         | Did not finish (skied out, missed gate)                      |
| `DSQ`      | `text-red`                         | Disqualified (post-race)                                     |

The grid renders the status as a colored chip via `renderBodyCell` (out of scope for this bucket — text rendering is fine for now; chip styling is part of §10 future-extension).

## 3. Update model — four concurrent patch shapes

All four shapes hit the same `applyTransaction({ add?, update?, remove? })` interface on the engine. Each demonstrates a distinct slice of the wedge.

### Shape 1 — Split-time fill (sequential per racer)

When a `running` racer crosses gate 1: `applyTransaction.update([{ id: "r-014", gate1: "14.32" }])`. Same for gate 2, gate 3, and finish (which also flips status). Five sequential one-field patches per racer over the racer's ~12s descent.

Selection-survives test: select racer #14's row before they leave the gate; their splits arrive without disturbing the selection.

### Shape 2 — Status flip + finish settle

At finish-line crossing: `applyTransaction.update([{ id: "r-014", finish: "1:17.84", status: "finished", delta: "+0.12" }])`. Single multi-field patch per racer.

For DNF / DSQ: `applyTransaction.update([{ id: "r-014", status: "DNF", notes: "Out at gate 7" }])`. No finish or delta filled.

### Shape 3 — Cross-row leaderboard re-rank

When a new fastest time posts (e.g. racer #14 finishes at `1:17.72`, faster than the prior leader's `1:17.84`):

```ts
applyTransaction.update([
  { id: "r-014", delta: "LEADER" }, // new leader
  { id: "r-027", delta: "+0.12" }, // previous leader, now +0.12
  { id: "r-003", delta: "+0.32" }, // previously +0.20, now +0.32
  // ... all other finished rows updated with new delta
]);
```

One batch of N patches where N = count of currently-finished rows. This is the most compelling selection-survives demo: with racer #27's row selected, watch the delta chip update under the selection without losing focus or scroll position.

Frequency: ~3–8 leaderboard re-ranks across the 2-minute race (one per new leader).

### Shape 4 — Commentary token streaming (PROD+ tiers only)

When a racer finishes with a notable run, the notes column receives a stream of partial-string updates: `"Aggressive line"` → `"Aggressive line through gate 3, "` → `"Aggressive line through gate 3, lost time on the "` → `"Aggressive line through gate 3, lost time on the final pitch."`

Each chunk is a `applyTransaction.update([{ id, notes: <growing string> }])`. ~10–30 patches per commentary, matching the rate envelope.

This is the `wrap: true` column demo. Visible at PRODUCTION (60 ev/s) and HEAVY (250 ev/s); skipped at LIGHT (10 ev/s) where there isn't budget.

### Optional Shape 5 — Synthetic course telemetry (HEAVY tier only)

At HEAVY (250 ev/s), the engine synthesizes additional rows from a seeded PRNG: course-sensor readings (gate timing, wind speed, snow temperature, gate spacing). Each row has `bib: "—"`, distinct id (`tel-001`, `tel-002`, …), `op`-equivalent in the `racer` column (e.g. "Sensor: gate 4 wind"), and `notes` containing the reading. Rows append continuously and never update (one-shot adds via `applyTransaction.add`).

Telemetry rows mix into the same grid as race rows. They scroll past quickly at HEAVY tier, demonstrating the volume claim. They're not in the recording — synthesized at runtime from a seed when the user picks HEAVY.

## 4. Replay engine + recording

### Recording: `apps/website/app/components/heroGrid/recordings/race.jsonl`

Deterministic JSON-stream-formatted recording, baked at build time by a sibling script. Two phases:

**Phase 1 — starting list (parseElementStream demo)**

Phase-1 entries are OpenAI Responses-format SSE deltas, mirroring streaming-demo's pattern. The full content is a JSON array of 30 racer objects:

```json
[
  {"id":"r-001","bib":1,"racer":"Marco Odermatt 🇨🇭","status":"dns","gate1":"","gate2":"","gate3":"","finish":"","delta":"","notes":""},
  {"id":"r-002","bib":2,"racer":"Henrik Kristoffersen 🇳🇴","status":"dns",…},
  …
]
```

Streamed as ~150–200 `response.output_text.delta` events of 8–30 chars each, each tagged with a virtual time `t` (seconds from start). Phase 1 takes ~3 seconds at PROD rate.

```jsonl
{"t":0.5,"type":"response.created"}
{"t":1.004,"type":"response.output_text.delta","delta":"[{\"id\":"}
{"t":1.012,"type":"response.output_text.delta","delta":"\"r-001\",\"bib\""}
…
{"t":3.84,"type":"response.completed"}
```

The replay engine pipes these into `parseElementStream` from `@pretable/stream-adapter`. As each row's JSON object closes, it appears in the grid. Estimated phase-1 size: **~30KB raw, ~6KB gzipped**.

**Phase 2 — race events**

Each entry is a transaction batch with virtual time:

```jsonl
{"t":4.10,"type":"add","rows":[/* none in narrative phase 2 — racers all exist by now */]}
{"t":4.10,"type":"update","patches":[{"id":"r-001","status":"running","notes":"Out of the gate"}]}
{"t":5.42,"type":"update","patches":[{"id":"r-001","gate1":"14.32"}]}
{"t":6.48,"type":"update","patches":[{"id":"r-001","gate2":"27.81"}]}
{"t":8.10,"type":"update","patches":[{"id":"r-005","status":"running"}]}
{"t":8.20,"type":"update","patches":[{"id":"r-001","gate3":"42.05"}]}
{"t":11.92,"type":"update","patches":[{"id":"r-001","finish":"1:18.84","status":"finished","delta":"LEADER"}]}
…
{"t":13.40,"type":"commentary","patches":[{"id":"r-001","notes":"Aggressive"}]}
{"t":13.45,"type":"commentary","patches":[{"id":"r-001","notes":"Aggressive line"}]}
…
```

Race narrative entries (split fills, status flips, leaderboard re-ranks, commentary) total ~3,000 events over ~120 seconds. Estimated phase-2 size: **~150KB raw, ~25KB gzipped** (commentary tokens dominate).

### Generator script: `apps/website/app/components/heroGrid/scripts/generate-race.ts`

Runs at build time (or `pnpm generate:race`). Seeded PRNG (`0xC0FFEE` for parity with streaming-demo). Produces:

- 30 racers (deterministic name list with country flags)
- Staggered starts: racer N leaves the gate at `t = 4 + 4*N` seconds (overlapping descents, 2–3 simultaneously on course)
- Each racer's run is ~12 seconds (real-life ~80s × 7× compression)
- Splits sampled from a normal distribution around the racer's "skill" (stable per-bib seed)
- ~5% DNF rate, ~1% DSQ rate
- ~30% chance of a commentary stream per finishing racer
- Leaderboard re-rank events emitted whenever the new finish time beats the current leader

Output: `recordings/race.jsonl`. Determinism verified by re-running and asserting byte-identical output (script's pretest).

### `replay-engine.ts` (rewrite of streaming-demo's engine, adapted)

Lives at `apps/website/app/components/heroGrid/replay-engine.ts`. Public surface roughly:

```ts
export interface RaceReplayOptions {
  recording: string; // raw text of race.jsonl
  ratePerSec: 10 | 60 | 250; // current rate envelope tier
  isPlaying: boolean;
  onTransaction: (tx: { add?: RaceRow[]; update?: Partial<RaceRow>[] }) => void;
}

export interface RaceReplay {
  setRate(rate: 10 | 60 | 250): void;
  setPlaying(playing: boolean): void;
  /** Synthesizes telemetry rows for the HEAVY tier. */
  startTelemetrySynthesis(): void;
  stopTelemetrySynthesis(): void;
  dispose(): void;
}
```

Internals: parses phase 1 via `parseElementStream` from `@pretable/stream-adapter`, schedules phase 2 events at virtual-time rate (scaled by `ratePerSec` from playback baseline). Loops: at end of recording, rewinds to t=0, regenerates fresh row IDs (`r-001` collides won't happen because the previous race's rows scroll out of the visible buffer first).

The engine deliberately does NOT use `connectElementStream` for phase 1 because the recording's phase-1 entries are SSE-shaped (events with `type` discriminator), not raw row chunks. It uses `parseElementStream(asyncIterableOfJsonChunks)` to materialize rows, then routes each row to `onTransaction({ add: [row] })` itself. This matches the documented pattern in `/docs/streaming/parsers`.

### HeroGrid integration

`apps/website/app/components/HeroGrid.tsx` becomes:

```tsx
"use client";
import { Pretable } from "@pretable/react";
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { useControlState } from "./heroGrid/controlState";
import { createRaceReplay } from "./heroGrid/replay-engine";
import { raceColumns } from "./heroGrid/raceColumns";
import { CourseVisualization } from "./heroGrid/CourseVisualization";
import recordingText from "./heroGrid/recordings/race.jsonl?raw"; // Vite/Next raw import
import type { RaceRow } from "./heroGrid/types";
import styles from "./heroGrid/heroGrid.module.css";

const FALLBACK_VIEWPORT_HEIGHT = 520;
const VISIBLE_BUFFER_ROWS = 200;

export function HeroGrid() {
  const { ratePerSec, isPlaying } = useControlState();
  const [rows, setRows] = useState<RaceRow[]>([]);
  // ResizeObserver-driven viewportHeight (existing pattern from Bucket B)
  // ... omitted — same structure as today's HeroGrid

  useEffect(() => {
    const replay = createRaceReplay({
      recording: recordingText,
      ratePerSec,
      isPlaying,
      onTransaction: (tx) => {
        // Apply tx to local rows state via batched setRows
        // ... details in implementation plan
      },
    });
    return () => replay.dispose();
  }, []); // mount-once

  return (
    <section className={`hero ${styles.heroBackdrop}`}>
      <div className={styles.heroBezel} data-testid="hero-bezel">
        <div className={styles.heroSplit}>
          <div className={styles.heroSurface}>
            <Pretable<RaceRow>
              ariaLabel="Live ski racing"
              columns={raceColumns}
              getRowId={(row) => row.id}
              rows={rows}
              viewportHeight={viewportHeight}
            />
          </div>
          <div className={styles.heroSidebar}>
            <CourseVisualization rows={rows} />
          </div>
        </div>
      </div>
    </section>
  );
}
```

Key shifts from current HeroGrid:

- Different replay engine, different recording, different row shape
- Bezel gains a `.heroSplit` flexbox child with `.heroSurface` + `.heroSidebar` panes
- The `.heroSurface` ResizeObserver now measures the smaller area (1080px - 300px sidebar - dividers ≈ 770px wide on desktop)
- Sidebar is hidden via `display: none` at `<md` breakpoint

## 5. Course visualization sidebar

### Component: `<CourseVisualization>` (new, server-renderable but receives client state)

`apps/website/app/components/heroGrid/CourseVisualization.tsx`. Pure SVG side-elevation course diagram. Receives `rows: RaceRow[]` from parent and derives positions for in-flight racers.

### SVG layout

- Viewbox: 100 × 600 (10:60 aspect, vertical)
- Background: stylized snowy slope as a single curved path filled with `var(--pt-bg-card)` (cream)
- Course line: cobalt (`var(--pt-accent-deep)` or similar) curving from top to bottom in shallow S-curves (suggesting GS turns)
- 5 horizontal gate ticks: G1 at y=120, G2 at y=240, G3 at y=360, G4 at y=460, FIN at y=560
- Each gate gets an inline `TrailMarker` icon at the right edge (existing component, variants: `green` / `blue` / `black`). For GS the spec uses `blue` for all gates (denotes intermediate difficulty); customize per-bucket if interesting.
- Start gate at top: small flag icon + "START" label

### Racer dots

For each row where `status === "running"`, derive a `cy` position from gate-progress:

- Has `gate1` set and not `gate2`: position between G1 and G2
- Has `gate2` set and not `gate3`: position between G2 and G3
- Has `gate3` set and not `finish`: position between G3 and FIN
- Started but no `gate1` yet: position between START and G1

Within each bracket, interpolate using elapsed wall-clock time since the gate above was crossed (the engine exposes per-row `gateCrossedAt` timestamps — added as a sibling field outside the row data, kept in the engine's state).

Each dot is a `<circle r="6">` filled with a bib-number-derived color (deterministic mapping). Current leader gets a 2px accent-orange ring around their dot. Finished racers' dots fade out over 800ms via CSS opacity transition; DNF dots turn red and stay (they'll disappear at next race loop).

### CSS animation

Each dot has `transition: cy 1.6s linear` so motion between gates is smooth (1.6s = ~80ms latency at PROD's 60 ev/s × ~20 ticks per gate-to-gate). When the rate envelope changes, the transition duration scales: LIGHT 8s, PROD 1.6s, HEAVY 0.4s.

### Dimensions + responsive

- Desktop (md+): inside-bezel split, sidebar fixed 300px wide, full-height of bezel interior
- Tablet (sm-md): sidebar collapsed (`display: none`); grid takes full bezel width
- Mobile (<sm): same as tablet — no overlay, no toggle button. The grid alone is the experience.

### Tests

`apps/website/__tests__/components/heroGrid/CourseVisualization.test.tsx`:

- Renders the SVG root with `data-testid="course-viz"`
- Renders 5 gate ticks with labels (G1, G2, G3, G4, FIN)
- Given `rows` with one `running` racer: renders one dot
- Given `rows` with two `running` and one `finished`: renders two dots (finished excluded after fade — accept either visible-with-opacity-0 or unmounted)
- Given a row marked `LEADER` in delta: that dot has the accent ring class

## 6. Rate-envelope tier change in `<TopControlBar>`

### Tier values

`apps/website/app/components/heroGrid/controlState.tsx` — change the `RateTier` type:

```ts
export type RateTier = 10 | 60 | 250;
```

Default value drops from `1000` → `60` (PRODUCTION).

### TopControlBar tier list

`apps/website/app/components/TopControlBar.tsx` — `TIERS` constant:

```ts
const TIERS: { value: RateTier; label: string }[] = [
  { value: 10, label: "Light" },
  { value: 60, label: "Production" },
  { value: 250, label: "Heavy" },
];
```

The "Extreme" tier and its label are dropped. The `25k/s` claim is preserved in copy on `/bench` and `/docs/streaming` — not on the homepage hero.

### Eyebrow / metric labels

Optional: change `pretable.ai · events.stream` eyebrow to `pretable.ai · live.race-feed` or similar to frame the demo as live ski timing. The `9.3 ms p95` metric copy can stay generic — it doesn't tie to demo content. Open question — propose `pretable.ai · live.race-feed` and revisit if the framing reads as too cute.

## 7. Tests

### New tests

- `CourseVisualization.test.tsx` — see §5
- `replay-engine.test.ts` — phase-1 parsing + phase-2 dispatch + rate-tier scaling + telemetry synthesis at HEAVY
- `raceColumns.test.ts` — column shape sanity (9 columns; bib pinned left; notes wrap:true)
- `generate-race.test.ts` (run as part of build pipeline) — re-running the script produces byte-identical `race.jsonl`

### Updated tests

- `HeroGrid.test.tsx` — assertions about row count + streaming behavior shift to ski-racing domain. Existing bezel structural test stays. The "renders synthetic events" assertion gets replaced with "renders ski-racing rows after replay tick." The earlier ResizeObserver/jsdom-fallback test stays valid (no behavior change there).
- `controlState.test.tsx` — `RateTier` type changed; default value changed. Update any tests asserting on `1000` or the EXTREME tier.
- `TopControlBar.test.tsx` — TIERS array length changed from 4 to 3; label assertions updated.

### Deleted tests

All of `apps/streaming-demo/src/*.test.ts` go away with the directory.

## 8. File structure (delta)

**Create:**

- `apps/website/app/components/heroGrid/types.ts` — `RaceRow` interface (rename / repurpose existing `eventLog.ts` interface; keep file path or move)
- `apps/website/app/components/heroGrid/raceColumns.ts`
- `apps/website/app/components/heroGrid/replay-engine.ts`
- `apps/website/app/components/heroGrid/recordings/race.jsonl` (generated, checked-in)
- `apps/website/app/components/heroGrid/scripts/generate-race.ts`
- `apps/website/app/components/heroGrid/CourseVisualization.tsx`
- `apps/website/__tests__/components/heroGrid/CourseVisualization.test.tsx`
- `apps/website/app/components/heroGrid/__tests__/replay-engine.test.ts`
- `apps/website/app/components/heroGrid/__tests__/raceColumns.test.ts`
- `apps/website/app/components/heroGrid/scripts/generate-race.test.ts`

**Modify:**

- `apps/website/app/components/HeroGrid.tsx` — rewrite to use `replay-engine` + `raceColumns` + `<CourseVisualization>`; bezel gains split-pane child layout
- `apps/website/app/components/heroGrid/heroGrid.module.css` — add `.heroSplit` (flex row), `.heroSidebar` (300px width, `display: none` on small viewports), tweak `.heroSurface` (no longer `flex: 1 1 auto` standalone — now flex child of `.heroSplit`)
- `apps/website/app/components/heroGrid/controlState.tsx` — `RateTier` type to `10 | 60 | 250`; default to `60`
- `apps/website/app/components/TopControlBar.tsx` — TIERS array (3 entries); optional eyebrow copy change
- `apps/website/app/components/heroGrid/__tests__/controlState.test.tsx` — assertions for new tier values
- `apps/website/app/components/__tests__/HeroGrid.test.tsx` — assertions for ski-racing domain
- `apps/website/app/components/CodeExample.tsx` — drop the "apps/streaming-demo" footer link, point at `/docs/streaming` or remove
- `apps/website/app/docs/getting-started/page.mdx` — update streaming-demo references
- `apps/website/app/docs/getting-started/concepts/page.mdx` — same

**Delete:**

- `apps/streaming-demo/` (entire directory, ~30 files)
- `apps/website/app/components/heroGrid/eventLog.ts` (replaced by recording-based replay)
- `apps/website/app/components/heroGrid/replay.ts` (replaced by `replay-engine.ts`)
- `apps/website/app/components/heroGrid/__tests__/replay.test.ts` (replaced by `replay-engine.test.ts`)

**Won't touch:** `packages/*`, drawer mechanics, DrawerHero, CredibilityCards, ReceiptsBand, ComparisonTable, HowItWorks, PipelineDiagram, CodeTabs, FeatureGrid, CtaSection, MountainFooter, StreamingByDesign, all `/docs/*` outside the two getting-started page references.

## 9. Migration / breaking-change risk

- **External consumers:** none — `apps/streaming-demo` was always private; the homepage hero is internal-only.
- **CI:** the streaming-demo's `pnpm --filter @pretable/app-streaming-demo test` step disappears from the test command's auto-discovery (recursive across workspaces). Verify the CI workflow doesn't hardcode the streaming-demo filter; if it does, update.
- **Docs:** two getting-started pages mention `apps/streaming-demo`. Updated in this PR.
- **Recording size:** ~25KB gzipped added to homepage page-weight. Acceptable.

## 10. Future-extension surface (out of scope this bucket)

The design deliberately leaves room for these without re-architecting:

1. **Custom cell renderers via `renderBodyCell`** — already a `<Pretable>` prop. Future: render the `status` column as a colored chip, the `delta` column with an arrow icon, the `notes` column with monospace styling.
2. **CSS class-based flash animations on patch.** For example: when the `delta` value moves toward `LEADER`, briefly add `.cell-delta-up` (green flash, fade over 600ms); moving away, `.cell-delta-down` (red flash). This is the streaming-demo's stock-ticker cell-up / cell-down pattern. Requires a small mechanism to diff prev-vs-next cell value in `renderBodyCell` or a dedicated flash-on-update wrapper. Add when the cell-renderer story is built.
3. **`getRowClassName` for full-row state** — fade `finished` rows to 60% opacity, brighten `running` rows. Same pattern, full row instead of cell.
4. **Picker for multiple demo scenarios** — the bucket-D-deferred picker. Could later reintroduce stock ticker / agent traces / observability stream as alternates. The current canonical demo machinery (replay engine, recording shape, row type) is generic enough to host other recordings if we add a small column-set/recording-set abstraction.
5. **Live source mode** — bypass the recording, attach to a real WebSocket / SSE feed. The replay engine's `onTransaction` callback already represents the abstract input — swap the source easily.

## 11. Implementation order (preview, formalized in writing-plans)

1. Add `types.ts` (RaceRow), `raceColumns.ts`, and unit tests for the column shape.
2. Build `generate-race.ts` script + the `race.jsonl` recording. Verify determinism. Check the file in.
3. Build `replay-engine.ts` with phase-1 parseElementStream + phase-2 dispatch. Tests: parse a tiny inline recording, verify rows materialize, verify rate-tier dispatch works.
4. Add HEAVY-tier telemetry synthesis. Tests: enable HEAVY, verify telemetry rows appear; disable HEAVY, verify they stop.
5. Build `<CourseVisualization>` SVG component. Tests: structural + dot rendering.
6. Update `controlState.tsx` (RateTier type + default).
7. Update `TopControlBar.tsx` (TIERS array + optional eyebrow copy).
8. Rewrite `HeroGrid.tsx` to use the new engine + columns + sidebar; update its tests + CSS module.
9. Sweep `apps/website/app/components/CodeExample.tsx` and the two getting-started MDX pages; remove streaming-demo references.
10. Delete `apps/streaming-demo/` directory.
11. Run `pnpm install` (lockfile updates), full test suite, full typecheck.
12. Manual Chrome MCP verification at `/` (race plays, sidebar shows, rate tiers cycle, no console errors).
13. Push, open PR, watch CI, merge on green, verify production.

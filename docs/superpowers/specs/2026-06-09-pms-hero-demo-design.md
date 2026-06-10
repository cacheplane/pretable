# PMS Hero Demo — Design

**Date:** 2026-06-09
**Status:** Approved (brainstorm), pending implementation plan
**Scope:** Homepage hero example + adjacent copy + README/positioning reconciliation

## Problem

The homepage hero is a "Live ski racing" leaderboard. It proves streaming
throughput but mismatches Pretable's actual positioning and hides its real
differentiator:

- The hero copy sells **speed/streaming**; the README sells **messy, text-heavy
  AI data** ("transcripts, eval results, support queues, tool-call logs… where
  fixed-height rows break down"). The ski race is neither.
- A streaming-numbers demo is the one shape where *every* grid looks good. It
  does not showcase Pretable's wedge: **wrapped text + variable row heights**.

We want a single example that is (a) instantly credible, (b) natively
streaming, and (c) proves the wrapped-text/variable-height wedge — so the demo
earns the "built for the AI era" claim instead of asserting it.

## Decision

Replace the ski-racing hero with a **buy-side portfolio-manager (PMS)
cockpit**: a live positions grid that does two things at once.

1. **Numbers tick.** Prices and P&L update at high frequency and flash
   green/red — the most recognizable, credible streaming demo on the web
   (this is AG Grid's flagship blotter). Proves speed/streaming.
2. **An agent writes.** An **AI Analyst** column streams wrapped commentary
   per holding (risk flags, news-driven rationale, rebalance suggestions),
   token-by-token. Rows become **different heights** — tight numeric cells
   beside multi-line prose. Proves the wrapped-text/variable-height wedge that
   incumbents handle worst.

The same demo proves both stories. This is the "AI-era PMS" no incumbent grid
ships.

### Why this over the alternatives

- **Pure blotter (no AI column):** more "real PMS," but it is incumbents' home
  turf and hides Pretable's wedge. Rejected.
- **Agent-builds-a-table on docs/evals/research/support:** strong AI story but
  less instantly credible and less visually striking than live finance.
- **Keep ski racing:** contrived; mountain metaphor doesn't map to any buyer.

## Architecture

The current hero already implements exactly the engine we need; we repurpose
it rather than rebuild. Today's flow (`app/components/heroGrid/`):

- **Phase 1 — element stream.** An LLM-style token stream
  (`response.output_text.delta` deltas carrying JSON) is parsed by
  `parseElementStream` from `@pretable/stream-adapter` to emit initial rows.
- **Phase 2 — rAF virtual clock.** Timestamped `update`/`rerank`/`commentary`
  events are drained on a `requestAnimationFrame` loop and applied as row
  patches. A rate tier (10/60/250) gates event types and telemetry density.
- **Telemetry.** `useFrameStats` measures real `fps` / `p95` from rAF deltas;
  `TopControlBar` displays them. `Scoreboard` is a derived sidebar.

PMS maps onto this directly: Phase 1 assembles the book; Phase 2 `tick` events
drive price flashes; Phase 2 `commentary` events stream the analyst text.

### Data model — `PositionRow` (replaces `RaceRow`)

```ts
interface PositionRow extends Record<string, unknown> {
  id: string;          // ticker, stable row id
  symbol: string;      // "NVDA"
  name: string;        // "NVIDIA Corp"
  qty: number;         // shares held
  last: number;        // live price; flashes on update
  mktValue: number;    // derived qty * last; live
  dayPnl: number;      // signed day P&L; live
  dayPnlPct: number;   // signed day P&L %; live
  weight: number;      // % of NAV; live-ish
  sector: string;      // for allocation rollup
  analyst: string;     // AI commentary; streams token-by-token; multiline
  flag: "trim" | "hold" | "watch" | "risk"; // severity pill; may change live
}
```

### Streaming recording (deterministic, committed, offline)

No LLM calls at runtime. A generator script produces a committed recording the
replay engine plays back — same pattern as `generate-race.ts` →
`recordings/race.{jsonl,ts}`.

- **Phase 1 — book assembles.** Positions stream in as an element stream
  ("the agent builds the book"). Visible buffer ~30–40 rows; framed as a slice
  of a larger book (e.g. "142 positions").
- **Phase 2 events:**
  - `tick` — high-frequency price update; patches `last`/`mktValue`/`dayPnl`/
    `dayPnlPct`/`weight`; drives the flash animation. This is the speed proof
    and the dominant event volume.
  - `commentary` — token deltas appended to a row's `analyst` field, producing
    the "typing" effect and variable row heights. This is the wedge proof.
  - `flag` / `rerank` — occasional severity change and/or re-sort.
- **Generation:** `scripts/generate-portfolio.ts` with a **fixed seed** so the
  recording is deterministic and testable. Uses **real tickers** (public
  facts). A subtle disclaimer — "Illustrative, synthetic data — not investment
  advice" — appears in the control bar / footer of the demo.
- **Rate tiers:** keep the 3-step control mechanism; relabel to a `ticks/s`
  envelope. Tiers gate tick density (and optionally commentary density), not
  playback speed — consistent with the current engine's semantics.

### Sorting

`sort.ts` provides comparators:

- Numeric: `qty`, `last`, `mktValue`, `dayPnl`, `dayPnlPct`, `weight`.
- Text: `symbol`, `name`, `sector`.
- `analyst` not user-sortable; `flag` optionally sortable by severity.
- **Default sort:** `weight` desc (largest positions first). User column-header
  clicks override, same as today's `applySort(rows, userSort)` path.

### Components (`app/components/heroGrid/`, dir name retained)

| Today | After |
|-------|-------|
| `types.ts` (`RaceRow`) | `types.ts` (`PositionRow`) |
| `raceColumns.ts` | `positionColumns.ts` |
| `sort.ts` (race comparators) | `sort.ts` (position comparators) |
| `replay-engine.ts` (race events) | `replay-engine.ts` (tick/commentary/flag) |
| `recordings/race.{jsonl,ts}` | `recordings/portfolio.{jsonl,ts}` |
| `scripts/generate-race.ts` | `scripts/generate-portfolio.ts` |
| `Scoreboard.tsx` | `PortfolioSummary.tsx` |
| `controlState.tsx` (tiers) | same mechanism, relabeled |
| `useFrameStats.ts` | unchanged |
| `heroGrid.module.css` / `scoreboard.module.css` | PMS skin |
| `HeroGrid.tsx` | wires `PositionRow`; top-holding styling replaces leader styling |

**`PortfolioSummary` sidebar** (derived from the same row stream):

- **NAV** — sum of `mktValue`.
- **Day P&L** — sum of `dayPnl`, plus %.
- **Allocation** — sector weight bars with legend.
- **AI Alerts** — running digest of rows whose `flag` is `watch`/`risk`, with a
  "scanning N more positions" streaming line.

**Control bar** (`TopControlBar` / `HomeStreamHeader`): show
`ticks/s · fps · p95`. `fps`/`p95` remain **real measurements** (proof, not
decoration).

### Telemetry, accessibility, edge cases

- `fps`/`p95` from `useFrameStats` are unchanged and remain live measurements.
- **Reduced motion:** when `prefers-reduced-motion: reduce`, render a settled
  portfolio snapshot (no ticking/typing) — same guard the current hero uses.
- **Loop:** recording loops at end via the existing virtual-clock reset; IDs
  stay stable (tickers).
- **Row stability:** the AI Analyst column's growing text must not cause anchor
  shift or blank gaps — this is precisely the property the demo is meant to
  showcase, so it is also the primary visual correctness check.

## Copy / positioning (in scope)

- **Hero + `DrawerHero` copy:** reframe from racing → live, AI-augmented
  financial data. The existing line "designed for live data, agent output, and
  real-time telemetry" already fits; remove ski-specific framing and the
  "vol. 2 · no. 1" newspaper conceit where it ties to racing.
- **`HomeStreamHeader` / control labels:** `events/s` → `ticks/s`.
- **README:** lead the example list and "Why Pretable" with the
  financial-analyst PMS use case, kept under the existing thesis ("messy,
  high-signal data where fixed-height rows break down"). This is a positioning
  *alignment*, not a rewrite — the financial copilot is a flagship instance of
  the same thesis (live numbers + AI narrative = mixed-shape, high-signal data).

## Out of scope (follow-up)

- Mountain/trail footer theming and the full marketing-narrative re-theme
  (`MountainFooter`, `TrailMarker`, section copy beyond the hero).
- Bench `scenario-data` datasets (the demo recording is website-local).
- Any real/live market-data integration. The recording is synthetic and
  committed.

## Testing

Port the existing hero tests to the PMS domain:

- `replay-engine.test.ts` — Phase 1 assembly, Phase 2 tick/commentary draining,
  tier gating, loop reset.
- `positionColumns.test.ts` — column config.
- `sort.test.ts` — numeric/text comparators, default `weight` desc, empty/sink
  handling for streaming-in rows.
- Recording generation is deterministic (fixed seed) so fixtures are stable.
- Homepage smoke (Playwright) continues to assert the hero renders and the
  control bar shows live telemetry.

## Success criteria

- The hero shows a live positions grid: prices flash, P&L ticks, and an AI
  Analyst column types wrapped commentary, with visibly variable row heights.
- No anchor shift / blank gaps while the analyst column grows.
- `fps`/`p95` remain real measurements and stay healthy under tick load.
- Copy and README consistently tell one story; no ski-racing references remain
  in the hero or positioning.
- All ported tests pass; reduced-motion renders a static snapshot.

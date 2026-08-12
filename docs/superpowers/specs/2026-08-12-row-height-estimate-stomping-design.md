# An estimate must not replace a height we have already measured

**Date:** 2026-08-12
**Status:** design approved, not yet implemented
**Supersedes:** `2026-08-12-hero-grid-row-height-jitter-design.md`, whose hypothesis was falsified by measurement.

## Problem

The homepage hero grid jitters in Chrome while a simulated portfolio streams: rows
shift vertically, and in 32 of 154 observed transitions an inflated row pushes the
last row out of the virtual window entirely.

The jitter is not a mis-measurement. Every height the DOM measurement path produced
was correct. The spiked values were produced by the *estimator* and applied on top
of rows that had already been measured.

### Evidence

A Playwright probe against a production build, with a `MutationObserver` on
`data-pretable-row-height` and the library's own measurement calls instrumented,
recorded over 8 seconds:

- Values the measurement path produced: `63` ×140, `89` ×18, `68` ×8
- Values actually published to the DOM: `63` ×70, `66` ×62, `114` ×9, `89` ×9, `68` ×4

`66` and `114` were published 71 times and measured zero times. Both reconcile
exactly with `estimateDomRowHeight`'s arithmetic (`ROW_LINE_HEIGHT = 24`,
`ROW_CHROME_HEIGHT = 42`, `ESTIMATED_CHARACTER_WIDTH = 7`): an empty or one-line
wrapped cell gives `1×24 + 42 = 66`; 102 characters at 320px wide gives 3 lines,
`3×24 + 42 = 114`. The real DOM gives 63 / 68 / 89 (cell padding 24 + row border 1,
real line height ~21.07).

Changes arrive as pairs 3–5ms apart — the estimate is committed, then the layout
effect re-measures and corrects it. Because the estimator overshoots reality in
both of its terms, the correction is always downward and always visible.

Ruled out by measurement, not by argument: cell width (a constant 320px at spike
and revert), cell text (byte-identical across the pair), scrollbar feedback
(`clientWidth` / `scrollWidth` / `clientHeight` constant throughout), any other
cell dominating the row max, and the hero's tick-flash underline (the `last` cell
measures a flat 22px and is never the row max).

## Mechanism

While a row-model replacement is in flight, `controller.measure(ref, height)` does
not apply the measurement. It stages it (`row-layout-controller.ts`, the `measure`
entry point) for the cooperative sliced catch-up to replay later. That much is by
design and is not the bug.

The bug is the discard. On an `update` operation:

```ts
const staged = stagedMeasurements.get(identity);
if (staged !== undefined && staged.capturedRevision < revision) {
  stagedMeasurements.delete(identity);
}
```

Streaming issues an `update` for every row on every tick, so each tick discards the
staged measurement before it is ever applied. The row returns to
`hasMeasurement === false`, and the estimate gate fills it in:

```ts
if (row.kind === "data" && !root.hasMeasurement(ref) && !estimated.has(identity)) {
  estimates.push({ kind: "update", ref, index, estimatedHeight: estimate(row.row) });
}
```

The discard is defensible in isolation — the row's data changed, so the previous
measurement might be stale. What is wrong is the fallback. For a row whose content
changed by one streamed character, the best available answer is its previous
measured height: stale by one frame, wrong by a pixel or two, and corrected on the
next commit regardless. Instead it falls back to a number from a different metric
model that is wrong by 25px, always in the same direction.

## Design

**Invariant:** an estimate may only be used for a row that has *never* been
measured. A row that has been measured before falls back to what was last measured
for it.

**Change:** retain the last applied measured height per row identity, and consult
it at the estimate gate:

```ts
estimatedHeight: lastMeasuredHeights.get(identity) ?? estimate(row.row)
```

- **Eviction:** delete the entry on row `remove` operations and on controller
  dispose. The map is bounded by rows that have actually been measured, which is
  bounded by rows that have actually been rendered.
- **Deliberately untouched:** the sliced catch-up, the staging discard, and the
  scheduler. This does not fight the cooperative design; it gives it a better
  fallback while it drains.

**Tradeoff, stated:** if a row's content genuinely shrinks, the retained height
holds it tall for one frame until the DOM re-measures. That replaces a one-frame
25px error in the wrong direction with a one-frame few-pixel error, and it is
already the behaviour for rows whose measurement survives the replacement.

**Out of scope, named:** a row scrolled into view for the first time still jumps
(66 → 63 here), because it has no prior measurement to fall back on. Fixing that
means making the estimator's inputs real — see "Known follow-ups".

## Verification

The previous design in this series was falsified at its verification gate, which is
why the gate comes first again. **Nothing is implemented until step 1 passes.**

1. **Confirm the mechanism.** Instrument the `stagedMeasurements.delete` path and
   the estimate gate. Show that the delete fires once per row per tick under
   streaming, and that at the moment an estimate is chosen a retained measured
   height would have been available. If the delete does not fire, or no prior
   measurement exists at that moment, **stop and report** — the design is wrong.
2. **Unit test in `renderer-dom`** — the real proof, and deterministic: drive a
   controller through measure → replacement carrying an `update` → assert the
   published height is the retained measurement and never the estimator's value.
   No browser required.
3. **Mutation check.** Show the unit test fails when the retention map is bypassed.
   A test that passes with and without the fix proves nothing.
4. **Browser confirmation** — the probe metric already collected: estimator-valued
   publications on measured rows go to zero, and the 154-transitions-in-8s count
   collapses.

## Known follow-ups (not this change)

Both are estimator *accuracy* problems, distinct from the stomping defect, and each
needs its own design pass:

- **Real metrics.** `ROW_LINE_HEIGHT`, `ROW_CHROME_HEIGHT` and
  `ESTIMATED_CHARACTER_WIDTH` are constants calibrated against the bench app, not
  the active theme or font. The plumbing to inject real values already exists —
  `prepareText` takes `fontKey` / `averageCharWidth`, `layoutPreparedText` takes
  `lineHeightPx` / `paddingBlockPx` — and the font key currently passed
  (`"Pretable Estimate 14"`) matches none of `estimateAverageCharWidth`'s patterns,
  so it silently falls through to a 7px default.
- **Non-text content.** The estimator only walks `wrap` columns and reads the raw
  cell value, so `render` and `format` are invisible to it. In this very grid the
  tallest cell on analyst-empty rows is a custom two-line `dayPnl` renderer the
  estimator cannot see. One candidate worth exploring: derive the estimator's
  baseline from measurements already taken rather than from column metadata.

A third, smaller item: the comment at `packages/react/src/pretable-model.ts:405`
claims `defaultRowHeight` is "the same value the surface floors measured rows at,
so the two agree under every theme". The theme floor resolves to 48 here, while the
estimator's minimum for any wrapped column is 66. They do not agree for wrapped
rows under any theme.

## Explicitly not changing

The hero's `.flash` tick underline. It uses `display: inline-block` with
`padding-bottom: 1px`, which does put a decoration into layout — but the `last`
cell measures a constant 22px and is never the row max, so it contributes nothing
to this defect. Changing it now would be unmotivated churn on a demo that works.

# Hero grid row-height jitter in Chrome

**Date:** 2026-08-12
**Status:** SUPERSEDED — hypothesis falsified at the verification gate. Nothing here was implemented.
**Superseded by:** `2026-08-12-row-height-estimate-stomping-design.md`

> The verification step below ran and contradicted the hypothesis. The ticking
> `last` cell measures a constant 22px with no sub-pixel variation, and at 22px it
> is never the row max — rows sit at 63px, driven by the wrapped analyst column.
> The real defect is that `estimateDomRowHeight`'s output is applied on top of rows
> that have already been measured. Kept as a record of the gate doing its job.

## Problem

The homepage hero grid's `last` (price) column gained an animated underline that
flashes on each tick. In Chrome the grid now jitters: rows shift vertically while
the book is streaming.

The underline is drawn by `.flash` in
`apps/website/app/components/heroGrid/cells.module.css`:

```css
.flash {
  display: inline-block;
  padding: 0 1px 1px;
}
```

with an `inset 0 -2px 0` box-shadow animation, on a span remounted every tick via
`key={row.tickSeq}` (`heroGrid/positionColumns.tsx`).

`display: inline-block` plus `padding-bottom: 1px` pushes the box's bottom edge
below the text baseline, so the line box in the Last cell grows by roughly a
pixel. `@pretable/react` measures each cell's intrinsic content with a DOM
`Range`, takes the row-wide max, and `Math.ceil`s it (`packages/react/src/row-height.ts`).

## Hypothesis

`range.getBoundingClientRect()` returns viewport-relative _fractional_ geometry.
Its height depends on where the row currently sits sub-pixel-wise — Chrome lays
out in 1/64px LayoutUnits and snaps differently at different fractional offsets.
Once the underline pushes the Last cell's content height onto an integer
boundary, `Math.ceil` flips between N and N+1: the row height changes, the row
moves, the next measurement lands on the other side of the boundary, and it
oscillates.

The 60Hz driver is the measurement cache key, which includes `cell.textContent`
(`pretable-surface.tsx`, `getRowMeasurementKey`). Every price tick invalidates
the key and forces a re-measure, so the instability is re-excited continuously
instead of settling once.

If correct, this is two independent defects that collided:

1. **Library:** a row's measured height must not depend on the row's current
   sub-pixel position. It does today.
2. **Hero cell:** a 520ms decoration should not participate in layout at all.

The design fixes both. The hypothesis is unverified; verification is the first
implementation step and gates the rest.

## 1. Verification (gates everything else)

Build and serve the site per the established local recipe (`next build` +
`next start`, not `next dev`), then drive it with Playwright. For a single
ticking row, sample across ~2s of streaming:

- `data-pretable-row-height` on the row node — does the published integer
  oscillate?
- The raw fractional content height — replicate the `Range.selectNodeContents`
  measurement inline in the page and log the unrounded value each frame.

Decision rule:

| Observation                                           | Action                                    |
| ----------------------------------------------------- | ----------------------------------------- |
| Raw noise ≲0.1px, straddling an integer               | Take the **quantize** fix                 |
| Raw noise larger, or oscillation not boundary-aligned | Take the **deadband** fix                 |
| Published height does not oscillate                   | Hypothesis is wrong — stop, re-brainstorm |

The third row is a real outcome, not a formality. Do not proceed to a fix that
the data does not support.

## 2. Library fix — `packages/react`

Exactly one of the two, chosen by the verification data.

**Quantize (stateless).** In `measureCellContentHeight`
(`packages/react/src/row-height.ts`), snap the Range-measured content height to a
fixed sub-pixel grid — nearest 1/16px — before it reaches `Math.ceil`. Chrome's
LayoutUnit is 1/64px, so a 1/16px grid erases snapping noise deterministically,
with no state and no tuning knob.

**Deadband (stateful).** At the publish site in `pretable-surface.tsx` (the
layout effect that calls `measureRenderedRowHeight` and `indexedGrid.measureRow`),
retain the last _raw fractional_ measurement per row and re-publish only when the
new raw value moves more than 0.5px. The comparison is raw-vs-raw deliberately:
comparing against the rounded published height ratchets. A genuine line-count
change is roughly 18px, far outside the band.

Either way, add the invariant to the file's existing commentary:

> A row's measured height must not depend on where the row currently sits
> sub-pixel-wise.

`row-height.ts` today documents the _box-height_ feedback loop it already fixed
(cells stretch to the row height, so `scrollHeight` fed itself back). It does not
document this positional one, which is a different loop through geometry rather
than through the box.

## 3. Tests

- **Unit** — new test under `packages/react/src/__tests__/`, at the
  `measureRenderedRowHeight` boundary, with `createRange` and
  `getBoundingClientRect` stubbed to return a scripted sequence straddling an
  integer (19.98 / 20.02 / 19.99 …). Assert the published height is constant.
  jsdom has no layout engine, so this cannot be produced naturally; the function
  boundary is the honest place to pin it.
- **Mutation check** — same harness, a genuine +18px change. Assert it _does_
  publish. This is what stops the deadband from silently clipping content.
  Confirm this assertion fails when the fix is over-applied (e.g. deadband
  widened past a line height) rather than assuming it would.
- **Browser** — a spec under `apps/website/e2e/` sampling each hero row's
  `data-pretable-row-height` across streaming, asserting one distinct value per
  row. Record it failing before the fix and passing after.

## 4. Hero cell fix — `cells.module.css`

Redraw `.flash` with zero layout participation:

- drop `display: inline-block` and `padding-bottom`
- keep the span inline with `position: relative`
- move the underline into an absolutely-positioned `::after` animating opacity,
  replacing the inset box-shadow
- preserve the existing `prefers-reduced-motion` branch

Assertion: the hero's row height returns to its pre-underline value.

## 5. Delivery

One PR, two commits, in this order:

1. **Library fix + tests, hero cell unchanged.** The browser test must show
   jitter dying while the layout-affecting underline is still in place. That is
   what distinguishes a fix from a cover-up.
2. **Hero cell fix**, landing on its own merits.

## Out of scope

`getRowMeasurementKey` includes `cell.textContent`, so every ticking row
re-measures all of its cells at ~60Hz. That is what converts a latent
instability into visible jitter rather than a one-time settle, and it is worth a
look — but it is load-bearing (two-line cells such as Day P&L genuinely change
height with content), so it is a separate perf question, not part of this fix.

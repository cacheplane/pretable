---
"@pretable/react": patch
---

A windowed grid now redraws its leading spacer and scroll extent when a count
query lands on the window it is already showing.

Turning an estimated `resultMeta.total` exact does not change the rows, and an
identical row set is not an effective write — so no revision was published and
the row-layout controller, which reads the window's spacer counts only when it
plans, never replanned. Every prop-derived value moved immediately
(`aria-rowindex`, `aria-rowcount`) while the drawn geometry stayed at the shut
gate's: no leading spacer, and a scroll extent covering the loaded window
instead of the population. On a grid whose loaded rows fit its viewport that
was permanent — the collapsed extent leaves nothing to scroll, and a scroll is
what would have replanned.

The spacers are now re-read after every commit, and the controller republishes
when they no longer match what it drew. The republish is anchored, so a
leading spacer appearing under rows already on screen moves the scroll offset
rather than sliding those rows away, and it is skipped entirely when the drawn
spacers are already current — which is every commit whose row change already
triggered a replan.

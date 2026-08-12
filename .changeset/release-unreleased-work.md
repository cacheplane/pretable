---
"@pretable/core": minor
"@pretable/react": minor
"@pretable/stream-adapter": minor
"@pretable/ui": minor
---

Release the work merged since 0.4.0. Ten commits landed on `main` without changesets and so were never published; this releases them together.

**Row model (#321)** — the incremental row-model migration completes, changing public surface in `@pretable/core` (grid construction, the local row model, and the exported types).

**Cell presentations (#318, #319)** — the semantic ramp and the first cell presentations, then badge and entity presentations, added to `@pretable/react`'s public API.

**Theming (#322)** — `pretable.css` is the house theme and the documented default; Excel and Material become compatibility skins.

**Fixes (#324, #325)** — a focused cell now draws exactly one ring rather than two, which also restores the pinned-column seam the duplicate ring had been evicting from its `box-shadow` slot; the Material dark checkmark moves from 1.70:1 to 7.73:1 contrast; and the row-height floor follows `--pretable-row-height` instead of a hard-coded 44px, so a themed density change is honored by measured and estimated rows alike.

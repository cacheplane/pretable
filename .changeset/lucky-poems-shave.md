---
"@pretable/react": patch
---

Re-read the row-height estimator's theme metrics when the theme or density
actually changes.

The measured character width and the row box (line height, cell padding,
border) were each read once per session and never again, so a grid that
switched theme or density kept estimating against the old font and the old
padding. Both now invalidate on the same signal — the `MutationObserver` on
`<html>` that `useResolvedHeights` and `useResolvedPx` already subscribe to —
and re-read on the next estimate rather than on every estimate, so the
per-estimate path stays free of DOM reads.

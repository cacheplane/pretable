---
"@pretable/core": minor
"@pretable/react": minor
---

Windowed spacers are sized from what rows have measured, not from the default
row height.

A windowed grid reserves the unloaded regions as spacers, and `getWindowSpacers`
reports those regions as row **counts** — how many rows sit before and after the
loaded window. The controller turned a count into pixels by multiplying by
`defaultRowHeight`. Its own comment said so: _"Row counts, not pixel heights."_

That is the region's real height only on a grid whose rows are all the default
height. On a grid whose rows wrap it is a systematic understatement of the whole
scroll extent, by the ratio between a wrapped row and the unwrapped default —
and the retained-measurement cache, which knows exactly what those rows were
worth, was never consulted for geometry at all. It is keyed by row identity
while the spacer arrives as a count, so the two systems had no way to meet.

The controller now prices a spacer's rows at
`RowHeightIndex.getMeasuredHeightMean()` — the mean of every height the DOM has
reported, the retained heights of evicted rows included — falling back to
`defaultRowHeight` until something has been measured. A grid that has measured
nothing, and every grid with no window at all, is byte-for-byte unchanged.

It remains an **estimate**: a count cannot say which rows are out there, so the
extent tracks the result's size without reproducing its height. The docs
previously claimed the spacer "reproduces the region's height precisely" where
retained heights were exact, which the code could not do and now does not claim.
`eviction.mdx` and `windowing.mdx` say what it actually computes, and that the
viewport anchor is what absorbs the residual.

The mean is aggregated structurally — every hash node in the persistent height
index carries the sum of its values beside the count it already carried — rather
than threaded as a running total through `measure`, `apply`, retention eviction
and the cooperative replacement builder, so a copy-on-write rebuild cannot leave
it stale.

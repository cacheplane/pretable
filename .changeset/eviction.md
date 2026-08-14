---
"@pretable/core": minor
"@pretable/react": minor
---

Eviction: a cell selection survives its rows being released. Under a
server-controlled window, an absent row _outside_ the loaded span is now
evicted rather than deleted — it keeps its selection, its height and its
scroll position, and comes back selected when the window returns.

This is the combination AG Grid's docs forbid. `maxBlocksInCache` cannot be
combined with dynamic row heights there, and MUI documents no eviction at all.
It works here because `resultMeta.window` already tells the engine the loaded
span, so absence is not ambiguous: outside the window it is eviction, inside it
is deletion, and deletion prunes exactly as before.

**What a selection is, when its rows are gone.** A range named by two row IDs
stops meaning anything once those rows are unloaded — an ID cannot be resolved
to a position without the row. So a range now also carries `datasetRowSpan`,
the absolute dataset positions of its endpoints:

```ts
interface PretableIndexedDatasetRowSpan {
  readonly start: number;
  readonly end: number;
  readonly datasetKey?: string;
}
```

Count becomes `Σ(end − start + 1)` over spans — 4,901 rows reported off 30
loaded, O(ranges) rather than O(selected rows) — and membership becomes
containment on a rendered row's dataset position. Neither loads a row. It also
fixes a retained range painting _nothing_, including for the loaded rows in the
middle of its own span.

**The number comes with a qualifier.** `grid.getCellSelectionSummary()` returns
`{ rowCount, verified }`. A row deleted server-side while it was evicted cannot
be detected — the engine would need a positional delete or a dataset version it
does not have — so such a span keeps its count and drops `verified` to `false`.
Reporting only the loaded rows would understate a genuine 4,901-row selection
by 99%; reporting the span silently as fact would let a deleted row inflate the
total forever. Keep the number, refuse the claim. Same shape as
`PretableMatchingTotal`'s `"exact" | "estimate"`: the qualifier rides with the
number, and the boundary that must speak a bare integer is the one that
downgrades.

**Breaking: a span is now part of a range's identity.** Two ranges over the same
row IDs with different spans select different numbers of rows, so `sameSelection`
no longer calls them equal. An evicted endpoint no longer collapses its range to
the survivor either — that was the ordinary scrolling case, and it silently
turned an 81-row selection into 1 while reporting `verified: true`. Collapse now
requires proof of deletion. If you round-trip `state.selection` through your own
storage, carry `datasetRowSpan` with it; the flat `PretableCellRange` gained the
field for exactly that.

**Breaking: `datasetKey` fails closed.** A windowed grid that publishes
`resultMeta.window` but no `resultMeta.datasetKey` now records and reads back no
spans at all, and selections degrade to the loaded window as they did before this
release. That was the previously-default configuration and it was unsafe: with no
key the engine cannot tell a scroll from a re-sort, and a re-sort refills the same
dataset positions with different rows. Containment answers a bare boolean with no
`verified` channel to downgrade through, so a stale span there is not a shaky
number — it paints the wrong rows.

**So: publish a `datasetKey` that changes whenever the query or sort order does.**
Without one you are silently opted out of everything above, which is why
`@pretable/react` warns once in development rather than degrading quietly.

Local mode is untouched, byte-for-byte. With no window there are no dataset
positions to record, so nothing is stamped and nothing is read back.

Two things this deliberately does **not** do. It ships no evictor — it makes
releasing rows _safe_, and a consumer shrinking its window is the trigger, which
the windowed-data contract already allows. And select-all still means the loaded
window: a cell range is identified by two endpoint row IDs and the engine cannot
name a row it has never loaded. "All rows" is already expressible in the separate
sparse row-selection program the checkbox column drives.

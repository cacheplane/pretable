---
"@pretable/core": minor
"@pretable/react": minor
---

Eviction: two publicly-reachable correctness fixes, both of which contradicted
what the docs promised.

**An evicted selection no longer paints rows the reader never selected.**
`datasetKey` identifies the QUERY, not the population — deliberately, and
[the docs](/docs/server-data/lifecycle#datasetkey) tell consumers to keep it
stable while they page within one result. So an insert or a delete made by
someone else, upstream of a selection whose own rows are unloaded, arrived with
the key unchanged and silently re-filled the remembered dataset positions with
different rows. Reproduced through `<PretableSurface>` with the honesty gate
fully passing: a `row-1..row-8` selection, both endpoints evicted, five rows
prepended to the same result, and the returning window painted five rows
selected — four of which had not existed when the user selected — while the
eight they did choose painted nothing.

A span now records the population's SIZE alongside its key
(`PretableIndexedDatasetRowSpan.datasetTotal`, from the exact
`resultMeta.total.count` the gate already requires), and a mismatch fails closed
exactly as a key mismatch does: nothing paints from the span, and
`getCellSelectionSummary()` reports `verified: false` until a window covering
both endpoints re-measures it. A proven deletion is the one allowance — a total
short by exactly the rows the engine watched vanish is accounted for, so
endpoint narrowing still works. What this does **not** catch is a change that
leaves the size identical; `eviction.mdx` now says so rather than promising
otherwise.

`ɵPretableIndexedSelectionWindow.datasetTotal` is required, not optional: the
gate that builds a window cannot pass without an exact total, so an optional
field would only be a way to fail open by omission.

**One closed-gate revision no longer destroys the selection and the cursor.**
With `resultMeta.total` reporting `{kind: "estimate"}` for a single render — an
in-flight count query, a backend that stops counting past 10k — or one revision
of `processing.sort: "engine"`, a window slide dropped every range and emptied
the cursor irrecoverably. Restoring the exact total brought neither back.
Uncontrolled consumers only; a controlled one was accidentally immune because
the `state.selection` echo re-supplied what the engine had discarded.

A null window was two different situations sharing one representation. The
engine is now told which: `windowed` says whether the consumer publishes
`resultMeta.window` at all, independent of any gate, so a windowed grid with no
window this revision means "I cannot verify", not "those rows were deleted" —
and it holds the selection and the cursor byte-for-byte instead of asserting a
deletion it could not have observed. Local mode, where an absent row genuinely
is a deleted row, is unchanged in every branch and pinned by tests that run the
same fixture both ways.

`CreateGridUiCoreOptions.getSelectionWindow` is replaced by `getWindowing`,
which returns both facts from one read so they cannot describe different
instants.

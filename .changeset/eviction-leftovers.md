---
"@pretable/core": minor
"@pretable/react": minor
---

Eviction, finished: an arrow key no longer loses an evicted cursor, and one
deleted row no longer takes a whole selection with it.

**The keyboard.** The cursor survives its row being released — but
`moveIndexedFocus` reconciled two-argument, so it could not tell an evicted row
from a deleted one and dropped the cursor on the very next keystroke. That is
precisely the state a user is in: they scrolled away from the cell, then pressed
a key. The eviction context is now threaded through the move and through the
store's `moveFocus`.

A row-axis move from a cursor whose row is not loaded is **refused** — the
cursor holds where the user left it — while the column axis still answers,
because it never needed the row. The alternatives were both worse: jumping to
the nearest loaded row teleports the cursor across however many rows were
released, and moving to the adjacent _dataset position_ cannot be expressed at
all, because a focus ref addresses a cursor by row identity and the engine
cannot name a row it has never loaded. A positional cursor that requests its own
row is a real feature and a product decision; it is deliberately not smuggled in
here.

**The selection.** Retention was per _range_: reconciliation dropped a range as
soon as either endpoint was proven deleted, and collapsed it onto the survivor
when one endpoint was still loaded. So a range whose start was genuinely deleted
while its end was merely evicted was discarded whole — an 81-row selection
reporting 0, or 1, with 80 of those rows still loaded and painted.

The spec states the rule per _row_, and `datasetRowSpan` is what makes that
expressible: the proven-deleted rows prune and the span around them narrows.

| The range's endpoints                | Before                      | Now                          |
| ------------------------------------ | --------------------------- | ---------------------------- |
| one deleted, one evicted             | dropped whole               | narrows past the deleted row |
| one deleted, one loaded              | collapsed onto the survivor | narrows past the deleted row |
| both evicted, neither provable       | kept whole                  | unchanged                    |
| every row in the span proven deleted | dropped                     | unchanged                    |

A deletion shifts everything after it down one, so whichever end was removed the
survivors land on `lo … hi - 1`. The deleted endpoint's _identity_ is replaced
by the row that now holds the narrowed boundary, so no deleted row id lingers in
a live selection — where the anchor reassignment would hand it straight back.
Fail-closed throughout: a range with no readable span, an emptied span, or a
narrowed boundary that is not loaded is still dropped exactly as before.

Local mode — a grid with no window — is byte-for-byte unchanged in every branch.

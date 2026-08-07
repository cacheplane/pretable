---
"@pretable/core": minor
"@pretable/react": minor
---

Column array order is now visual order, and reordering pins symmetrically.

`planColumns` renders columns in three regions — left-pinned, scrollable,
right-pinned — so a column's index in the engine array is the position it
actually renders at only while that array is already grouped that way. Three
consumers depended on this silently: `aria-colindex`, the reorder gesture's drop
hit test, and the column-offset map it scans. `setColumnPinned` maintained the
grouping. `moveColumn` and every path that accepted columns from outside did not.

Two symptoms, one cause. A right-pinned column dragged to array index 0 kept its
pin — reordering deliberately does not silently unpin — but then sat at index 0
while rendering last, so assistive technology announced "column 1" for a column
drawn at the far right. And an unpinned column dropped past the right-pinned
group landed after it with no auto-pin, while the left region had an
auto-pin/unpin rule.

**`moveColumn` now derives the moved column's pin from the region it lands in.**
The leading pinned region gives it `"left"`, the trailing region gives it
`"right"`, and anywhere between the two leaves it unpinned. Left-region behavior
is unchanged — same boundary computation, same predicate, same result — and the
right is now its exact mirror.

**Behavior change: a right pin can now be lost to a drag**, exactly the way a
left pin already could. Dragging a right-pinned column out of the trailing group
unpins it; dragging any column into that group pins it there. If you relied on a
right pin surviving every reorder, set `reorderable: false` on that column. When
pin state changes alongside a reorder, `onColumnPinnedChange` fires alongside
`onColumnOrderChange` in the same commit, as before.

Because the drop index is adjusted for the fact that `moveColumn` removes a
column before re-inserting it, each pinned column is a two-halves target: its
leading half drops ahead of the group and stays scrollable, its trailing half
drops inside it and takes the pin.

**Columns are regrouped on the way in, not just on mutation.** A `columns` array
that interleaves pinned and unpinned entries is now normalized at mount, on every
prop update, and on `resetColumnLayout`, with relative order preserved inside each
region. The sharp edge was the prop path: `mergeColumnsFromProps` rebuilds in the
consumer's declared order while merging _runtime_ pin state back in, so any prop
update after a user pinned something re-broke the grouping — and with it
`aria-colindex` — until the next reorder. Declaring
`[symbol, note (right), name]` is fine; it becomes `[symbol, name, note]`.

The synthetic row-select column leads its own region rather than the whole array.
It is pinned left by default, where those are the same thing, but
`rowSelectionColumn.pinned: false` makes it scrollable, and seating it at index 0
ahead of the left-pinned run would be the very desync this prevents.

**New: `grid.setColumnOrder(ids)`** reconciles a whole relative order in one
commit. Ids matching no column are ignored, columns the caller omitted keep their
current relative order at the end, the synthetic row-select column stays at
position 0, and no column's pin changes.

**Behavior change: controlled `columnOrder` is a relative order, not a literal
layout.** It is regrouped by each column's current pin state before being
applied, so an order that interleaves pinned and unpinned ids is normalized rather
than honored position-for-position; `columnPinned` and the column config own pin
state. This also fixes a hang: the reapply previously replayed the order as one
`moveColumn` per column, and against a `columnOrder` that disagreed with
`columnPinned` the two passes could not settle — the order pass unpinned, the pin
pass re-pinned and repositioned, the snapshot changed, and the effect ran again.
`setColumnOrder` never touches pin state, so they now converge.

`aria-colindex` itself is unchanged. It is correct once the invariant holds,
which keeps one source of truth for a column's position.

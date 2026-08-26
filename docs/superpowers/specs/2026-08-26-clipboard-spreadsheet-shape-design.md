# The clipboard is a spreadsheet interchange format

Date: 2026-08-26
Status: approved

## The product constraint that decides this

**Most customers use the clipboard to move data in and out of Excel and Google
Sheets. That is the compliance target.** The clipboard is therefore a
*spreadsheet interchange* format, not an internal round-trip format. Where the
two conflict, the spreadsheet wins.

## The defect

When grouping is active the surface prepends a synthetic column
(`pretable-surface.tsx:1862-1873`):

```js
{ id: GROUP_COLUMN_ID, header: "Group", value: () => "", ... }
```

Group rows render the label there; data rows render `""`. Both clipboard sides
treat it as a real field:

- **copy** (`copy.ts:326`) emits the group label on a group row, and an empty
  leading field on a data row. Documented at `clipboard.mdx:44-47`.
- **paste** (`paste.ts:316`) filters only `ROW_SELECT_COLUMN_ID`, so the group
  column occupies a target slot.

Those two are consistent with each other and inconsistent with every
spreadsheet. Excel hands us N values for the N columns a user can see; we tile
them across N+1 slots. **The first value lands in `__pretable_group__`, is
rejected as not-editable, and the rest shift.** Pasting from Excel into a
grouped grid loses the user's first column.

Measured (#485): removing paste's slot *alone* inverts the damage — a
copy-then-paste of a grouped row silently blanks column `a` and shifts right.
That is why this is a both-sides change, not a one-liner.

## Decision

**The clipboard carries only real data columns.** The synthetic group column is
presentation and does not appear in copy, CSV, or paste.

**A group row's label moves to the leftmost column of the copied range**, with
aggregates in their own columns:

```
Technology<TAB><TAB><TAB>1240000
```

This is what Excel's Subtotal produces ("Technology Total" in column A) and what
Sheets pivot tables do, so a pasted block reads as native. Note the label lands
in the leftmost column *of the selected range*, not of the grid — a range that
starts at column C puts the label in C.

Accepted cost: if that column is numeric, a text label lands in it. It is a
header row and spreadsheets tolerate this; it is what the incumbents do.

## Scope

- `copy.ts` — stop emitting a field for `GROUP_COLUMN_ID`; put the group label
  in the leftmost column of the range for group rows.
- `csv.ts` — the same change; it has its own emit path (`csv.ts:523`).
- `paste.ts` — drop the `GROUP_COLUMN_ID` slot from `dataColumns`, alongside the
  existing `ROW_SELECT_COLUMN_ID` exclusion, and re-anchor an anchor that lands
  on it the way `:330` already does for row-select.
- `clipboard.mdx:44-47` — update; the documented behaviour changes.

## The guard that already exists

`paste-map.test.ts:495` round-trips a grouped row through
`serializeRanges` → `parseTsv` → `mapPasteToTargets`. Its comment states the
invariant: *"Change both sides together or neither: this test passes under
either arrangement and fails only when they disagree."*

So it supports this change and will catch a half-done one. It has one hardcoded
expectation to update — `"\tr0a\tr0b\tr0c\tr0d"` becomes
`"r0a\tr0b\tr0c\tr0d"`; that leading tab **is** the empty group field. Its range
also starts at `GROUP_COLUMN_ID`, which no longer makes sense as a copy bound.

**Do not weaken this test to make the change pass.** If it fails in a way the
spec did not anticipate, that is a finding.

## Acceptance

The bug this exists to fix is *external* paste, so prove that specifically:

1. **Excel-shaped paste into a grouped grid.** N values for N visible columns,
   pasted at the first data column — every value lands in its own column, and no
   `rejected` entry names a synthetic id.
2. **Copy a grouped selection → the text is spreadsheet-shaped.** Rectangular,
   N fields per row, group label in the leftmost column of the range.
3. **Round-trip still works** — copy from the grid, paste back, values land
   where they came from. This is the side being made to yield; it must still be
   correct, just no longer privileged.
4. **Ungrouped behaviour is byte-identical.** Nothing here may touch the
   ungrouped path.

## Out of scope

Rehoming the label anywhere other than the leftmost column of the range;
changing what group rows render on screen; the HTML clipboard flavour beyond
keeping it consistent with the TSV shape.

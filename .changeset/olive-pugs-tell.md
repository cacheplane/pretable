---
"@pretable/core": patch
"@pretable/react": minor
"@pretable/ui": patch
---

Fix autosize after an empty first render, header layout, and cell clipping.

- `setRows` now re-runs autosize against the incoming rows. Fetch-then-render is
  the usual order, so the first pass sees no rows and autosize can only fall
  back to its minimum width — which it then kept for the rest of the grid's
  life. Measured from the original column definitions, since autosize skips any
  column that already carries a width; widths the consumer set are left alone.
- The header cell's inline style was `display: grid` with `align-items: start`.
  Inline styles beat the skin no matter how it is layered, so this quietly
  overrode `[data-pretable-header-cell]`'s `display: flex; align-items: center`
  in `@pretable/ui`, and stacked any multi-node `renderHeaderCell` into rows
  that overflow the header strip. Now flex/center, matching the skin.
- The default header rendered the words "Newest", "Oldest", and "Sort" — date
  vocabulary applied to every column, which reads wrong on a name or a number.
  Sorted columns now show a direction glyph (`▲`/`▼`) carrying
  `data-pretable-sort-indicator` for themes to target; unsorted columns show
  none, with `aria-sort` and the button's `aria-label` carrying the state.
  **Consumers asserting on that text will need to update**; `renderHeaderCell`
  still overrides the default entirely.
- Body cells now set `overflow: hidden`. Cells are absolutely positioned, so a
  value wider than its column used to paint straight over its neighbour. Note
  that a cell is a flex container, where `text-overflow: ellipsis` has no
  effect — for an ellipsis, render the value inside a shrinkable element
  (`min-width: 0`) via the column's `render`.

---
"@pretable/react": minor
---

The surface speaks filter trees: funnels, the column menu, and controlled
state.

`query.filters` is now an AND/OR tree — each element is either a typed leaf or
a `{ op, children }` group, and groups nest (see `@pretable/core` for the node
type, the `isPretableFilterGroup` guard, and the empty-group rule). The
surface's chrome follows:

- The **funnel** lights on ANY occurrence of a column, at any depth. A filter
  the user built inside a group still removes their rows, so it still shows as
  a filter on that column. Previously the surface kept a per-column record
  projected out of the query; a group carries no `columnId`, so that record
  would have collapsed every group onto the single key `undefined` and left the
  funnel dark. The record is gone — the surface holds the tree verbatim.
- The **column filter menu** owns exactly its column's FIRST top-level leaf. It
  hydrates from that leaf (never from one nested in a group), and a commit
  replaces it in its existing slot rather than removing it and appending at the
  end. Every group element passes through by reference: a menu commit cannot
  edit, reorder, or drop a branch it did not author, and clearing a column
  removes only its top-level leaf. Two ordering details change for a
  hand-authored `filters` that carries duplicate top-level leaves for one
  column — nothing the menu can produce: the menu now reads the FIRST of them
  (the per-column record it replaced was last-wins), and a commit collapses
  them to the single leaf it just wrote.
- **Controlled queries** take the tree shape. A controlled `query.filters`
  containing groups renders funnels and filters rows exactly as the engine
  evaluates it.
- `LabeledGridSurface`'s `is-filtered` header decoration walks the tree by the
  same "occurrence anywhere" rule.

`isPretableFilterGroup`, `PretableFilterGroupFor` and `PretableFilterNodeFor`
are re-exported from `@pretable/react` — a consumer reading `onQueryChange`'s
`filters` needs the guard to tell leaves from groups.

No UI builds groups yet; nothing in this release deepens a tree on its own.

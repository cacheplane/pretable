# Row grouping documentation

Date: 2026-08-10
Status: approved
Predecessors: SP1 #237, SP2 #254, SP3 #258, correctness rounds #259 / #264,
invariant #266, overflow #267.

## Problem

Row grouping is **published in `0.0.11`** and completely undocumented. There is
no `grouping.mdx`, nothing in `apps/website/app/docs/_nav.ts`, and the only
mention anywhere in the docs tree is an unexplained `rowGroups?: string[]` line
inside a `PretableSurfaceState` code block.

Worse than missing: **`api-reference.mdx` is actively wrong.** Its
`PretableColumn<TRow>` table (`:14-33`) reads as exhaustive and omits `rowGroup`,
`aggregate` and `formatAggregate`. A reader consulting the reference concludes
those fields do not exist. `groupPanel` and `onRowGroupsChange` are absent from
the surface props too.

## Scope

In: a `grouping.mdx` page with one live example, its nav entry, corrections to
`api-reference.mdx`, and grouping cross-references on the pages whose behaviour
grouping changes.

Out: hero adoption and the grouping bench (the rest of SP4), and the untested
interaction matrix. Both are tracked separately.

## Design

### 1. The page

`apps/website/content/docs/grid/grouping.mdx`, frontmatter
`nav: Grid`, `order: 8` — alongside `filtering`, `sorting` and `cell-renderers`,
which already share that rank. Nav entry after "Filtering" in the Grid section
of `_nav.ts`.

House style, from `filtering.mdx`: no H1 (the page header supplies it), lead
prose, then `##` sections mixing GFM tables, fenced `tsx`, `<Callout>`, and a
`## See also` list of relative links. `search-index.json` is generated from the
content tree at build time — adding the file is sufficient, there is no index to
edit.

Sections, in order:

1. **What grouping does** — the flat `visibleRows` list interleaves group rows
   with data rows; a synthetic group column is _derived_, carrying the label and
   twisty for every level; grouped columns are hidden from the data area.
2. **Turning it on** — three ways, and they compose: `rowGroup: true` on a
   column, controlled `state.rowGroups`, or the drag-to-group panel.
3. **The panel** — `groupPanel={{ enabled: true }}`, what it costs in layout
   (it consumes from `viewportHeight` rather than adding to it, so enabling it
   never reflows the surrounding page), and `onRowGroupsChange`.
4. **Aggregation** — `aggregate` and, emphatically, **`formatAggregate` not
   `format`**. This deserves its own callout: `format`'s input has a
   non-optional `row`, a group row has none, so a formatter written for cells
   would crash on an aggregate. That is a real trap, and ag-grid ships it.
5. **Expansion** — expanded by default; `groupsDefaultExpanded` flips it;
   overrides are a bounded LRU, so state for very many groups is not retained
   indefinitely.
6. **Keyboard** — the treegrid model (Left/Right collapse and expand in the
   group column, Enter/Space toggle, arrows move between rows of either kind)
   and the panel's chip model (arrows, Shift+arrow to move a level, Delete).
7. **Options** — `groupColumn`, `hideGroupedColumns`, `aggregateFilteredRows`,
   `groupsDefaultExpanded`, all now reachable from React.
8. **Things that will surprise you** — see below.
9. **Headless** — grouping is engine-level; link to the headless section.

### 2. The live example

Grouping is drag-a-header-onto-a-panel, keyboard-reorder, expand-collapse. A
fenced code block cannot convey any of it, and a reader who can try it needs far
less prose.

Follow `content/examples/headless-custom-renderer/` exactly — it is the working
precedent (`streaming-chat-grid` is the other, used differently). Three pieces:

- `apps/website/content/examples/grouping-panel/` — `index.tsx` reading its own
  sources through a `SPEC` list and Shiki-highlighting them at build time, plus
  the demo component and its data/columns modules.
- `apps/website/app/components/docs/mdx/GroupingExample.tsx` — the thin server
  wrapper, mirroring `HeadlessExample.tsx`.
- A registration entry in `docsMdxComponents`
  (`app/components/docs/MdxRenderer.tsx:34-48`).

The demo should have a low-cardinality column worth grouping by and a numeric
column worth aggregating, with `formatAggregate` supplied — so the page's
central warning is visible in the example's own source.

### 3. Correcting `api-reference.mdx`

- `PretableColumn<TRow>`: add `rowGroup`, `aggregate`, `formatAggregate`.
- `PretableSurfaceProps`: add `groupPanel`, `onRowGroupsChange`.
- Wherever engine options are listed: add `groupColumn`, `hideGroupedColumns`,
  `aggregateFilteredRows`, `groupsDefaultExpanded`.

**Then check the rest of that page the same way.** A table that silently went
stale once has probably done it elsewhere; compare every table against the
current `.api.md` reports rather than only patching the rows named here. Report
anything else found rather than fixing it silently.

### 4. Cross-references

Grouping changes behaviour documented on other pages. Each needs a sentence and
a link, not a rewrite:

- `selection.mdx` — group rows are focusable but never selectable.
- `keyboard.mdx` — the grid becomes a `treegrid` when grouped; Left/Right take
  on collapse/expand in the group column.
- `clipboard.mdx` — copying a grouped range includes group labels and
  aggregates.
- `sorting.mdx` — sorting applies within groups, and the group order follows the
  first grouping level's sort.
- `column-layout.mdx` — grouped columns are hidden from the data area by
  default.

### 5. Things that will surprise you

The page must state these; each is real, each was discovered the hard way:

- **Reordering grouping levels resets expansion.** Expansion ids are
  path-derived, so changing the levels invalidates every path and the override
  set is dropped.
- **Grouped columns disappear from the data area** unless
  `hideGroupedColumns: false`.
- **Group rows are focusable but never selectable or editable.**
- **`formatAggregate`, not `format`** — repeated from §4 because it is the one
  that will actually bite someone.
- **With a left-pinned column, the group column is not the row's first column.**
  It heads the _unpinned_ run, so it scrolls out from under the pinned region.
  `groupColumn: { pinned: "left" }` is the fix. Document the workaround; the
  underlying seating rule is arguably wrong and is tracked separately.

## Testing

- The docs e2e spec (`apps/website/e2e/docs.spec.ts`) should cover
  `/docs/grid/grouping` resolving 200 with its nav entry present, following the
  existing pattern there.
- The live example must actually mount — the `Example` island is a client
  component and this page will be the second thing exercising that path.
- `pnpm build` catches MDX compile errors; a broken relative link will not fail
  the build, so check the `## See also` targets by hand.

Documentation claims are code claims. Every code block must be one a reader can
paste and run against `0.0.11` — check each against the real API rather than
against this spec, which has been wrong before.

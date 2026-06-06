# Headless engine docs (`@pretable/core`) — design

**Date:** 2026-06-06
**Status:** Approved (brainstorm)
**Branch:** `claude/headless-core-docs`

## Goal

Ship the deferred documentation for `@pretable/core` as a usable **headless
engine**, plus one runnable worked example. Closes the future task described in
the `project_headless_engine_docs_deferred` memory.

Scope (decided): a new docs section **+ one worked React example**. NOT a
standalone demo app, NOT a vanilla-TS example, NOT any new core API.

## The load-bearing accuracy constraint

`@pretable/core` is a **headless state + row-model engine, not a renderer.**
Verified against the source (`packages/grid-core/src/create-grid-core.ts`,
`derived-rows.ts`):

- The engine owns: **filtering, sorting, selection & ranges, focus / keyboard
  movement, column layout, data transactions**, exposed as a
  `useSyncExternalStore`-ready store (`subscribe()` + `getSnapshot()`).
- It does **NOT** do virtualization, row measurement, or DOM. Those live in
  `@pretable/react` / `@pretable-internal/renderer-dom`.
- `getSnapshot().visibleRows` is the **full filtered + sorted row set** — "rows
  passing the current filter, in sort order" (logical visibility). It is NOT a
  viewport window.
- `getSnapshot().visibleRange` is currently hardcoded to
  `{ start: 0, end: visibleRows.length }`. `viewport` state is stored and used
  only for PageUp/PageDown focus paging (`computePageStep`), not for row
  windowing.

**Docs implication:** frame the engine as "bring your own rendering + your own
windowing." Explicitly define `visibleRows` so no reader assumes the engine
virtualizes. The example must therefore render all `visibleRows` over a modest
dataset rather than fake a viewport window.

**Positioning line:** *Reach for `@pretable/core` when you need Pretable's grid
logic under your own rendering; reach for `<Pretable>` when you want batteries
included.*

## Public surface to document

From `packages/core/core.api.md` (all `@public`):

- `createGrid<TRow>(options): PretableGrid<TRow>`
- `PretableGridOptions` — `{ columns, rows, getRowId?, autosize? }`
- `PretableGrid` handle:
  - Observation: `subscribe(listener) => unsubscribe`, `getSnapshot()`,
    `options`, `kind`
  - Sort/filter: `setSort`, `setFilter`, `replaceFilters`, `clearFilters`
  - Selection: `setSelection`, `toggleRowSelection`, `selectAll`,
    `clearSelection`, `addRange`, `extendRangeFromAnchor`, `setSelectAllVisible`
  - Focus: `setFocus`, `moveFocus`
  - Columns: `setColumnWidth`, `setColumnPinned`, `moveColumn`,
    `resetColumnLayout`, `autosizeColumn`, `autosizeColumns`,
    `mergeColumnsFromProps`
  - Data: `applyTransaction`
  - Viewport: `setViewport`
- Supporting types: `PretableColumn`, `PretableRow`, `PretableFormatInput`,
  `PretableGridSnapshot`, `PretableVisibleRow`, `PretableRowRange`,
  `PretableSortState`/`Direction`, `PretableSelectionState`,
  `PretableCellRange`/`Address`, `PretableFocusState`/`Direction`,
  `PretableMoveFocusOptions`, `PretableViewportState`, `PretableTransaction`,
  `AutosizeOptions`, `PretableRowSelectionTriState`.

## Docs structure

New top-level section **"Headless engine"** in
`apps/website/app/docs/_nav.ts`, placed **after "Grid"** and before "Streaming"
(it is the engine beneath the grid). Each page also carries `nav` + `order`
frontmatter consistent with existing pages.

Pages under `apps/website/content/docs/headless/`:

1. **`index.mdx` — Overview**
   - What `@pretable/core` is; the engine-vs-renderer split (with the
     `visibleRows` clarification up front).
   - When to reach for it vs `<Pretable>` / `<PretableSurface>`.
   - Install (`npm i @pretable/core`), zero peer-framework requirement.
   - Link to getting-started and back to `<Pretable>`.

2. **`getting-started.mdx` — First headless grid**
   - `createGrid({ columns, rows })`.
   - Minimal React custom renderer via `useSyncExternalStore(grid.subscribe,
     grid.getSnapshot)`.
   - Render `snapshot.visibleRows`; wire one sort toggle + one filter input.
   - Embeds the live worked example.

3. **`state-model.mdx` — Snapshot & subscribe**
   - `getSnapshot()` shape, field by field, with the `visibleRows` /
     `visibleRange` / `totalRowCount` semantics called out.
   - `subscribe()` contract (returns unsubscribe; fires on any state change).
   - Snapshot caching/identity (snapshot is memoized until the next mutation —
     safe for `useSyncExternalStore`).
   - `useSyncExternalStore` integration recipe + the `getServerSnapshot`
     consideration.

4. **`mutations.mdx` — Actions**
   - Grouped: sort/filter; selection & ranges; focus & movement
     (`moveFocus` + options); column layout (pin/move/width/autosize/reset);
     transactions (`applyTransaction` add/update/remove); viewport (paging).
   - Each group: short prose + a focused snippet.

5. **`api-reference.mdx` — API reference**
   - Full public surface, mirroring `grid/api-reference.mdx` and
     `streaming/api-reference.mdx` formatting (signatures + one-line
     descriptions, grouped).

(5 pages mirrors the Streaming section. If state-model + mutations feel thin
during writing, they may merge into one "Engine API" page — the author may
collapse to 4 without re-approval.)

## Worked example

`apps/website/content/examples/headless-custom-renderer/`, mirroring the shape
of `content/examples/streaming-chat-grid/`:

- A compact, **non-`<Pretable>`** table component built on `createGrid` +
  `useSyncExternalStore`.
- Modest **static dataset (~75 rows)** so rendering all `visibleRows` is honest
  (no virtualization claim).
- Demonstrates: sortable column headers (click → `setSort`), a filter input
  (→ `setFilter`/`replaceFilters`), and row selection (click → toggle, with the
  selected row reflected from `snapshot.selection`).
- Files: the renderer component, `columns.ts`, `data.ts`, `page.tsx` (the
  embeddable page, like `streaming-chat-grid/page.tsx`), and
  `__tests__/<Component>.test.tsx`.
- Test (RTL, mirroring `MockChatGrid.test.tsx`): renders rows; clicking a header
  reorders; typing in the filter shrinks the visible count; clicking a row marks
  it selected.
- No external API/keys needed, so the example can be embedded live (no mock
  variant required, unlike the OpenAI-backed streaming example).

## Wiring & cross-links

- Add the "Headless engine" section to `_nav.ts`.
- `nav` + `order` frontmatter on each new page.
- Cross-links: from `docs/grid/index.mdx` and `docs/streaming/index.mdx`
  (which already references `grid.applyTransaction`) into the headless section;
  from `docs/headless/index.mdx` back to the `<Pretable>` component page.

## Out of scope (YAGNI)

- No standalone demo app (`apps/headless-demo`).
- No vanilla-TS / non-React example.
- No new `@pretable/core` APIs or virtualization helper.
- No changes to the engine itself.

## Verification

- `pnpm --filter @pretable/app-website build`, `typecheck`, `lint`.
- New example test passes (`pnpm --filter @pretable/app-website test` or the
  package's runner).
- Manual: the five pages render, the "Headless engine" nav section appears in
  order, the live example is interactive, internal cross-links resolve.
- Docs search / paths: confirm the new slugs are picked up by
  `lib/docs/load.ts` / `paths.ts` (they glob `content/docs/**`).

## Open questions / risks

- Exact MDX mechanism for embedding a live `content/examples/*` component into a
  page — to be confirmed against how `streaming-chat-grid` is embedded during
  planning/implementation (the embedding component / import convention).
- `<Tabs>`/`<Tab>`/`<Card>` MDX components are available (used by streaming
  docs); reuse them where helpful.

# Multi-column sort — design (P1 sub-project 1 of 3)

**Date:** 2026-08-05
**Branch:** `claude/multi-sort` (off `main` after #195)
**Status:** approved (design confirmed in-session)

## Context

Sorting is single-column end to end: `PretableSortState { columnId, direction }`
(`grid-core/src/types.ts:169`), one-key `sortRows` (`derived-rows.ts:94`), header click
cycling asc → desc → none, controlled `state.sort: PretableSortState | null`, and
`onSortChange({columnId, direction} | null)`. Multi-column sort is the first P1
table-stakes gap (order decided: multi-sort → right-pin → paste). Pre-1.0, no external
consumers: the single-column model is **replaced**, not aliased.

## Goal

Ordered multi-column sorting through the whole stack — engine cascade, shift-click UI
with priority badges, controlled state, docs — in **one PR**.

## Decisions (locked in brainstorm)

- **UX:** plain header click = single sort, replaces the whole list, cycles
  asc → desc → none (unchanged). **Shift-click** = append this column (`asc`) if absent;
  if present, cycle its direction in place asc → desc → _remove just it_, preserving the
  rest of the list and its order. Priority badges (1, 2, …) appear only when 2+ columns
  are sorted.
- **Scope:** one sub-project / one PR (engine + UI + docs + migrations).

## Model (no backcompat)

```ts
/** @public */
export interface PretableSortEntry {
  columnId: string;
  direction: "asc" | "desc";
}
// snapshot.sort: PretableSortEntry[]  — ordered; index = priority; [] = unsorted
```

- Replaces `PretableSortState` in the snapshot, engine, and controlled state. Entries
  never carry null directions — "none" is expressed by removing the entry.
- `PretableSortDirection` (`"asc" | "desc" | null`) stays as the _input_ type for
  `setSort` (null = clear).

## Engine API (`grid-core` → `core` public surface)

- `setSort(columnId: string | null, direction: PretableSortDirection): void` — signature
  unchanged; now means **replace the list with this single entry** (null columnId or
  null direction ⇒ `[]`). Every existing single-sort call site keeps its behavior.
- `replaceSort(entries: PretableSortEntry[]): void` — **new**; atomic list replace,
  structural change-guard (emit only on change), drops entries whose `columnId` doesn't
  resolve or whose column has `sortable: false` (mirrors filters' inactive-drop).
- Sorting cascade in `sortRows`: compare by entry 0; ties fall through to entry 1, …;
  final tie-break by `sourceIndex` (today's stability guarantee). Per-key comparison
  reuses the existing logic (all-numeric fast path per key, else `Intl.Collator`),
  applied per entry with the entry's direction.
- Snapshot: `sort: PretableSortEntry[]` (shallow-copied array), cache keyed on the sort
  array reference (mutators always reassign).

## Surface (`@pretable/react`)

- Header `onClick`: keep `getNextSortDirection` cycling; plain click calls
  `setSort(columnId, next)`. **`event.shiftKey`** branch computes the next list from
  `snapshot.sort` (append asc / cycle in place / remove) and calls
  `grid.replaceSort(next)`.
- `onSortChange?: (sort: PretableSortEntry[]) => void` — retyped; fires with the full
  ordered list on every user sort interaction (click and shift-click). `[]` = cleared.
- Per-column derivation: `sortDirection` and new `sortPriority` (1-based index in the
  list; `null` when unsorted or list length < 2) flow into the header content.
  `MemoizedHeaderContent` gains `sortPriority` (memo comparator updated).
- Badge markup: a small `<span data-pretable-sort-priority>{n}</span>` next to the
  existing arrow, rendered only when `sortPriority != null`.
- `aria-sort` per column from its entry (unchanged semantics; multiple sorted columns
  each carry aria-sort).
- Controlled state: `PretableSurfaceState.sort?: PretableSortEntry[]` (empty array =
  explicitly unsorted; undefined = uncontrolled). `usePretable` applies via
  `grid.replaceSort(state.sort)`.

## Styling (`@pretable/ui`)

`grid.css` rule for `[data-pretable-sort-priority]`: tiny badge (font-size down,
`--pretable-text-dim`, no new tokens), `:where()` per convention.

## Migrations (repo-wide, same sweep discipline as the filter retype)

- `packages/core`: `pretable-grid.ts` interface + `create-grid.ts` forwarding
  (`replaceSort` added), `public_api.ts` exports `PretableSortEntry` (keep
  `PretableSortDirection`; delete `PretableSortState` or retype — DELETE, no aliases).
- `packages/react`: `inspection-grid.tsx`, `labeled-grid-surface.tsx` sort consumers.
- `packages/bench-runner` + `apps/bench` adapters (tanstack/mui/ag-grid) — mechanical
  retype of sort plumbing; comparative adapters map entry lists to their libs' multi-sort
  where trivial, else use entry[0] (note it in code).
- Website hero: `heroGrid/sort.ts` (`applySort`, website `SortState`) + `HeroGrid.tsx`
  (`userSort` state, `onSortChange` handler, controlled `state.sort`). Hero adopts the
  entry-list shape; its own `applySort` becomes a multi-key cascade over the list (it
  sorts streamed rows itself by design). Plain-click single-sort UX unchanged; shift-click
  multi-sort works for free.
- Docs: new `/docs/grid/sorting` page (nav-registered in the hardcoded `_nav.ts`,
  between Selection and Keyboard or next to Filtering — implementer picks the sensible
  slot) covering click/shift-click, the entry-list model, controlled
  `state.sort`/`onSortChange`, headless `setSort`/`replaceSort`. Update both
  api-reference pages' sort rows + any `.mdx` showing `PretableSortState`.
- `pnpm api` regen (required freshness gate).

## Testing

- **grid-core:** cascade correctness (2- and 3-key mixes, string+numeric keys, direction
  mixes), stability (equal keys keep source order), `setSort` replace semantics,
  `replaceSort` change-guard + unknown/unsortable-column drop, snapshot retype, empty
  list = unsorted.
- **react RTL:** plain click unchanged (cycle + replace, `onSortChange` list payload);
  shift-click appends/cycles/removes preserving order; badges render only at 2+ entries
  with correct numbers; controlled `state.sort` list applies and re-asserts; aria-sort.
- **website:** hero `applySort` multi-key unit tests; existing hero sort tests migrated.
- Full sweep: `pnpm -r typecheck && lint && test`, `pnpm format`, website build, smoke
  (existing sort steps unaffected — plain click behavior identical), `pnpm api` (regen +
  second-run no-op).

## Risks

- **Retype blast radius:** `PretableSortState` reaches bench + website; mitigated by the
  proven grep-sweep discipline (`PretableSortState|onSortChange|state.sort|setSort`)
  including `*.mdx`.
- **Memo comparator:** forgetting `sortPriority` in `MemoizedHeaderContent`'s equality fn
  would freeze badges; covered by an RTL badge-update test.
- **aria-sort with multiple columns:** valid ARIA but screen-reader behavior varies;
  acceptable (matches ag-grid/MUI).

## Out of scope

Sort-by header menu, right-pin, paste, grouping. `sortable: false` semantics unchanged.

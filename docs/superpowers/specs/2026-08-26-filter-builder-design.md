# Filter Builder (Tool Panel SP2b) — Design

**Status:** approved direction, specced in full.
**Parents:** `2026-08-24-tool-panel-design.md` (SP2 of the tool panel), `2026-08-25-filter-tree-design.md` (SP2a, the engine).

## What this is

The tool panel's **filters section**: a builder over the AND/OR tree SP2a
shipped, so a user can compose `Total > 500 AND (Region is any of [North] OR
Customer contains "Labs")` without writing a query. This is the payoff of the
whole SP2 arc — the engine has spoken trees since #493 and nothing builds one.

## Decisions locked (and why)

1. **Full tree editing**, not a two-level render or a flat list with an OR
   toggle. The engine supports arbitrary depth; a builder that cannot reach it
   under-delivers the capability the arc was for, and would be rebuilt later.
2. **Per-row join over an indent rail** (chosen from mockups over nested
   cards, and over the rail's own quiet join label). The connective is the
   thing users misread, so it sits between rows as a control — `Where`,
   then `and ▾` / `or ▾` — and changing one changes that whole sibling run.
   Nesting still needs indentation, so the rail carries depth at ~8px a level
   rather than a bordered card's ~14px, which matters in a 264px pane.
3. **Inline editing, typed by column.** The row _is_ the editor: column
   picker, operator picker, and a value control chosen from `column.type`,
   reusing the shipped cell-editor set (`EnumCellEditor`, `DateCellEditor`,
   `NumberCellEditor`, `TextCellEditor`, `BooleanCellControl`). Rejected: a
   popover per row (every edit a round trip, and nesting plus popovers is a
   lot of layered dismissal) and a text-only input (throws away typed editors
   the repo already ships).
4. **Live, debounced commits.** Text values debounce ~200ms; every discrete
   change — operator, enum selection, join, add, remove, regroup — applies
   immediately. This matches the header FilterMenu's existing behavior, and
   SP2a's empty-group-TRUE rule exists precisely so a half-built group cannot
   blank the grid mid-edit. Rejected: an Apply button — a second source of
   truth, divergent from the funnel menu, and it would make SP2a's safety
   rule pointless.

## Architecture

### State ownership

The section is a **projection of engine state, not a draft store.** It reads
`query.filters` through its own `useSyncExternalStore` subscription — the
descriptor memo's deps stay stable handles only, which is the stale-closure
trap SP1 documented at the point of temptation — and writes through the
surface's query path.

**The only local state is per-row text-input buffers during debounce.** The
engine is the source of truth the moment the debounce fires. This is what
keeps "two sources of truth" off the table, and it is the same reasoning that
rejected the Apply button.

### Node identity: positional paths

This is the subtle part and the most likely place to go wrong.

Filter nodes are plain frozen data with **no ids**, and `compileQuery`
re-captures (allocates and freezes) every node on every `setQuery` — so
object identity does not survive a commit. React keys and "which node am I
editing" therefore address nodes by **positional path**: `[0]`,
`[1].children[2]`. Paths are _derived at render_, never stored on a node.

An edit resolves its path, rebuilds the spine to that node immutably, and
writes the new array. **A debounced text edit must re-resolve its path at
fire time and abort if the node it addressed is gone or is no longer a leaf
for the same column** — otherwise removing a sibling mid-edit lands the write
on the wrong node. That abort rule is a required test, not an optimization.

### Files

New `packages/react/src/tool-panel/filters/`: `FiltersSection.tsx` (the
section), `FilterRow.tsx` (one leaf: column · operator · value · remove),
`JoinControl.tsx` (the between-rows connective), `filter-paths.ts` (pure —
path resolution, immutable spine rebuild, insert/remove/regroup, depth
measurement). Modified: `sections.ts` (`ToolPanelSectionId` gains
`"filters"`), the surface's descriptor construction, and `grid.css` for the
rail, rows, and join control.

`filter-paths.ts` holds everything testable without React — the repo's
established split, and the reason SP1's drop-target math was trustworthy.

## Behavior details that are decisions, not details

- **Depth-64 becomes user-reachable here for the first time.** "+ group" must
  refuse past the limit — disabled with a reason — rather than let
  `compileQuery` throw an `invalid-query` error the consumer never catches.
- **A new group starts empty**, which is exactly why SP2a made an empty group
  evaluate TRUE. The grid must not blank when one is added.
- **Removing a group** removes its subtree. A group left with one child is
  legal and stays a group; it is not auto-collapsed (a user mid-restructure
  would fight it).
- **A row whose column is hidden** (SP1's column visibility) still renders and
  still filters — hiding a column does not silently drop its filter. The row
  marks the column as hidden so the state is legible.
- **The header funnel and the builder are one model.** A leaf the funnel wrote
  appears here at top level; a leaf edited here relights the funnel. SP2a
  already made the funnel light on occurrence at any depth.

## Debts this pays (folded in, not deferred again)

- **The i18n pass.** This section adds enough strings that the tool panel's
  hardcoded English stops being tolerable; the panel's strings move to the
  surface's `messages` mechanism in this sub-project.
- **The shared menu-keyboard extraction.** This is the third `role="menu"`
  (after the header column menu and the columns section's kebab), which is
  the trigger SP1's review named. Extract the shared keyboard behavior rather
  than writing a fourth copy.

## Verification

- **jsdom:** tree mutations at depth (add, remove, regroup, join change);
  path resolution under sibling removal, including the **debounce-abort**
  rule; the depth refusal; a new group not blanking the grid; a hidden
  column's filter surviving.
- **Pure-unit:** `filter-paths.ts` directly — the geometry-equivalent here.
- **Playwright:** keyboard reachability through the section, and the rail's
  tab-exit guard still holding (`grid-tab-wrap-rows.spec.ts` names the rail
  stop explicitly and will fail loudly if the section adds a trap).
- **Docs:** the tool-panel page grows a filters section; `ToolPanelSectionId`
  gaining `"filters"` moves the api report **and** is bound by the docs
  guard's string-union check, which will fail until the prose enumerates it.
- Changesets: `@pretable/react` minor, `@pretable/ui` minor.

## Out of scope

Saved views; a query-language text mode; NOT as a group operator (leaves
carry negated operators already, and SP2a left the door open); filtering on
columns the grid does not declare; SP3's grouping section.

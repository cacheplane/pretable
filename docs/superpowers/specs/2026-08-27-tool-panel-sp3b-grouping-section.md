# Grouping Section (Tool Panel SP3b) — Design

**Status:** approved direction, specced in full.
**Parents:** `2026-08-24-tool-panel-design.md` (SP3 of the tool panel),
`2026-08-27-grouping-state-design.md` (SP3a, the engine; its closing section
outlines this sub-project).

## What this is

The tool panel's **grouping section** — the third and last pane of the rail:
a group-by list with add/remove/reorder, expansion controls, a per-column
aggregate picker, and the hide-grouped-columns switch. SP3a made all four
levers engine state a pane can write; nothing user-visible shipped with it.
This is the payoff.

## Decisions locked (and why)

1. **Pane composition, top to bottom: group-by → expansion → hide-grouped →
   aggregates.** The order follows frequency of use and the SP3a outline.
   Group-by is the section's identity; expansion and the hide toggle act on
   the grouping it declares; aggregates are the long tail (one row per
   column) and so take the remaining height, exactly as the filter rows do
   in the filters pane.

2. **The strip stays; both surfaces write one model** (locked in SP3a,
   decision 4 — re-affirmed, not reopened). The pane's group-by list and the
   strip are both pure projections of `snapshot.rowGroups`; neither keeps a
   copy.

3. **The aggregate picker is a closed vocabulary derived from
   `column.type` — that IS the validation.** An invalid aggregate destroys
   the grid (measured in all three render shapes; see the
   `setColumnAggregate` TSDoc), and grid-core deliberately cannot validate.
   So the pane never offers a value the compiler would reject: number
   columns get `sum | avg | min | max | count`, every other column gets
   `count` only — mirroring `compiled-query.ts`'s `NUMERIC_AGGREGATES`
   rule. The option vocabulary lives in a pure module
   (`aggregate-options.ts`) and is **test-pinned against the real
   compiler**: for each type, every offered builtin must compile and every
   withheld builtin must throw. A drifting mirror fails the pin, not the
   user's grid.

4. **"Column default" is an explicit picker option, so "no override" and
   "overridden to the same value" never look alike.** The select for a
   column with no override shows `Default (Sum)` (or `Default (none)`,
   `Default (custom)` for a prop-declared aggregator object); choosing any
   concrete option writes an override; choosing `Default (…)` clears it
   (`setColumnAggregate(id, undefined)`). This satisfies SP3a's key-presence
   semantic without inventing a second indicator.

5. **`null` becomes the "no aggregate" sentinel — a small row-model change
   folded into this sub-project.** Today there is no value meaning "show no
   aggregate for a column whose prop declares one"; the gap is documented at
   the exact line in `aggregate-overrides.ts`. Decision:
   `mergeColumnAggregateOverrides` treats an override of `null` as "strip
   the declared `aggregate` from this derivation." `undefined` keeps its
   only meaning (no override / clear); key presence stays the signal;
   `compileQuery` never sees the sentinel because the merge strips it.
   grid-core needs no change — it already stores `unknown` uninterpreted.
   The pane's `None` option writes `setColumnAggregate(id, null)`.
   Rejected: withholding `None` from prop-declared columns (an arbitrary
   hole users would hit immediately) and a string sentinel like `"none"`
   (collides with the builtin name vocabulary, which is exactly where a
   future builtin would land).
   - Identity discipline carries over: `null` on a derivation that declares
     no `aggregate` changes nothing and must return the input array itself.

6. **The aggregates block renders only in rows mode.** In explicit-model
   mode (`model !== undefined` on the surface) the write lands in engine
   state and changes nothing a group row shows — measured, documented on the
   handle. A visible-but-inert control is the worst outcome, so the block is
   absent there, not disabled. Group-by, expansion, and hide-grouped all
   work in both modes and always render.

7. **Expansion controls are two buttons: Expand all, Collapse all**, calling
   the row model's `expandAll()` / `collapseAll()`. Rejected: exposing
   `setExpansionDefault` as a "new groups start expanded" toggle — YAGNI,
   easily confused with expand-all, and the consumer prop already exists;
   nothing in the SP3a design owed it to the pane.

8. **Hide-grouped is a labelled switch over engine state** — subscribes to
   the indexed grid's `hideGroupedColumns`, writes
   `setHideGroupedColumns`. The two-writer situation (a consumer who keeps
   driving the prop after mount clobbers pane writes) is documented on the
   docs page verbatim from the handle's TSDoc; the pane does not try to
   detect or arbitrate it.

9. **Group-by rows follow the columns-section anatomy**: grip · label ·
   remove button, drag-to-reorder via the existing
   `tool-panel-drop-target.ts` machinery, drop commits on release. Adding a
   level is a `+ Add group` button opening a menu (the shared menu-keyboard
   extraction from SP2b) listing schema data columns not currently grouped —
   there is no `groupable` flag in the schema, and `applyRowGroups` already
   de-dupes and filters to schema ids, so eligibility is "any data column
   not yet grouped."

10. **The pane's grouping write is a stable `setRowGroups` routed through
    `queryWith` — and `applyRowGroups` is rebuilt on top of it.** This pays
    the recorded debt: `applyRowGroups` is the last `pendingQueryRef`
    bypass, and a bypassed write lets the next funnel commit resubmit a
    grouping the panel replaced. `applyRowGroups` keeps its signature (the
    strip and header menu still need the focus-intent bookkeeping) but its
    query submission becomes `queryWith({ rowGroups })`, and it becomes
    stable by reading the current snapshot through `surfaceContextRef`
    instead of depending on `rowModelSnapshot.query` /
    `snapshot.rowGroups`. The pane calls the same function — one write path,
    not two.

11. **Grouped-column presentation in the filters picker — decided** (the
    question SP2b left at the site): a grouped column is marked in the
    filters picker **only while it is not drawn** — grouped **and**
    `hideGroupedColumns` on — with its own quiet marker (message key,
    default "grouped"), distinct from "hidden". Rationale: the marker's job
    is to explain why a column the user can filter by is absent from the
    header; a grouped column that is still drawn needs no explanation. Read
    at render time like the hidden set (the SP1 stale-closure rule).

12. **The descriptor memo's stable-deps rule gets its missing test.** The
    rule ("deps are handles and props-derived values, never engine state")
    has no enforcement; an unstable dep leaves every gate green because
    React reconciles by position. This sub-project adds a jsdom test that
    fails when the descriptor array is rebuilt by an engine-state-only
    change (mechanism chosen at plan time — render-count probe or identity
    capture), plus the inverse: sections still observe fresh engine state.
    Mutation-check both directions.

## Architecture

### State ownership

Same as the filters section: **a projection of engine state, no draft
store.** Three subscriptions, each to the layer that owns the state:

- `rowGroups` — row-model snapshot (the section subscribes itself, as
  `FiltersSection` does to `query.filters`).
- `hideGroupedColumns`, `columnAggregates` — indexed-grid state
  (`useSyncExternalStore` over the grid, as `ColumnsSection` does for
  layout).
- The aggregate select needs the **effective** value per column: the
  override if the id is present in `columnAggregates` (LAYOUT vocabulary —
  the section reads grid state, so no translation is owed; the translation
  to schema ids happens below it in `usePretable`), else the prop-declared
  `aggregate` from the column definitions the surface bakes into the
  descriptor (prop-derived, so the memo may hold it).

No local state at all — every control commits discretely (select, button,
switch, drag release). Nothing here needs a debounce.

### Files

New `packages/react/src/tool-panel/grouping/`:

- `GroupingSection.tsx` — the section: group-by list, expansion buttons,
  hide-grouped switch, aggregates block.
- `AddGroupMenu.tsx` — the `+ Add group` menu (shared menu-keyboard
  behavior).
- `aggregate-options.ts` — **pure**: the per-type option vocabulary,
  effective-value resolution, and option labels' data. Everything testable
  without React, per the repo's established split.
- `index.ts`.

Modified: `sections.ts` (`ToolPanelSectionId` gains `"grouping"`),
`messages.ts` + the surface's messages layer (new keys, all defaulted in one
place), the surface's descriptor construction (+ `setRowGroups`, +
`applyRowGroups` rework), `FiltersSection`/descriptor for the grouped
marker, `packages/row-model/src/aggregate-overrides.ts` (the `null`
sentinel), the `setColumnAggregate` TSDoc (document the sentinel),
`grid.css` (`:where()`-wrapped in `@layer pretable`, zero new tokens), and
the attribute-contract test (`data-pretable-*` additions for the section's
parts).

### The section descriptor

Adds the third entry to `toolPanelSections` under the existing deps rule:
handles and props-derived values only. New deps: `setRowGroups` /
`applyRowGroups` (stable callbacks), the columns' declared aggregates
(props-derived), and the mode flag (`model !== undefined`, a prop). Engine
state (`rowGroups`, `columnAggregates`, `hideGroupedColumns`, drawn/hidden
sets) is reached by subscription or render-time read, never baked in.

## Behavior details that are decisions, not details

- **Removing the last group-by level empties the aggregates' visible effect
  but not their state** — overrides persist in engine state and re-apply
  when grouping returns. The aggregates block stays visible while
  ungrouped (rows mode): aggregates are per-column configuration, not
  per-grouping, and hiding the block would make a configured override
  unreachable.
- **Expansion buttons are enabled only while grouped** — disabled with the
  standard disabled treatment when `rowGroups` is empty (they act on
  groups; with none, they are noise).
- **Reorder writes the full list** (`onChange`-style whole-array commit,
  like the strip) — no add/remove/move protocol.
- **A grouped column hidden by SP1's visibility** still shows in the
  group-by list (grouping by a hidden column is legal and in effect);
  no special marking — the strip does not mark it either, and the two must
  not diverge.
- **The synthetic group column never appears in the aggregates list** — the
  list is built from schema data columns (the prop-derived definitions),
  which cannot contain `GROUP_COLUMN_ID`. This also sidesteps the
  `TColumnId` vocabulary gap on the surface handle: the pane only ever
  passes schema-id-shaped layout ids for real data columns, where the two
  vocabularies agree.

## Verification

- **Pure unit (`aggregate-options.ts`):** the vocabulary pin against the
  real compiler — every offered builtin compiles, every withheld builtin
  throws (`CompiledQueryValidationError`), for every column type. This is
  the disprove-capable fixture: a mirror that drifts fails the pin.
- **row-model unit:** the `null` sentinel — declared aggregate + `null`
  override strips it (assert the computed group row shows nothing, not just
  the label); no-declared + `null` returns the input array identity;
  `undefined` semantics unchanged; `derivationsEqualForPlan` sees the strip
  as a change (both directions, per SP3a's two-sided rule).
- **jsdom (react):** group-by add/remove/reorder writes through
  `setRowGroups` and the funnel-resubmit regression (a panel grouping write
  followed by a funnel filter commit must not resurrect the old grouping —
  the `pendingQueryRef` debt made observable); expansion buttons; the
  hide-grouped switch round-trip; aggregate override set / clear /
  None with fixtures whose computed result differs from the prop's;
  `Default (…)` vs concrete-value distinguishability; mode gating (explicit
  model → no aggregates block); the grouped marker in the filters picker
  (on only when grouped **and** hide-grouped); the descriptor stability
  test (decision 12). **Grouped-grid tests respect the recorded
  setDerivations budget: ~4 derivation flips per grid, ~7 per jsdom module —
  split across files with the budget comments SP3a used.**
- **Playwright:** keyboard walk through the grouping section (one rail
  stop in, no trap out — `grid-tab-wrap-rows.spec.ts` names the rail stop);
  add + remove a group level from the pane reflected in the grid; an
  aggregate change visible on a real group row; strip and pane staying in
  sync. Convert the two filed raceable one-shot assertions to
  `expect.poll` while in these files (`apps/website/e2e/grouping.spec.ts`
  and the group-collapse assertion in
  `pretable-surface-editing.test.tsx`).
- **Docs:** `grid/tool-panel.mdx` grows the grouping section (including the
  two-writer note and rows-mode-only aggregates); `ToolPanelSectionId`
  gaining `"grouping"` moves the api report **and** trips the docs guard's
  string-union check until the prose enumerates it; new message keys join
  the messages table (guard-registered). `pnpm build` before `pnpm api`.
- **Changesets:** `@pretable/react` minor, `@pretable/ui` minor (css),
  `@pretable-internal/row-model` minor (sentinel).
- Assert the old behavior survives: the strip's drag-to-group, the header
  menu's group action, and grouped copy/CSV (no synthetic column) all still
  pass with the section shipped.

## Out of scope

Saved views; exposing `setExpansionDefault`; aggregate functions the pane
authors (custom aggregator objects remain prop-only); arbitration of the
hide-grouped two-writer situation; the `TColumnId` vocabulary gap on
`PretableSurfaceGrid` (pre-existing, filed); the module-cumulative
`setDerivations` stall (respected, not fixed here); the duplicated
`MAX_FILTER_TREE_DEPTH` constant.

# Grouping State (Tool Panel SP3a) — Design

**Status:** approved direction; SP3a specced in full, SP3b (the pane) outlined.
**Parents:** `2026-08-24-tool-panel-design.md` (SP3 of the tool panel), and the column-visibility precedent in `2026-08-24-tool-panel-sp1-shell-columns.md`.

## What this is

Two pieces of consumer-owned grouping config become **engine state a pane can
write**: a column's `aggregate`, and `hideGroupedColumns`. This is the engine
prerequisite for SP3b, the tool panel's grouping section — the same
engine-first split SP1 used for column visibility and SP2 used for the filter
tree, because a pane cannot compose against state that does not exist.

## Decisions locked (and why)

1. **The pane controls group-by, expansion, aggregates, and the
   hide-grouped-columns switch.** Group-by (`rowGroups`, in the query) and
   expansion (`expandAll` / `collapseAll` / `setGroupExpanded`) are already
   runtime-settable and need no engine work. The other two do.
2. **Engine-first split: SP3a (this) then SP3b (the pane).** Same reasoning as
   SP2: a combined PR spans row-model → core → react → ui → docs, and SP2b was
   nine tasks without an engine change.
3. **Lift into engine state**, rather than a callback pattern or an
   uncontrolled-with-override shape. Column order and pinning were lifted for
   exactly this reason and the columns pane proves the pattern. The
   alternatives each add a _second_ ownership model to a codebase that has
   one; the callback shape would also ship the section inert until a consumer
   wires it, unlike the other two panes.
4. **The strip and the pane coexist on one model.** The drag-to-group strip
   stays as the fast path; the pane is the full surface; both read and write
   the same `rowGroups`. This mirrors the header funnel and the filter
   builder, a pairing users have now learned. Rejected: deleting the strip
   (a visible capability regression, and it would retire a discoverable
   gesture to save ~800 lines) and hiding it behind its existing
   `groupPanel.enabled` flag (keeps both without presenting both, which is
   the worst of the two).

## A premise corrected during design

The first framing of this work claimed aggregates need new engine surface.
**They do not.** `setDerivations` is public, `PretableDerivationsFor` carries
`aggregate` per column, and `use-pretable.ts` already calls it gated on
`derivationsChanged` — so changing a column's `aggregate` re-derives at
runtime today.

The real problem is narrower and is the same for both items: **they live in
consumer-owned config, so a pane write is overwritten by the next re-derive**,
and a consumer passing the prop would fight the pane — the trap the filters
example documents for a controlled `query`. That is an _ownership_ problem,
not a missing-capability one, which is why decision 3 is the whole of it.

## Aggregates: an override layer

`setColumnAggregate(columnId, aggregate)` joins the grid model, shaped exactly
like `setColumnPinned`: `command()` wrapper, freeze discipline, no-op
early-return when unchanged, strip-when-clearing rather than writing
`undefined`.

The engine value is an **override layer over the derived one**. A column with
no override still follows its prop, so a consumer who never opens the pane
sees today's behaviour exactly; a column the pane has set holds that setting
across re-derives. Clearing the override returns the column to its prop.

This is the shape that keeps the prop meaningful. The alternative — the engine
owning the value outright, seeded once — would make the prop dead after mount
and silently ignore a consumer who changes it.

## `hideGroupedColumns`

Moves from a surface prop (read at `pretable-surface.tsx:~2086`, feeding
`effectiveColumns`) into engine state with `setHideGroupedColumns(boolean)`,
seeded from the prop at mount. The read sites switch to the engine value.

## The audit

Every reader of `aggregate` and of `hideGroupedColumns` gets a recorded
verdict — engine-aware, prop-only-by-design, or display-only — as a code
comment where non-obvious. Known candidates, to be completed by grep during
planning: group-row rendering (`group-row.tsx`), `formatAggregate`, the row
model's `#aggregateColumns` and `captureAggregator`, `effectiveColumns`, the
filters pane's column list, the header, CSV/export, the bench adapters, the
docs examples.

**This is where the bugs will be.** SP1's identical audit found seven
consumers resolving a column span against the wrong source.

## Two traps, named

1. **`PretableDerivationsFor` is a large mapped type over `TColumns`.**
   Extending it must be probed with the repo's `IsNever` discipline — a
   collapse to `never` compiles every downstream guard while checking
   nothing, and that has shipped here before.
2. **`derivationsEqualForPlan` gates plan reuse.** If the override does not
   participate in that comparison, changing an aggregate will not recompute;
   if it participates wrongly, every publish recomputes. **Both directions get
   tests** — the same two-sided requirement SP2a's tree-equality work carried.

## Verification

- row-model and grid-core unit tests with fixtures that can **disprove**: an
  aggregate override whose computed _result_ differs from the prop's, not just
  its label, so a no-op implementation cannot pass.
- Type-level `IsNever` probes on the extended mapped type.
- The audit table complete, every site verdicted.
- api reports regenerate (core + react move; **build before `pnpm api`**).
- Changesets: `@pretable/core` minor, `@pretable/react` minor.

## Out of scope for SP3a

The pane itself (SP3b); any change to the drag-to-group strip; group-by
ordering and expansion (already runtime-settable, nothing owed); aggregate
_functions_ beyond what a column may already declare; and the grouped-column
presentation question the filters picker left open, which belongs to SP3b.

## SP3b outline (for continuity, not specced here)

The grouping section: group-by list with reorder/add/remove, expansion
controls, a per-column aggregate picker, and the hide-grouped toggle —
coexisting with the strip on one model. It also inherits three things SP2b
recorded: `applyRowGroups` is the last `pendingQueryRef` bypass and must route
through `queryWith`; the descriptor memo's stable-deps rule has no test; and
grouped-column presentation in the filters picker is undecided.

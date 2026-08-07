# Row grouping, sub-project 3: the drag-to-group panel

Date: 2026-08-07
Status: approved
Predecessors: `2026-08-07-row-grouping-engine-design.md` (SP1, #237),
`2026-08-07-row-grouping-render-design.md` (SP2, #254)

## Problem

SP1 and SP2 made grouping work. Nothing in the UI can *change* it. `rowGroups`
is reachable only through the `@experimental` `state` escape hatch or a
column-level `rowGroup: true` flag — there is no user-facing way to group,
ungroup, or reorder levels.

SP3 adds the panel: a strip above the header where columns are dropped to
group by them, and where the active grouping levels are shown, reordered, and
removed.

## Scope

In: the panel, header→panel drag, chip reorder and removal by drag and by
keyboard, a real column menu with Group by / Ungroup, and `onRowGroupsChange`.

Out: docs and hero adoption (SP4), per-chip aggregation pickers, pivot,
`groupLockGroupColumns`-style locked levels, and panel autoscroll when chips
overflow. Each is under "Deliberately not doing".

## Decisions

### 1. The panel is rendered by `PretableSurface`

Enabled with `groupPanel={{ enabled: true }}`, matching `rowSelectionColumn`.
The package exports only grid surfaces — the funnel, the filter dialog, and
every editor are internal — so a separately-mounted component would be the
first of its kind *and* would put a pointer drag across two component trees.

**This forces a structural change.** The surface's root element *is* the scroll
viewport (`pretable-surface.tsx:1819-1832`): it carries
`data-pretable-scroll-viewport`, `overflow: auto`, `contain: content`, and
`role="grid"`/`"treegrid"`. A panel cannot go inside it — content inside a
`grid` role must be rows and rowgroups, so a listbox of chips there is invalid
ARIA, and `minWidth: totalWidth` would scroll it sideways with the data.

So the surface grows an outer wrapper. The wrapper holds the panel and the
current root; the current root keeps every attribute it has today. Nothing
about the grid's own DOM changes.

**Height:** when the panel is enabled it consumes from `viewportHeight` rather
than adding to it, so the component still occupies exactly `viewportHeight`
overall. `bodyViewportHeight` becomes `viewportHeight - headerHeight -
panelHeight`. An ungrouped grid with no panel is bit-for-bit unchanged.

**Visibility:** an enabled panel is always visible, including when no grouping
is active — that is when its "Drag a column here to group" message matters.
ag-grid's `rowGroupPanelShow: 'onlyWhenGrouping'` is a trap we are not copying:
a panel that appears only once you are already grouped cannot be used to do the
grouping.

### 2. Drag, disambiguated purely by which rectangle the pointer is over

The header already has a pointer drag for column reorder
(`pretable-surface.tsx:2329-2453`, 5px threshold, capture on the header button,
`computeColumnDropTarget` for the drop index). SP3 gives that same drag a second
drop zone: release over the panel's rect and the column is grouped; release over
the header or body and it reorders; release over neither and nothing happens.

No modifier key, no gesture, no intent heuristic — this is what ag-grid does
(`baseDragAndDropService.ts:295-350`) and it is the only model users can
predict. Two notes carried from that source:

- **The ghost must keep `pointer-events: none`** or it sits under the cursor and
  makes the drop zones unhittable. Ours already does
  (`packages/ui/src/grid.css:341-362`) — do not lose it.
- **A hidden or zero-size panel must be excluded from hit-testing**, not merely
  invisible (`isMouseOnDropTarget`, `:265`).

### 3. Commit on drop; cancel restores. This is where we beat ag-grid.

ag-grid mutates state on drag *leave*, not on drop
(`pillDropZonePanel.ts:386-403`): drag a chip out of the panel and the column
is ungrouped the instant the pointer crosses the boundary, before you release.
Escape afterwards does not restore it (`onDragCancel` only unwinds additions).
An accidental flick outside the panel destroys the grouping with no undo. They
also hide the dragged column from the grid on drag *enter*, before any drop.

We do neither. Nothing calls `setRowGroups` until pointerup over a valid zone;
Escape and pointercancel restore the pre-drag state exactly.

This is not only safer, it deletes a whole class of bug. ag-grid needs a
`nudge()` mechanism — replaying the last pointer event synthetically
(`baseDragAndDropService.ts:135-140`) — precisely *because* their mid-drag
mutations reflow the header under a stationary pointer, invalidating every
cached rect. Committing on drop means the layout never moves mid-drag, so we
need no nudge, and no `fromNudge` flag to stop visibility toggles from looping.

### 4. Drag listeners belong on the document, not on the chip

For header→panel this is already true enough: the header button survives the
drag, so the existing capture-on-`currentTarget` stands.

For **chip→chip reorder it is not**. The chips re-render as the insertion index
changes, and a pointer capture on a node that React moves or replaces is lost
mid-gesture. So chip drags capture on the **panel container** — which is stable
— and listen on the document.

Relatedly, the drag payload is captured at drag start. Ours is a column **id**
string, so this is nearly free; ag-grid's equivalent bug is a null dereference
because their chip nulls its own `column` field on destroy
(`dropZoneColumnComp.ts:398-401`).

### 5. Chips are a listbox, and the keyboard model matches ag-grid's

Container is `role="listbox"` when it has chips and `role="presentation"` when
empty — a listbox with zero options fails axe (`pillDropZonePanel.ts:611`).
Chips are `role="option"` with `aria-posinset` and `aria-setsize`.

| Key | Effect |
|---|---|
| `ArrowLeft` / `ArrowRight` | move focus between chips |
| `Shift` + arrow | move the focused grouping level |
| `Delete` / `Backspace` | remove the focused level |

All three reduce to one `setRowGroups` call with a rearranged array. This is a
list-widget model, not drag-and-drop, and is much cheaper than it sounds.

Each chip's accessible name composes the column name with its position and the
available keys; the visible text is `aria-hidden` so a screen reader does not
read the name twice (`dropZoneColumnComp.ts:51`, `pillDragComp.ts:117-125`).

### 6. A real column menu, since none exists

The only header popover today is `FilterMenu` — `role="dialog"`, filter-specific
form controls, no `role="menu"` or `menuitem` anywhere in the package. So the
accessible "group by this column" path has to be built.

A `⋮` button joins the funnel in the header's trailing overlay strip, opening a
`role="menu"` popover with **Group by this column** / **Ungroup this column**.
It reuses `useFilterPopover`'s positioning, `OverlayPortal`, outside-click and
Escape handling — generalized, not duplicated. The funnel and filter dialog are
untouched.

The header's trailing strip is currently 22px (18px funnel + 4px resize); the
menu button extends it.

Which item shows depends on state, and the default makes one of them rare:
with `hideGroupedColumns` at its default, grouping a column removes its header
entirely, so there is normally nothing to show **Ungroup** on. The rules:

| Column | Menu item |
|---|---|
| ungrouped | **Group by this column** |
| grouped, `hideGroupedColumns: false` | **Ungroup this column** |
| grouped, default (no header rendered) | n/a — ungroup from the chip's ✕ |
| the derived group column | no menu at all |

So the chip's ✕ is the primary ungroup affordance and the menu item is the
`hideGroupedColumns: false` case. Both must exist; only the first is common.

## Public API

```ts
groupPanel?: { enabled: boolean; emptyMessage?: string };
onRowGroupsChange?: (rowGroups: string[]) => void;
```

`onRowGroupsChange` follows `onSortChange` / `onFiltersChange` exactly
(`pretable-surface.tsx:396-414`): fired from the surface's own handlers with the
engine's full list after the change, so a consumer can mirror it into
controlled `state.rowGroups`. Programmatic `grid.setRowGroups` does not fire it,
matching how `grid.moveColumn` stays silent.

**The panel holds no state of its own.** It is a pure projection of
`snapshot.rowGroups`, re-read every render — the one design decision worth
copying wholesale from ag-grid (`rowGroupDropZonePanel.ts:66-68`). The only
transient state is the in-flight drag's insertion index.

## Consequences to state plainly

**Reordering levels resets expansion.** `setRowGroups` clears
`groupExpansionOverrides` on any change (`create-grid-core.ts:1152-1164`),
because expansion ids are path-derived and changing the levels invalidates every
path. Dragging a chip therefore collapses everything back to the default. This
is correct, not a bug, but it is surprising enough to belong in SP4's docs.

## Deliberately not doing

- **Per-chip aggregation pickers.** Aggregation is configured per *column*
  today, not per grouping level; this needs an engine model change and is its
  own sub-project. ag-grid only offers it in the value zone anyway
  (`dropZoneColumnComp.ts:229-231`).
- **Panel autoscroll.** Many chips overflow; ag-grid autoscrolls with an
  interval, a 50px buffer, and escalating step size
  (`moveColumnFeature.ts:578-641`). Ours wraps instead. Revisit if it bites.
- **Locked grouping levels** (`groupLockGroupColumns`).
- **Sorting by clicking a chip.** ag-grid does this; it collides with the chip
  being a drag handle and a listbox option at once.
- **RTL insertion-index flipping.** ag-grid flips the index, not just the CSS
  (`getNewInsertIndex`, `:301-315`). We have no RTL story anywhere yet; adding
  one here only would be misleading. Worth a tracked follow-up.

## Testing

- **jsdom**: panel renders and projects `rowGroups`; empty message; role flips
  `presentation` ↔ `listbox`; chip `aria-posinset`/`setsize`; every keyboard
  binding; `onRowGroupsChange` payloads; menu items appear, act, and are absent
  when they should be; the panel consumes from `viewportHeight`.
- **Real browser (Playwright)**: header dragged onto the panel groups;
  header dragged to the header row still *reorders* and does not group — the
  disambiguation is a rect test and jsdom has no rects; chip dragged to a new
  index reorders; Escape mid-drag restores the pre-drag grouping; a drag
  released over neither zone changes nothing.

Follow the established drag pattern in `apps/website/e2e/smoke.spec.ts:885-983`
— `waitForStablePosition`, the retry grab loop, and `mouse.move(..., { steps: 3 })`,
which exists because WebKit only engages pointer capture after intermediate
positions. Extend `apps/website/app/fixtures/grouping/page.tsx`.

Every keyboard binding and the Escape-restores behaviour need a negative
control: remove the one branch and confirm the test fails.

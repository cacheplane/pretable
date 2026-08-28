import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ColumnType } from "@pretable/core";

import { CloseIcon, GripIcon } from "../../icons";
import { popoverStyle } from "../../overlay/popover-position";
import { useHeaderPopover } from "../../overlay/useHeaderPopover";
import type { GroupingSectionMessages } from "../messages";
import type { ToolDropTarget, ToolRowRect } from "../tool-panel-drop-target";
import { dropTargetForPointer } from "../tool-panel-drop-target";
import { AddGroupMenu } from "./AddGroupMenu";
// Direct import, not the barrel: the barrel deliberately withholds
// aggregate-options (it is the section's internal vocabulary, not API).
import {
  builtinAggregatesForType,
  effectiveAggregate,
  isBuiltinAggregate,
  type BuiltinAggregate,
} from "./aggregate-options";

/**
 * The slice of the react grid handle the grouping section drives. Structural,
 * exactly as `ColumnsSectionGrid` is: the surface hands in its own
 * `indexedGrid` (stable for the model's lifetime), and this type documents
 * that the section reads LIVE engine state — `hideGroupedColumns` and
 * `columnAggregates` — through it rather than closing over a snapshot, the
 * SP1 stale-closure trap.
 *
 * `setColumnAggregate` takes `unknown` here as it does on the full handle,
 * but the section only ever passes the closed vocabulary from
 * `aggregate-options.ts` — that restriction is the pane's validation (spec
 * decision 3), since an invalid aggregate destroys the mounted grid.
 */
export interface GroupingSectionGrid {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => {
    readonly hideGroupedColumns?: boolean;
    readonly columnAggregates: Readonly<Record<string, unknown>>;
  };
  readonly setHideGroupedColumns: (value: boolean) => void;
  readonly setColumnAggregate: (columnId: string, aggregate: unknown) => void;
}

/**
 * The slice of the row-model handle the section drives: `rowGroups` read live
 * from the query (the section subscribes itself, as `FiltersSection` does to
 * `query.filters`), and the two expansion writes. Return types erased to
 * `void`-shaped `unknown`: the section never reads a mutation result.
 */
export interface GroupingSectionRowModel {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => {
    readonly snapshot: {
      readonly query: {
        readonly rowGroups: readonly { readonly columnId: string }[];
      };
    };
  };
  readonly expandAll: () => unknown;
  readonly collapseAll: () => unknown;
}

/**
 * One schema data column as the section sees it — props-derived, baked into
 * the descriptor by the surface's `groupingSectionColumns` memo. The derived
 * group column can never appear here (the memo starts from the authoritative
 * column DEFINITIONS), which is what keeps the synthetic column out of the
 * aggregates list by construction.
 */
export interface GroupingSectionColumn {
  readonly id: string;
  readonly label: string;
  readonly type?: ColumnType;
  /** The prop-declared `aggregate`, for the picker's `Default (…)` face. */
  readonly declaredAggregate?: unknown;
}

export interface GroupingSectionProps {
  readonly grid: GroupingSectionGrid;
  readonly rowModel: GroupingSectionRowModel;
  /**
   * The surface's one grouping write — the same stable function the strip and
   * the header menu call, so the pane never grows a second write path.
   *
   * The optional focus-intent parameter the surface's function also takes is
   * dropped from this slice ON PURPOSE: the pane owns its own focus, as
   * `FiltersSection` does, and never asks the grid to move it.
   *
   * Labels come from {@link GroupingSectionProps.columns} — no separate
   * `labelForColumn` here: that memo already carries the same `header ?? id`
   * projection for every schema column, and a grouped id outside the schema
   * falls back to the raw id under either lookup.
   */
  readonly applyRowGroups: (next: readonly string[]) => void;
  readonly columns: readonly GroupingSectionColumn[];
  /**
   * Rows mode only (spec decision 6): `false` in explicit-model mode, where
   * an aggregate write lands in engine state and changes nothing a group row
   * shows — the block is then absent, never visible-but-inert.
   */
  readonly aggregatesEnabled: boolean;
  /** Resolved surface messages — this section defaults no string itself. */
  readonly messages: GroupingSectionMessages;
}

/**
 * The picker's non-builtin option values. The onChange mapping ASSUMES these
 * stay disjoint from the builtin names — nothing structural enforces that
 * (the vocabulary pin only catches the mirror drifting from the compiler),
 * so the assumption is pinned by the picker test's exact-option-list
 * assertion: a builtin named like one of these would collide there.
 */
const DEFAULT_OPTION = "default";
const NONE_OPTION = "none";
const CUSTOM_OPTION = "custom";

/** Same slop the columns section (and the header drag) use before a press
 * becomes a reorder. */
const DRAG_THRESHOLD_PX = 5;

/** A press on a grip that has not (yet) crossed the drag threshold. */
interface PendingRowDrag {
  columnId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

/** The in-flight drag the render reflects: dim the row, draw the line. */
interface ActiveRowDrag {
  readonly columnId: string;
  readonly target: ToolDropTarget;
}

/**
 * One rendered subgroup for the drop-target geometry. The group-by list has
 * no pin partition — a single group, always — but `dropTargetForPointer` is
 * the columns section's machinery and speaks in groups, so the list presents
 * itself as exactly one.
 */
const SINGLE_GROUP = [{ pinned: null }] as const;

/**
 * The tool panel's grouping section: group-by list, expansion buttons,
 * hide-grouped switch, aggregates block — in that order (spec decision 1).
 *
 * The group-by list is a PURE PROJECTION of `snapshot.query.rowGroups` — the
 * strip's rule, and for the strip's reason (its TSDoc): neither keeps a
 * copy, so neither can ever show a level the engine does not hold. Every
 * mutation is a discrete whole-array `applyRowGroups` commit; there is no
 * local list and no optimistic state.
 */
export function GroupingSection({
  grid,
  rowModel,
  applyRowGroups,
  columns,
  aggregatesEnabled,
  messages,
}: GroupingSectionProps) {
  // The section's OWN subscription, and the SNAPSHOT slice rather than the
  // state (FiltersSection's pattern): `rowGroups` changes identity only when
  // a query commits, so every other publish bails in useSyncExternalStore's
  // equality check instead of repainting the pane.
  const readRowGroups = useCallback(
    () => rowModel.getState().snapshot.query.rowGroups,
    [rowModel],
  );
  const rowGroups = useSyncExternalStore(
    rowModel.subscribe,
    readRowGroups,
    readRowGroups,
  );
  const groupedIds = rowGroups.map((level) => level.columnId);

  // The hide-grouped switch's read: the section's OWN grid subscription
  // (the freshness rule — never a closed-over snapshot). The slice is the
  // BARE BOOLEAN, not the state object: `getState()` hands back the engine's
  // current state object, but reading through to the primitive makes the
  // cached-snapshot question moot — a primitive is its own identity, so
  // every publish that leaves the flag alone bails in useSyncExternalStore's
  // equality check. Absent reads as TRUE: the engine leaves the key off
  // until somebody states a preference, and the surface's drawn-column
  // resolution hides grouped columns unless the value is EXPLICITLY false
  // (`resolveEffectiveColumns`: "absent means the default, which is ON") —
  // a switch defaulting the other way would show OFF while the grid is
  // actively hiding the column.
  const readHideGrouped = useCallback(
    () => grid.getState().hideGroupedColumns ?? true,
    [grid],
  );
  const hideGroupedColumns = useSyncExternalStore(
    grid.subscribe,
    readHideGrouped,
    readHideGrouped,
  );

  // The aggregate pickers' read: the section's OWN grid subscription, over
  // the `columnAggregates` RECORD. Unlike the hide-grouped boolean above
  // there is no primitive to slice down to, so this leans on the engine's
  // identity contract instead: the top-level state object is fresh on every
  // publish, but the RECORD inside it keeps its reference across publishes
  // that do not touch aggregates — which is exactly why the slice reads
  // through to the record, so every unrelated publish bails in
  // useSyncExternalStore's equality check. Do NOT re-apply the "primitive is
  // its own identity" argument here; it is scoped to the boolean read above.
  const readColumnAggregates = useCallback(
    () => grid.getState().columnAggregates,
    [grid],
  );
  const columnAggregates = useSyncExternalStore(
    grid.subscribe,
    readColumnAggregates,
    readColumnAggregates,
  );

  // Labels come from the props-derived `columns`; a grouped id outside the
  // schema renders as itself — same fallback the strip's chips use.
  const labelFor = (columnId: string) =>
    columns.find((column) => column.id === columnId)?.label ?? columnId;

  // The aggregate builtins' display names — one per builtin, from the
  // resolved messages. Hoisted out of the per-column render: it depends on
  // `messages` alone.
  const builtinLabel = (name: BuiltinAggregate): string => {
    switch (name) {
      case "sum":
        return messages.toolPanelAggregateSumLabel();
      case "avg":
        return messages.toolPanelAggregateAvgLabel();
      case "min":
        return messages.toolPanelAggregateMinLabel();
      case "max":
        return messages.toolPanelAggregateMaxLabel();
      case "count":
        return messages.toolPanelAggregateCountLabel();
    }
  };

  const ungrouped = columns.filter((column) => !groupedIds.includes(column.id));

  // The add menu, on the header popovers' own hook for the columns section's
  // reason: the pane scrolls, and a frozen open-time rect would leave the
  // `position: fixed` menu drifting the moment the list scrolls under the
  // button. There is exactly one add button, so the hook's columnId
  // discriminant is a constant.
  const {
    openState: menu,
    toggle: toggleMenu,
    close: closeMenu,
  } = useHeaderPopover();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const closeAddMenu = useCallback(
    (restoreFocus: boolean) => {
      closeMenu();
      if (restoreFocus) {
        // Synchronous: closing does not remount the button, and an Escape's
        // focus return must land before any later handler in the same
        // dispatch can observe it. A DISABLED button takes no focus (a
        // concurrent write can group the last column while the menu is up),
        // so the section container is the fallback landing.
        const button = addButtonRef.current;
        if (button !== null && !button.disabled) button.focus();
        else sectionRef.current?.focus();
      }
    },
    [closeMenu],
  );

  // Per-id row nodes, measured on every drag move — never cached: the pane
  // scrolls without a React render, and a stale rect would put the drop a
  // scroll-distance from the pointer.
  const rowNodesRef = useRef(new Map<string, HTMLElement>());
  // Per-id grips, for handing focus back after a reorder. Unlike the columns
  // section's synchronous layout writes, `applyRowGroups` SETTLES
  // asynchronously (post-#321), so the pending focus is consumed only once
  // `rowGroups` has actually moved — a commit before the settle (any
  // unrelated publish) must not eat it.
  const gripNodesRef = useRef(new Map<string, HTMLElement>());
  const pendingGripFocusRef = useRef<{
    id: string;
    baseline: typeof rowGroups;
  } | null>(null);
  useEffect(() => {
    const pending = pendingGripFocusRef.current;
    if (pending === null) return;
    if (rowGroups === pending.baseline) return;
    pendingGripFocusRef.current = null;
    gripNodesRef.current.get(pending.id)?.focus();
  });

  // The press-in-progress lives in a ref (every pointermove reads it, most
  // discard it under the threshold); only a drag past the threshold becomes
  // state, because only then does the render change.
  const pendingDragRef = useRef<PendingRowDrag | null>(null);
  const [drag, setDrag] = useState<ActiveRowDrag | null>(null);

  const measureRows = (): readonly ToolRowRect[] => {
    const rects: ToolRowRect[] = [];
    for (const id of groupedIds) {
      const node = rowNodesRef.current.get(id);
      if (node === undefined) continue;
      const rect = node.getBoundingClientRect();
      rects.push({ id, top: rect.top, height: rect.height, groupIndex: 0 });
    }
    return rects;
  };

  /**
   * Apply a finished move: the whole reordered array, committed ON RELEASE
   * only — never on drag-leave or mid-move (the settled rule all three drag
   * surfaces follow). The current order is re-read from the row model at
   * commit time, not closed over: the render's projection could be one
   * settle behind a concurrent write.
   */
  const commitMove = (columnId: string, target: ToolDropTarget) => {
    const current = rowModel
      .getState()
      .snapshot.query.rowGroups.map((level) => level.columnId);
    if (!current.includes(columnId)) return;
    // Unlike the columns section, the rendered list IS the whole model — no
    // search filter, no hidden partition — so the insertion index needs no
    // rendered-neighbor translation.
    const beforeId = current[target.beforeRow] ?? null;
    if (beforeId === columnId) return; // its own slot: nothing to move
    const next = current.filter((id) => id !== columnId);
    const insertAt = beforeId === null ? next.length : next.indexOf(beforeId);
    if (insertAt === -1) return;
    next.splice(insertAt, 0, columnId);
    if (next.every((id, index) => id === current[index])) return;
    applyRowGroups(next);
    pendingGripFocusRef.current = { id: columnId, baseline: rowGroups };
  };

  const endDrag = useCallback(() => {
    pendingDragRef.current = null;
    setDrag(null);
  }, []);

  // Escape mid-drag cancels without engine mutation — the rule every drag
  // surface here follows. Nothing has been committed at any point during the
  // drag, so abandoning the gesture IS the restore; `preventDefault` also
  // tells the pane's own Escape handler (which skips defaultPrevented
  // events) not to yank focus to the rail tab over a mere gesture cancel.
  const dragActive = drag !== null;
  useEffect(() => {
    if (!dragActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;
      event.preventDefault();
      endDrag();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dragActive, endDrag]);

  /**
   * The keyboard half of reorder — the columns section's chord, mirrored
   * exactly: Shift+ArrowUp/Down on a focused grip swaps the level with its
   * neighbor, no wrap and no commit at the list's ends. No pin-boundary arm:
   * this list has a single group.
   */
  const moveByKeyboard = (columnId: string, delta: 1 | -1) => {
    // Re-read from the row model at commit time, not the render projection:
    // a second chord before the first write settles must compute from the
    // order the engine will actually apply it to (commitMove's rule).
    const current = rowModel
      .getState()
      .snapshot.query.rowGroups.map((level) => level.columnId);
    const index = current.indexOf(columnId);
    if (index === -1) return;
    const neighbor = current[index + delta];
    if (neighbor === undefined) return;
    const next = [...current];
    next[index] = neighbor;
    next[index + delta] = columnId;
    applyRowGroups(next);
    pendingGripFocusRef.current = { id: columnId, baseline: rowGroups };
  };

  // Where the drop line sits, as an index into the rendered rows
  // (`groupedIds.length` = after the last row).
  const indicatorAt = drag !== null ? drag.target.beforeRow : null;

  return (
    // tabIndex -1: never in the tab order, but a programmatic focus landing
    // for the add-menu close when the button itself has become disabled.
    <div data-pretable-tool-grouping="" ref={sectionRef} tabIndex={-1}>
      {/* Group-by list: rows + Add group menu. */}
      <div>
        <div data-pretable-tool-group-label="">
          {messages.toolPanelGroupByLabel()}
        </div>
        {groupedIds.map((columnId, index) => {
          const label = labelFor(columnId);
          return (
            <Fragment key={columnId}>
              {indicatorAt === index ? (
                <div data-pretable-tool-drop-indicator="" />
              ) : null}
              <div
                data-pretable-column-id={columnId}
                data-pretable-tool-group-row=""
                ref={(node) => {
                  if (node) rowNodesRef.current.set(columnId, node);
                  else rowNodesRef.current.delete(columnId);
                }}
                {...(drag?.columnId === columnId
                  ? { "data-pretable-tool-row-dragging": "" }
                  : {})}
              >
                {/* The drag handle AND the keyboard-reorder control — the
                  columns section's grip verbatim (its comment argues the
                  span-with-role shape), with the grouping-specific
                  accessible name so the two grips that coexist in this
                  panel stay distinguishable. */}
                <span
                  aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown"
                  aria-label={messages.toolPanelReorderGroupLabel({ label })}
                  data-pretable-tool-row-grip=""
                  ref={(node) => {
                    if (node) gripNodesRef.current.set(columnId, node);
                    else gripNodesRef.current.delete(columnId);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (!event.shiftKey) return;
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                      return;
                    }
                    event.preventDefault();
                    moveByKeyboard(
                      columnId,
                      event.key === "ArrowDown" ? 1 : -1,
                    );
                  }}
                  // No stopPropagation — the pointerdown must reach the
                  // document so an open add menu's outside-press close fires.
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    if (event.shiftKey || event.metaKey || event.ctrlKey) {
                      return;
                    }
                    pendingDragRef.current = {
                      columnId,
                      pointerId: event.pointerId,
                      startX: event.clientX,
                      startY: event.clientY,
                      dragging: false,
                    };
                    // Capture NOW, not after the threshold — load-bearing on
                    // a ~16px handle (the columns section's comment carries
                    // the measurement); the 5px threshold still gates the
                    // dragging STATE, so a plain press never flickers the
                    // indicator.
                    try {
                      event.currentTarget.setPointerCapture(event.pointerId);
                    } catch {
                      // jsdom, or a pointer type without capture — no-op.
                    }
                  }}
                  onPointerMove={(event) => {
                    const pending = pendingDragRef.current;
                    if (pending === null || pending.columnId !== columnId) {
                      return;
                    }
                    if (event.pointerId !== pending.pointerId) return;
                    if (!pending.dragging) {
                      const dist = Math.hypot(
                        event.clientX - pending.startX,
                        event.clientY - pending.startY,
                      );
                      if (dist < DRAG_THRESHOLD_PX) return;
                      pending.dragging = true;
                    }
                    // Measured fresh on every move (the pane scrolls without
                    // a render); the pure function is the geometry authority.
                    const target = dropTargetForPointer(
                      event.clientY,
                      measureRows(),
                      SINGLE_GROUP,
                    );
                    setDrag(target === null ? null : { columnId, target });
                  }}
                  // Commit on drop, from the RELEASE coordinates measured
                  // here and now — both engines coalesce away the last
                  // pointermove before a quick release (the columns
                  // section's measured finding).
                  onPointerUp={(event) => {
                    const pending = pendingDragRef.current;
                    if (
                      pending === null ||
                      event.pointerId !== pending.pointerId
                    ) {
                      return;
                    }
                    const wasDragging = pending.dragging;
                    endDrag();
                    if (!wasDragging) return;
                    const target = dropTargetForPointer(
                      event.clientY,
                      measureRows(),
                      SINGLE_GROUP,
                    );
                    if (target !== null) {
                      commitMove(pending.columnId, target);
                    }
                  }}
                  onPointerCancel={endDrag}
                >
                  <GripIcon />
                </span>
                <span data-pretable-tool-column-label="">{label}</span>
                <button
                  aria-label={messages.toolPanelRemoveGroupLabel({ label })}
                  data-pretable-tool-group-remove=""
                  onClick={() =>
                    applyRowGroups(groupedIds.filter((id) => id !== columnId))
                  }
                  type="button"
                >
                  <CloseIcon />
                </button>
              </div>
            </Fragment>
          );
        })}
        {indicatorAt === groupedIds.length ? (
          <div data-pretable-tool-drop-indicator="" />
        ) : null}
        {groupedIds.length === 0 ? (
          <div data-pretable-tool-empty="">
            {messages.toolPanelNoGroupsMessage()}
          </div>
        ) : null}
        <button
          aria-expanded={menu !== null}
          aria-haspopup="menu"
          data-pretable-add-group=""
          disabled={ungrouped.length === 0}
          ref={addButtonRef}
          // Load-bearing, exactly as on the kebab: React delegates at the
          // root container, so stopping here keeps the pointerdown off
          // `document` — where the open menu listens for outside-clicks.
          // Without it the button could never dismiss its own menu.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            toggleMenu("menu", "add-group", event.currentTarget);
          }}
          type="button"
        >
          {messages.toolPanelAddRowGroupLabel()}
        </button>
        {menu !== null && ungrouped.length > 0 ? (
          <AddGroupMenu
            messages={messages}
            options={ungrouped}
            style={popoverStyle(menu.rect)}
            onClose={closeAddMenu}
            onSelect={(columnId) => {
              applyRowGroups([...groupedIds, columnId]);
              closeAddMenu(true);
            }}
          />
        ) : null}
      </div>
      {/* Expansion: Expand all / Collapse all (spec decision 7). Direct
        row-model writes — expansion is row-model state, not query state, so
        neither goes anywhere near `applyRowGroups`. DISABLED while
        ungrouped (behavior spec): the buttons act on groups, and with none
        they are noise — the standard disabled treatment, never
        display:none, so the pane's shape does not jump as grouping comes
        and goes. */}
      <div>
        <button
          data-pretable-expand-all=""
          disabled={groupedIds.length === 0}
          onClick={() => rowModel.expandAll()}
          type="button"
        >
          {messages.toolPanelExpandAllLabel()}
        </button>
        <button
          data-pretable-collapse-all=""
          disabled={groupedIds.length === 0}
          onClick={() => rowModel.collapseAll()}
          type="button"
        >
          {messages.toolPanelCollapseAllLabel()}
        </button>
      </div>
      {/* Hide-grouped-columns switch (spec decision 8): a labelled checkbox
        over ENGINE state — read above via the section's own subscription,
        written straight back through the handle. The two-writer situation
        (a consumer who keeps driving the `hideGroupedColumns` prop after
        mount clobbers this write) is the handle TSDoc's to document and
        the docs page's to repeat; the pane neither detects nor arbitrates
        it. */}
      <div>
        <label>
          <input
            checked={hideGroupedColumns}
            data-pretable-hide-grouped=""
            onChange={() => grid.setHideGroupedColumns(!hideGroupedColumns)}
            type="checkbox"
          />
          {messages.toolPanelHideGroupedColumnsLabel()}
        </label>
      </div>
      {/* Aggregates (spec decisions 3–6): one picker per schema data column,
        rows mode ONLY — in explicit-model mode the block is absent entirely,
        never a disabled ghost. It stays rendered while ungrouped: aggregates
        are per-column configuration, and hiding the block would make a
        configured override unreachable. The synthetic group column can never
        appear: `columns` is built from the authoritative definitions. */}
      {aggregatesEnabled ? (
        <div>
          <div data-pretable-tool-group-label="">
            {messages.toolPanelAggregatesLabel()}
          </div>
          {columns.map((column) => {
            const builtins = builtinAggregatesForType(column.type);
            // The Default option's face carries the DECLARED value's display
            // name (decision 4): a builtin's name, `Custom` for a declared
            // aggregator object, `None` when nothing is declared — so
            // "Default (Sum)" and a concrete "Sum" never look alike, which
            // is the key-presence semantic made visible.
            const declared = column.declaredAggregate;
            const declaredFace = isBuiltinAggregate(declared)
              ? builtinLabel(declared)
              : declared === undefined
                ? messages.toolPanelAggregateNoneOption()
                : messages.toolPanelAggregateCustomLabel();
            // Effective state, resolved by the module that mirrors the
            // merge's key-presence rule (a present-but-undefined key reads
            // as no override, exactly as `mergeColumnAggregateOverrides`
            // skips it).
            const effective = effectiveAggregate(
              column.id,
              declared,
              columnAggregates,
            );
            const selected = !effective.overridden
              ? DEFAULT_OPTION
              : effective.value === null
                ? NONE_OPTION
                : isBuiltinAggregate(effective.value)
                  ? effective.value
                  : CUSTOM_OPTION;
            return (
              <div
                data-pretable-aggregate-row=""
                data-pretable-column-id={column.id}
                key={column.id}
              >
                <span data-pretable-tool-column-label="">{column.label}</span>
                <select
                  aria-label={messages.toolPanelAggregateColumnLabel({
                    label: column.label,
                  })}
                  value={selected}
                  onChange={(event) => {
                    // The closed vocabulary IS the validation: an invalid
                    // aggregate destroys the mounted grid (setColumnAggregate
                    // TSDoc), so NOTHING outside these three mappings is
                    // ever written — the option VALUES, never their labels.
                    const value = event.target.value;
                    if (value === DEFAULT_OPTION) {
                      grid.setColumnAggregate(column.id, undefined);
                    } else if (value === NONE_OPTION) {
                      grid.setColumnAggregate(column.id, null);
                    } else if (
                      (builtins as readonly string[]).includes(value)
                    ) {
                      grid.setColumnAggregate(column.id, value);
                    }
                    // `custom` (and anything else): reflect-only, no write.
                  }}
                >
                  <option value={DEFAULT_OPTION}>
                    {messages.toolPanelAggregateDefaultOption({
                      label: declaredFace,
                    })}
                  </option>
                  <option value={NONE_OPTION}>
                    {messages.toolPanelAggregateNoneOption()}
                  </option>
                  {builtins.map((name) => (
                    <option key={name} value={name}>
                      {builtinLabel(name)}
                    </option>
                  ))}
                  {/* A consumer CAN write an aggregator object through the
                    handle. The picker reflects it honestly: one extra
                    selected `Custom` entry, present only while that state
                    holds — not a disabled decoy, and never something the
                    pane would write back (re-selecting it is a no-op). */}
                  {selected === CUSTOM_OPTION ? (
                    <option value={CUSTOM_OPTION}>
                      {messages.toolPanelAggregateCustomLabel()}
                    </option>
                  ) : null}
                </select>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

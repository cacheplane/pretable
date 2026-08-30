import type { RefObject } from "react";
import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { GROUP_COLUMN_ID } from "@pretable/core";

import { ROW_SELECT_COLUMN_ID } from "../constants";
import { CheckIcon, GripIcon, OverflowIcon } from "../icons";
import { popoverStyle } from "../overlay/popover-position";
import { useHeaderPopover } from "../overlay/useHeaderPopover";
import { ColumnPinMenu } from "./ColumnPinMenu";
import type { ToolPanelColumnsMessages } from "./messages";
import type { ToolDropTarget, ToolRowRect } from "./tool-panel-drop-target";
import { useToolRowDrag } from "./useToolRowDrag";

/**
 * One `columnLayout` entry, restated structurally rather than imported: the
 * section needs only these three fields, and naming them here keeps the
 * component free of the engine's generic parameters (the surface's drawn
 * column-id vocabulary is plain `string`).
 */
interface ColumnsSectionLayoutEntry {
  readonly id: string;
  readonly pinned?: "left" | "right";
  /** Present only when `true` — the engine's own encoding. */
  readonly hidden?: boolean;
}

/**
 * The slice of the react grid handle the columns section drives. Structural
 * on purpose: the surface hands in its own `indexedGrid` (stable for the
 * model's lifetime), and this type is what documents that the section reads
 * LIVE engine state through it rather than closing over a snapshot — the
 * Task 6 review's stale-closure trap.
 */
export interface ColumnsSectionGrid {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => {
    readonly columnLayout: readonly ColumnsSectionLayoutEntry[];
  };
  readonly setColumnVisible: (columnId: string, visible: boolean) => void;
  readonly setColumnPinned: (
    columnId: string,
    pinned: "left" | "right" | null,
  ) => void;
  readonly setColumnOrder: (columnIds: readonly string[]) => void;
  readonly setColumnAutoWidth: (columnId: string, auto: boolean) => void;
}

export interface ColumnsSectionProps {
  readonly grid: ColumnsSectionGrid;
  /**
   * Label projection for schema columns — the surface's `labelForColumn`
   * (header ?? id, same resolver the group panel's chips use). Props-derived,
   * so it changes identity exactly when the `columns` prop does; the derived
   * group/selection columns never reach it because the section excludes them.
   */
  readonly labelForColumn: (columnId: string) => string;
  /**
   * The layout captured once at SURFACE mount — not at section mount, because
   * the section unmounts whenever the pane closes and would otherwise adopt
   * whatever mutations preceded its reopen as the baseline. A ref rather than
   * a value so the capture-once semantics live with the surface; by the time
   * any section can render, the surface's first render has filled it.
   */
  readonly initialLayoutRef: RefObject<
    readonly ColumnsSectionLayoutEntry[] | null
  >;
  /**
   * The auto-width set as of the same surface-mount instant — the reset
   * baseline's other half. Column ids whose width the renderer owned at
   * mount (the ids that declared no `widthPx`); Reset returns exactly these
   * to auto and every other replayed id to manual.
   */
  readonly initialAutoWidthRef: RefObject<ReadonlySet<string> | null>;
  /** Resolved surface messages — this section defaults no string itself. */
  readonly messages: ToolPanelColumnsMessages;
}

/**
 * The three subgroups, in rendered order. Structure only — the headings come
 * from `toolPanelColumnGroupLabel`, so the surface's messages layer is the one
 * place the panel's English lives.
 */
const PIN_GROUPS = [
  { pinned: "left" },
  { pinned: undefined },
  { pinned: "right" },
] as const;

/**
 * The tool panel's columns section: the full `columnLayout` roster — hidden
 * entries included, because this pane is the one place a hidden column stays
 * visible — subgrouped by pin state, with visibility toggles, label search
 * and a reset to the mount-time layout. The grip and kebab complete the row
 * anatomy but are inert here: drag-reorder is Task 9's, the menu Task 8's.
 */
export function ColumnsSection({
  grid,
  labelForColumn,
  initialLayoutRef,
  initialAutoWidthRef,
  messages,
}: ColumnsSectionProps) {
  // Live engine state, read through the section's OWN subscription — never a
  // snapshot baked into the descriptor closure. The read returns the state's
  // `columnLayout` array, whose identity only changes on a layout publish, so
  // unrelated publishes (focus, selection, every scroll tick) bail in
  // useSyncExternalStore's equality check instead of re-rendering the pane.
  const readLayout = useCallback(() => grid.getState().columnLayout, [grid]);
  const layout = useSyncExternalStore(grid.subscribe, readLayout, readLayout);

  // Local, deliberately: the section unmounts when the pane closes, and a
  // reopened pane starting from an empty search is the expected behavior.
  const [query, setQuery] = useState("");

  // The open pin menu. The header popovers' own hook, reused rather than
  // re-plumbed: the section's rows live in a scrollable pane, so a frozen
  // open-time rect would leave the `position: fixed` menu drifting the moment
  // the list scrolls under it — and wheel scrolling fires neither pointerdown
  // nor a focus change, so nothing else would close it. The hook re-measures
  // on capture-phase scroll and resize, FOLLOWS the anchor while it is still
  // on screen, and closes only when it is genuinely gone (see its comment on
  // why close-on-scroll-event was the wrong rule). Only the "menu" kind is
  // used here; the hook's state is as local to this section as the query is.
  const {
    openState: menu,
    toggle: toggleMenu,
    close: closeMenuState,
  } = useHeaderPopover();
  // Per-id kebab nodes, so focus can be handed back AFTER a pin moves the row
  // across subgroup fragments and remounts its button — an element reference
  // captured at open time is disconnected by then.
  const kebabNodesRef = useRef(new Map<string, HTMLButtonElement>());
  // A ref, not state: the pending focus is consumed by the commit that the
  // pin's own layout publish already scheduled, so no extra render is needed
  // (or wanted — setState in an effect is a cascading-render smell). The
  // effect runs after every commit and is a no-op unless a select just armed
  // it.
  const pendingKebabFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingKebabFocusRef.current;
    if (id === null) return;
    pendingKebabFocusRef.current = null;
    kebabNodesRef.current.get(id)?.focus();
  });

  const openColumnId = menu?.columnId ?? null;
  const closeMenu = useCallback(
    (restoreFocus: boolean) => {
      closeMenuState();
      if (restoreFocus && openColumnId !== null) {
        // Synchronous, not via the pending-focus effect: closing does not
        // remount the kebab, and an Escape's focus return must land before
        // any later handler in the same dispatch can observe it.
        kebabNodesRef.current.get(openColumnId)?.focus();
      }
    },
    [closeMenuState, openColumnId],
  );

  const entries = layout
    .filter(
      (entry) =>
        entry.id !== GROUP_COLUMN_ID && entry.id !== ROW_SELECT_COLUMN_ID,
    )
    .map((entry) => ({ entry, label: labelForColumn(entry.id) }));
  const needle = query.trim().toLowerCase();
  const matched =
    needle === ""
      ? entries
      : entries.filter(({ label }) => label.toLowerCase().includes(needle));

  // The rendered subgroups (empty ones render nothing, so they are no drop
  // targets either — pinning into an empty group stays the pin menu's job)
  // and the flat row list across them. Both are what the drop geometry and
  // the keyboard moves reason over: RENDERED order, which under a search is
  // a subsequence of the layout — the commit inserts relative to a rendered
  // neighbor id, so filtered-out and derived ids keep their places.
  const renderedGroups = PIN_GROUPS.map((group) => ({
    pinned: (group.pinned ?? null) as "left" | "right" | null,
    rows: matched.filter(
      ({ entry }) => (entry.pinned ?? undefined) === group.pinned,
    ),
  })).filter((group) => group.rows.length > 0);
  const flatRows = renderedGroups.flatMap((group, groupIndex) =>
    group.rows.map(({ entry }) => ({ id: entry.id, groupIndex })),
  );

  // Per-id row nodes, measured on every drag move — never cached, for the
  // header drag's reason: the pane scrolls without a React render, and a
  // stale rect would put the drop a scroll-distance from the pointer.
  const rowNodesRef = useRef(new Map<string, HTMLElement>());
  // Per-id grips, for handing focus back after a keyboard move remounts the
  // row in another subgroup fragment — the kebab map's exact pattern.
  const gripNodesRef = useRef(new Map<string, HTMLElement>());
  const pendingGripFocusRef = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingGripFocusRef.current;
    if (id === null) return;
    pendingGripFocusRef.current = null;
    gripNodesRef.current.get(id)?.focus();
  });

  const measureRows = (): readonly ToolRowRect[] => {
    const rects: ToolRowRect[] = [];
    for (const row of flatRows) {
      const node = rowNodesRef.current.get(row.id);
      if (node === undefined) continue;
      const rect = node.getBoundingClientRect();
      rects.push({
        id: row.id,
        top: rect.top,
        height: rect.height,
        groupIndex: row.groupIndex,
      });
    }
    return rects;
  };

  /**
   * Apply a finished move: the dragged column joins `groupIndex`'s subgroup
   * (pin first, so the engine's stable pin regrouping is what places the
   * order) and slots in before the rendered row at `beforeRow`.
   *
   * `setColumnOrder` demands EVERY layout id exactly once, so the list is
   * the live full roster with only the moved id relocated: hidden columns
   * are rendered rows here and take part like any other, while search-
   * filtered rows and the derived group/selection columns keep their
   * relative positions — the settled `moveColumn` semantic, one axis over.
   */
  const commitMove = (columnId: string, target: ToolDropTarget) => {
    const group = renderedGroups[target.groupIndex];
    if (group === undefined) return;
    const live = grid.getState().columnLayout;
    const moved = live.find((entry) => entry.id === columnId);
    if (moved === undefined) return;
    if ((moved.pinned ?? null) !== group.pinned) {
      grid.setColumnPinned(columnId, group.pinned);
    }
    const beforeId = flatRows[target.beforeRow]?.id ?? null;
    if (beforeId === columnId) return; // its own slot: the pin was the move
    const remaining = grid
      .getState()
      .columnLayout.map((entry) => entry.id)
      .filter((id) => id !== columnId);
    let insertAt: number;
    if (beforeId === null) {
      const lastId = flatRows[flatRows.length - 1]?.id;
      insertAt =
        lastId === undefined || lastId === columnId
          ? remaining.length
          : remaining.indexOf(lastId) + 1;
    } else {
      insertAt = remaining.indexOf(beforeId);
      if (insertAt === -1) return;
    }
    remaining.splice(insertAt, 0, columnId);
    grid.setColumnOrder(remaining);
  };

  // The shared drag state machine (threshold, capture-at-pointerdown,
  // commit-on-release, Escape-cancel); this section contributes its rendered
  // pin subgroups and the pin-aware commit above.
  const { drag, gripHandlers } = useToolRowDrag({
    measureRows,
    groups: renderedGroups,
    commit: commitMove,
  });

  /**
   * The keyboard half of reorder: Shift+ArrowUp/Down on a focused grip swaps
   * the row with its rendered neighbor — the group-chip strip's chord turned
   * vertical, and the a11y hard gate's reason drag is not the only path. At
   * the list's ends nothing moves and nothing is committed (the chips' rule:
   * no wrap). Crossing a rendered subgroup boundary re-pins instead of
   * reordering: the row is already order-adjacent to the target group, so
   * the engine's stable pin regrouping alone lands it at the near edge —
   * last of the group above on ArrowUp, first of the group below on
   * ArrowDown — and an order write would be a no-op on top.
   */
  const moveByKeyboard = (columnId: string, delta: 1 | -1) => {
    const index = flatRows.findIndex((row) => row.id === columnId);
    if (index === -1) return;
    const neighbor = flatRows[index + delta];
    if (neighbor === undefined) return;
    const neighborGroup = renderedGroups[neighbor.groupIndex];
    if (neighborGroup === undefined) return;
    const live = grid.getState().columnLayout;
    const moved = live.find((entry) => entry.id === columnId);
    if (moved === undefined) return;
    if ((moved.pinned ?? null) !== neighborGroup.pinned) {
      grid.setColumnPinned(columnId, neighborGroup.pinned);
    } else {
      const remaining = live
        .map((entry) => entry.id)
        .filter((id) => id !== columnId);
      const at = remaining.indexOf(neighbor.id);
      if (at === -1) return;
      remaining.splice(delta === -1 ? at : at + 1, 0, columnId);
      grid.setColumnOrder(remaining);
    }
    // The move can carry the row into another subgroup fragment, remounting
    // its grip — focus is handed back through the per-id map after commit,
    // the kebab's exact pattern.
    pendingGripFocusRef.current = columnId;
  };

  const reset = () => {
    const initial = initialLayoutRef.current;
    if (initial === null) return;
    const current = grid.getState().columnLayout;
    const initialById = new Map(initial.map((entry) => [entry.id, entry]));
    const currentIds = new Set(current.map((entry) => entry.id));
    // Pin state first — safe before visibility since unpinning a hidden
    // column no longer reveals it — then visibility, then the full-roster
    // order LAST, so the engine normalizes the initial order request against
    // the already-restored pin groups and reproduces the initial layout
    // exactly. Only ids present in both rosters are replayed: a column the
    // props added or removed since mount has no initial state to restore.
    const initialAuto = initialAutoWidthRef.current;
    for (const entry of current) {
      const initialEntry = initialById.get(entry.id);
      if (initialEntry === undefined) continue;
      if ((entry.pinned ?? null) !== (initialEntry.pinned ?? null)) {
        grid.setColumnPinned(entry.id, initialEntry.pinned ?? null);
      }
      if ((entry.hidden === true) !== (initialEntry.hidden === true)) {
        grid.setColumnVisible(entry.id, initialEntry.hidden !== true);
      }
      // The auto-width half of the baseline (spec B4): a reset that restores
      // order/pin/visibility but leaves auto-mode drift is a half-reset. The
      // write is unconditional over the replayed ids — the store no-ops when
      // membership already matches — because unlike pin/visibility the
      // CURRENT membership is not readable from the layout entry here.
      if (initialAuto !== null) {
        grid.setColumnAutoWidth(entry.id, initialAuto.has(entry.id));
      }
    }
    // `setColumnOrder` demands EVERY current layout id. Ids the capture never
    // saw (a group column derived since mount) are spliced back at their
    // current positions; the engine's pin regrouping places them correctly.
    const order = initial
      .filter((entry) => currentIds.has(entry.id))
      .map((entry) => entry.id);
    current.forEach((entry, index) => {
      if (!initialById.has(entry.id)) {
        order.splice(Math.min(index, order.length), 0, entry.id);
      }
    });
    grid.setColumnOrder(order);
  };

  return (
    <>
      <input
        aria-label={messages.toolPanelSearchColumnsLabel()}
        data-pretable-tool-search=""
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          // Searching the open menu's row out of the list unmounts its kebab;
          // the menu closes WITH its state, here at the source, so clearing
          // the search later cannot remount a zombie menu at a stale rect
          // (whose mount effect would steal focus). Handler, not effect: the
          // lint rule that polices setState-in-effect does not apply to the
          // event that caused the condition.
          if (openColumnId !== null) {
            const needleNext = value.trim().toLowerCase();
            const stillListed =
              needleNext === "" ||
              labelForColumn(openColumnId).toLowerCase().includes(needleNext);
            if (!stillListed) closeMenuState();
          }
        }}
        placeholder={messages.toolPanelSearchColumnsPlaceholder()}
        type="text"
        value={query}
      />
      {renderedGroups.map((group, groupIndex) => {
        const start = flatRows.findIndex(
          (row) => row.groupIndex === groupIndex,
        );
        // Where the drop line sits inside THIS group's fragment, as a local
        // index (`rows.length` = after the last row). A boundary slot exists
        // twice — end of one group, start of the next — and `groupIndex` is
        // what routes the line to the side whose pin the drop would adopt.
        const indicatorAt =
          drag !== null && drag.target.groupIndex === groupIndex
            ? drag.target.beforeRow - start
            : null;
        return (
          // Keyed by the PIN, not by the heading: the heading is an
          // overridable message now, and two groups sharing one word would be
          // two React children sharing a key.
          <Fragment key={group.pinned ?? "unpinned"}>
            <div data-pretable-tool-group-label="">
              {messages.toolPanelColumnGroupLabel({ pinned: group.pinned })}
            </div>
            {group.rows.map(({ entry, label }, localIndex) => {
              const visible = entry.hidden !== true;
              return (
                <Fragment key={entry.id}>
                  {indicatorAt === localIndex ? (
                    <div data-pretable-tool-drop-indicator="" />
                  ) : null}
                  <div
                    data-pretable-column-id={entry.id}
                    data-pretable-tool-column-row=""
                    ref={(node) => {
                      if (node) rowNodesRef.current.set(entry.id, node);
                      else rowNodesRef.current.delete(entry.id);
                    }}
                    {...(visible
                      ? {}
                      : { "data-pretable-column-hidden": "true" })}
                    {...(drag?.columnId === entry.id
                      ? { "data-pretable-tool-row-dragging": "" }
                      : {})}
                  >
                    {/* The drag handle AND the keyboard-reorder control. A
                      focusable span with role=button rather than a <button>:
                      grid.css styles `[data-pretable-tool-row-grip]` as a bare
                      inline-flex glyph (and hangs the coarse-pointer ::after
                      off it), and a native button would drag UA chrome into
                      that selector. The chord is the group-chip strip's,
                      turned vertical: Shift+ArrowUp / Shift+ArrowDown moves
                      the row, and crossing a subgroup boundary re-pins it —
                      the a11y-mandated equivalent of the pointer drag. */}
                    <span
                      aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown"
                      aria-label={messages.toolPanelReorderColumnLabel({
                        label,
                      })}
                      data-pretable-tool-row-grip=""
                      ref={(node) => {
                        if (node) gripNodesRef.current.set(entry.id, node);
                        else gripNodesRef.current.delete(entry.id);
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (!event.shiftKey) return;
                        if (
                          event.key !== "ArrowUp" &&
                          event.key !== "ArrowDown"
                        ) {
                          return;
                        }
                        event.preventDefault();
                        moveByKeyboard(
                          entry.id,
                          event.key === "ArrowDown" ? 1 : -1,
                        );
                      }}
                      // The shared machine's handlers: no stopPropagation on
                      // pointerdown (an open pin menu's outside-press close
                      // must fire — in contrast to the kebab one control
                      // over), capture at pointerdown, commit on release
                      // only, Escape-cancel; the hook carries the rationale.
                      {...gripHandlers(entry.id)}
                    >
                      <GripIcon />
                    </span>
                    {/* The row-select checkbox's exact recipe — a button with
                      role=checkbox and a CheckIcon glyph when checked — so
                      the shared grid.css checkbox rules style both from one
                      place. */}
                    <button
                      aria-checked={visible}
                      aria-label={messages.toolPanelShowColumnLabel({ label })}
                      data-pretable-tool-column-toggle=""
                      onClick={() => grid.setColumnVisible(entry.id, !visible)}
                      role="checkbox"
                      type="button"
                    >
                      {visible ? <CheckIcon /> : null}
                    </button>
                    <span data-pretable-tool-column-label="">{label}</span>
                    <button
                      aria-expanded={openColumnId === entry.id}
                      aria-haspopup="menu"
                      aria-label={messages.toolPanelColumnMenuLabel({ label })}
                      data-pretable-tool-row-menu-button=""
                      ref={(node) => {
                        if (node) kebabNodesRef.current.set(entry.id, node);
                        else kebabNodesRef.current.delete(entry.id);
                      }}
                      // Load-bearing, exactly as on the header MenuButton: React
                      // delegates at the root container, so stopping here keeps
                      // the pointerdown off `document` — where the open menu
                      // listens for outside-clicks. Without it, pointerdown
                      // would close the menu and the following click reopen it,
                      // so the kebab could never dismiss its own menu.
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        toggleMenu("menu", entry.id, e.currentTarget);
                      }}
                      type="button"
                    >
                      <OverflowIcon />
                    </button>
                  </div>
                </Fragment>
              );
            })}
            {indicatorAt === group.rows.length ? (
              <div data-pretable-tool-drop-indicator="" />
            ) : null}
          </Fragment>
        );
      })}
      {matched.length === 0 ? (
        <div data-pretable-tool-empty="">
          {messages.toolPanelNoColumnsMatchMessage()}
        </div>
      ) : null}
      {(() => {
        if (menu === null) return null;
        // `matched`, not `entries`: the lookup mirrors what is RENDERED, which
        // is the roster filter AND the search filter. The search-out case is
        // already cleared at its source (the input's onChange), so this guard
        // is the roster arm — the column left the layout while its menu was
        // up, and there is nothing to pin. The hook's anchor tracking closes
        // the state itself on the next scroll or resize.
        const open = matched.find(({ entry }) => entry.id === menu.columnId);
        if (open === undefined) return null;
        return (
          <ColumnPinMenu
            columnId={open.entry.id}
            label={open.label}
            pinned={open.entry.pinned ?? null}
            messages={messages}
            style={popoverStyle(menu.rect)}
            onClose={closeMenu}
            onSelect={(pinned) => {
              grid.setColumnPinned(open.entry.id, pinned);
              closeMenuState();
              // Deferred: the pin just moved the row across subgroup
              // fragments, so the kebab remounts and can only be focused
              // after the commit, through the per-id node map.
              pendingKebabFocusRef.current = open.entry.id;
            }}
          />
        );
      })()}
      <button data-pretable-tool-reset="" onClick={reset} type="button">
        {messages.toolPanelResetColumnsLabel()}
      </button>
    </>
  );
}

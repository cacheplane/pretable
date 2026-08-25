import type { CSSProperties, RefObject } from "react";
import {
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
import { OverlayPortal } from "../overlay/OverlayPortal";
import { popoverStyle } from "../overlay/popover-position";

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
}

const PIN_GROUPS = [
  { pinned: "left", label: "Pinned left" },
  { pinned: undefined, label: "Columns" },
  { pinned: "right", label: "Pinned right" },
] as const;

const PIN_MENU_ITEMS = [
  { pinned: "left", label: "Pin left", action: "pin-left" },
  { pinned: "right", label: "Pin right", action: "pin-right" },
  { pinned: null, label: "Unpin", action: "unpin" },
] as const;

/**
 * The kebab's popover: three pin placements, the row's current one disabled.
 *
 * Portaled for the same reason every popover here is — the grid viewport's
 * `contain: content` makes it the containing block for `position: fixed`
 * descendants AND clips them, so an inline menu would be trapped inside the
 * pane's scroll box. It reuses the header ColumnMenu's attribute contract
 * (`data-pretable-popover` + `data-pretable-column-menu` on the container,
 * `data-pretable-menu-item` on items) so grid.css styles it with zero new
 * rules.
 *
 * Focus return is the CALLER's job, via `onClose`/`onSelect`: a pin change
 * moves the row across subgroup fragments, remounting the kebab, so only the
 * section (with its per-id node map) can find the button again.
 */
function ColumnPinMenu({
  columnId,
  label,
  pinned,
  style,
  onSelect,
  onClose,
}: {
  columnId: string;
  label: string;
  pinned: "left" | "right" | null;
  style?: CSSProperties;
  onSelect: (pinned: "left" | "right" | null) => void;
  /** `restoreFocus` false only for outside clicks, which chose a new target. */
  onClose: (restoreFocus: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  const enabledItems = () =>
    Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-pretable-menu-item]:not(:disabled)",
      ) ?? [],
    );

  // A menu opened from a button owns the focus while it is up. The first
  // ENABLED item: the current pin state is disabled and may well be first.
  useEffect(() => {
    enabledItems()[0]?.focus();
  }, []);

  // Outside-click → close. No focus return: the click is already moving focus
  // somewhere the user chose, and yanking it back would fight that.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        onClose(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <OverlayPortal>
      <div
        ref={rootRef}
        role="menu"
        aria-label={`${label} column menu`}
        data-pretable-column-menu=""
        data-pretable-column-id={columnId}
        data-pretable-popover=""
        style={style}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Esc") {
            // `preventDefault`, NOT `stopPropagation`: the pane's own Escape
            // handler (which yanks focus to the rail tab) skips events that
            // are defaultPrevented — that check is the designed interlock,
            // and the portal still bubbles through the React tree to it.
            event.preventDefault();
            onClose(true);
            return;
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const items = enabledItems();
          if (items.length === 0) return;
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const delta = event.key === "ArrowDown" ? 1 : -1;
          items[(index + delta + items.length) % items.length]?.focus();
        }}
      >
        {PIN_MENU_ITEMS.map((item) => (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            data-pretable-menu-item=""
            data-pretable-menu-action={item.action}
            disabled={pinned === item.pinned}
            onClick={() => onSelect(item.pinned)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </OverlayPortal>
  );
}

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

  // The open pin menu, with its anchor rect captured at open time. Local for
  // the same reason as the query: a closed pane has no menu to keep.
  const [menu, setMenu] = useState<{
    readonly columnId: string;
    readonly rect: DOMRect;
  } | null>(null);
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
      setMenu(null);
      if (restoreFocus && openColumnId !== null) {
        // Synchronous, not via the pending-focus effect: closing does not
        // remount the kebab, and an Escape's focus return must land before
        // any later handler in the same dispatch can observe it.
        kebabNodesRef.current.get(openColumnId)?.focus();
      }
    },
    [openColumnId],
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
    for (const entry of current) {
      const initialEntry = initialById.get(entry.id);
      if (initialEntry === undefined) continue;
      if ((entry.pinned ?? null) !== (initialEntry.pinned ?? null)) {
        grid.setColumnPinned(entry.id, initialEntry.pinned ?? null);
      }
      if ((entry.hidden === true) !== (initialEntry.hidden === true)) {
        grid.setColumnVisible(entry.id, initialEntry.hidden !== true);
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
        aria-label="Search columns"
        data-pretable-tool-search=""
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search"
        type="text"
        value={query}
      />
      {PIN_GROUPS.map((group) => {
        const rows = matched.filter(
          ({ entry }) => (entry.pinned ?? undefined) === group.pinned,
        );
        if (rows.length === 0) return null;
        return (
          <Fragment key={group.label}>
            <div data-pretable-tool-group-label="">{group.label}</div>
            {rows.map(({ entry, label }) => {
              const visible = entry.hidden !== true;
              return (
                <div
                  data-pretable-column-id={entry.id}
                  data-pretable-tool-column-row=""
                  key={entry.id}
                  {...(visible
                    ? {}
                    : { "data-pretable-column-hidden": "true" })}
                >
                  {/* Inert until Task 9 wires the drag; rendered now so the
                      row anatomy (and the coarse-pointer hit target the CSS
                      already reserves) is complete. */}
                  <span data-pretable-tool-row-grip="">
                    <GripIcon />
                  </span>
                  {/* The row-select checkbox's exact recipe — a button with
                      role=checkbox and a CheckIcon glyph when checked — so
                      the shared grid.css checkbox rules style both from one
                      place. */}
                  <button
                    aria-checked={visible}
                    aria-label={`Show ${label}`}
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
                    aria-label={`${label} column menu`}
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
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenu((open) =>
                        open?.columnId === entry.id
                          ? null
                          : { columnId: entry.id, rect },
                      );
                    }}
                    type="button"
                  >
                    <OverflowIcon />
                  </button>
                </div>
              );
            })}
          </Fragment>
        );
      })}
      {matched.length === 0 ? (
        // Hardcoded English like the section's other strings — the whole
        // section is a known messages-system gap, tracked elsewhere.
        <div data-pretable-tool-empty="">No columns match</div>
      ) : null}
      {(() => {
        if (menu === null) return null;
        const open = entries.find(({ entry }) => entry.id === menu.columnId);
        // The column left the roster while its menu was up: nothing to pin.
        if (open === undefined) return null;
        return (
          <ColumnPinMenu
            columnId={open.entry.id}
            label={open.label}
            pinned={open.entry.pinned ?? null}
            style={popoverStyle(menu.rect)}
            onClose={closeMenu}
            onSelect={(pinned) => {
              grid.setColumnPinned(open.entry.id, pinned);
              setMenu(null);
              // Deferred: the pin just moved the row across subgroup
              // fragments, so the kebab remounts and can only be focused
              // after the commit, through the per-id node map.
              pendingKebabFocusRef.current = open.entry.id;
            }}
          />
        );
      })()}
      <button data-pretable-tool-reset="" onClick={reset} type="button">
        Reset columns
      </button>
    </>
  );
}

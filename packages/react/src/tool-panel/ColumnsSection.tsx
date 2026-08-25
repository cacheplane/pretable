import type { RefObject } from "react";
import { Fragment, useCallback, useState, useSyncExternalStore } from "react";

import { GROUP_COLUMN_ID } from "@pretable/core";

import { ROW_SELECT_COLUMN_ID } from "../constants";
import { CheckIcon, GripIcon, OverflowIcon } from "../icons";

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
                  {/* Inert until Task 8 wires the menu; aria-expanded stays
                      absent until there is a popup to expand. */}
                  <button
                    aria-label={`${label} column menu`}
                    data-pretable-tool-row-menu-button=""
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
      <button data-pretable-tool-reset="" onClick={reset} type="button">
        Reset columns
      </button>
    </>
  );
}

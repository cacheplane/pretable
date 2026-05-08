import { createGridCore } from "@pretable-internal/grid-core";

import type { PretableGrid } from "./pretable-grid";
import type { PretableGridOptions, PretableRow } from "./types";

/**
 * Create a pretable grid instance. Returns a {@link PretableGrid} handle
 * that exposes every action and observation pretable supports.
 *
 * @example
 * ```ts
 * const grid = createGrid({
 *   columns: [{ id: "name" }, { id: "age" }],
 *   rows: [{ id: "1", name: "Ada", age: 36 }],
 * });
 * grid.setSort("age", "desc");
 * const snapshot = grid.getSnapshot();
 * ```
 *
 * @public
 */
export function createGrid<TRow extends PretableRow = PretableRow>(
  options: PretableGridOptions<TRow>,
): PretableGrid<TRow> {
  const engine = createGridCore(options);

  return {
    kind: "pretable-grid",
    get options() {
      return engine.options;
    },
    subscribe: engine.subscribe,
    getSnapshot: engine.getSnapshot,
    setSort: engine.setSort,
    setFilter: engine.setFilter,
    clearFilters: engine.clearFilters,
    replaceFilters: engine.replaceFilters,
    setSelection: engine.setSelection,
    selectAll: engine.selectAll,
    clearSelection: engine.clearSelection,
    addRange: engine.addRange,
    extendRangeFromAnchor: engine.extendRangeFromAnchor,
    toggleRowSelection: engine.toggleRowSelection,
    setSelectAllVisible: engine.setSelectAllVisible,
    setFocus: engine.setFocus,
    moveFocus: engine.moveFocus,
    setViewport: engine.setViewport,
    autosizeColumns: engine.autosizeColumns,
    setColumnWidth: engine.setColumnWidth,
    moveColumn: engine.moveColumn,
    setColumnPinned: engine.setColumnPinned,
    autosizeColumn: engine.autosizeColumn,
    resetColumnLayout: engine.resetColumnLayout,
    mergeColumnsFromProps: engine.mergeColumnsFromProps,
    applyTransaction: engine.applyTransaction,
  };
}

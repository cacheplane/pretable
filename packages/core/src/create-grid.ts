import { createGridCore } from "@pretable-internal/grid-core";

import type { PretableGrid, PretableGridOptions } from "./types";

export function createGrid<TRow extends Record<string, unknown>>(
  options: PretableGridOptions<TRow>,
): PretableGrid<TRow> {
  const gridCore = createGridCore(options);

  return {
    kind: "pretable-grid",
    get options() {
      return gridCore.options;
    },
    subscribe: gridCore.subscribe,
    getSnapshot: gridCore.getSnapshot,
    setSort: gridCore.setSort,
    setFilter: gridCore.setFilter,
    clearFilters: gridCore.clearFilters,
    replaceFilters: gridCore.replaceFilters,
    setSelection: gridCore.setSelection,
    selectAll: gridCore.selectAll,
    clearSelection: gridCore.clearSelection,
    addRange: gridCore.addRange,
    extendRangeFromAnchor: gridCore.extendRangeFromAnchor,
    toggleRowSelection: gridCore.toggleRowSelection,
    setSelectAllVisible: gridCore.setSelectAllVisible,
    setFocus: gridCore.setFocus,
    moveFocus: gridCore.moveFocus,
    setViewport: gridCore.setViewport,
    autosizeColumns: gridCore.autosizeColumns,
    applyTransaction: gridCore.applyTransaction,
  };
}

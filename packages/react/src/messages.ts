/**
 * The English every user-facing string falls back to.
 *
 * Its own module, not a `const` beside {@link PretableSurfaceMessages}: the
 * surface file exports a component, and a second value export there trips
 * react-refresh's only-export-components rule — which is a real constraint,
 * not a lint quibble, since these defaults are imported by tests and by no
 * component.
 *
 * The interface stays where it is (it is public API, declared next to the
 * props that carry it); this is the ONE place a default lives. The tool
 * panel's sections take their strings as a resolved `messages` prop precisely
 * to keep that true — see `tool-panel/messages.ts`.
 *
 * Deliberately absent from `public_api.ts`: overriding is done through the
 * `messages` prop, and exporting the defaults would freeze this English as
 * API.
 *
 * The import is type-only and therefore erased — `pretable-surface` imports
 * this module at runtime, and a value import back would be a cycle.
 */
import type { PretableSurfaceMessages } from "./pretable-surface";

export const defaultMessages: Required<PretableSurfaceMessages> = {
  selectAllLabel: ({ scope }) =>
    scope === "loaded" ? "Select all loaded rows" : "Select all rows",
  selectAllAnnouncement: ({
    rowCount,
    columnCount,
    isAll,
    scope,
    loadedCount,
  }) =>
    isAll
      ? scope === "loaded"
        ? `${rowCount} of ${loadedCount} loaded rows selected`
        : "All rows selected"
      : `${rowCount} rows × ${columnCount} columns selected`,
  copyAnnouncement: ({ rowCount, columnCount, scope }) =>
    scope === "loaded"
      ? `${rowCount} loaded rows × ${columnCount} columns copied`
      : `${rowCount} rows × ${columnCount} columns copied`,
  copyFailedAnnouncement: () => "Copy failed",
  exportAnnouncement: ({ rowCount, columnCount, scope, complete }) => {
    const base =
      scope === "loaded"
        ? `${rowCount} loaded rows × ${columnCount} columns exported`
        : `${rowCount} rows × ${columnCount} columns exported`;
    // Said out loud, not left to the filename. The `-PARTIAL` marker travels
    // with the file on disk; it is not announced anywhere a screen-reader user
    // hears it, and this live region is the only place they learn the download
    // they just triggered is short.
    return complete ? base : `${base}, partial file`;
  },
  exportFailedAnnouncement: () => "Export failed",
  pasteAnnouncement: ({ cellCount, rejectedCount, clipped }) => {
    const base =
      cellCount === 0
        ? `No cells pasted, ${rejectedCount} rejected`
        : `${cellCount} cell${cellCount === 1 ? "" : "s"} pasted` +
          (rejectedCount > 0 ? `, ${rejectedCount} rejected` : "");
    return clipped.rows > 0 || clipped.columns > 0
      ? `${base}, clipped to fit`
      : base;
  },
  pasteFailedAnnouncement: () => "Paste failed",
  groupChildCountLabel: ({ childCount, scope }) =>
    scope === "loaded" ? `(${childCount} loaded)` : `(${childCount})`,
  emptyStateMessage: () => "No results",
  loadingStateMessage: () => "Loading…",
  dataErrorAnnouncement: ({ message }) =>
    message ? `Could not load results. ${message}` : "Could not load results",
  toolPanelLabel: () => "Tool panel",
  toolPanelColumnsLabel: () => "Columns",
  toolPanelFiltersLabel: () => "Filters",
  toolPanelColumnGroupLabel: ({ pinned }) =>
    pinned === "left"
      ? "Pinned left"
      : pinned === "right"
        ? "Pinned right"
        : "Columns",
  toolPanelSearchColumnsLabel: () => "Search columns",
  toolPanelSearchColumnsPlaceholder: () => "Search",
  toolPanelNoColumnsMatchMessage: () => "No columns match",
  toolPanelResetColumnsLabel: () => "Reset columns",
  toolPanelReorderColumnLabel: ({ label }) => `Reorder ${label}`,
  toolPanelShowColumnLabel: ({ label }) => `Show ${label}`,
  toolPanelColumnMenuLabel: ({ label }) => `${label} column menu`,
  toolPanelPinLabel: ({ pinned }) =>
    pinned === "left" ? "Pin left" : pinned === "right" ? "Pin right" : "Unpin",
  toolPanelAddFilterLabel: () => "+ filter",
  toolPanelAddGroupLabel: () => "+ group",
  toolPanelNoFiltersMessage: () =>
    "No filters. Every row in the grid is showing.",
  toolPanelFilterDepthRefusal: ({ maxDepth }) =>
    `The filter tree cannot nest deeper than ${maxDepth} levels.`,
  toolPanelNoFilterColumnsRefusal: () => "There are no columns to filter on.",
  toolPanelFilterColumnLabel: ({ hidden, groupedAway, groupedMarker }) =>
    hidden
      ? "Filter column, hidden"
      : groupedAway
        ? `Filter column, ${groupedMarker}`
        : "Filter column",
  toolPanelColumnGroupedMarker: () => "grouped",
  toolPanelFilterOperatorLabel: () => "Filter operator",
  toolPanelFilterValueLabel: () => "Filter value",
  toolPanelFilterMinimumLabel: () => "Filter minimum",
  toolPanelFilterMaximumLabel: () => "Filter maximum",
  toolPanelFilterValuesLabel: () => "Filter values",
  toolPanelNoFilterValuesMessage: () => "No values to choose from",
  toolPanelRemoveFilterLabel: ({ label }) => `Remove filter on ${label}`,
  toolPanelFilterWhereLabel: () => "Where",
  toolPanelFilterJoinLabel: ({ op }) => op,
  // The visible word first, then what a press does: `and` is the only text on
  // the control, so it IS the visible label and a name without it fails SC
  // 2.5.3 — see `JoinControl`'s TSDoc, which argues the whole sentence.
  toolPanelFilterJoinActionLabel: ({ opLabel, nextLabel }) =>
    `${opLabel}, join all conditions in this list with ${nextLabel}`,
  toolPanelGroupingLabel: () => "Grouping",
  toolPanelResizeLabel: () => "Resize tool panel",
  toolPanelGroupByLabel: () => "Group by",
  toolPanelAddRowGroupLabel: () => "Add group",
  toolPanelRemoveGroupLabel: ({ label }) => `Remove grouping by ${label}`,
  // NOT the columns key's `Reorder ${label}`: the two grips coexist in one
  // panel, and identical accessible names would leave a screen-reader user
  // unable to tell reordering a column from reordering a grouping level.
  toolPanelReorderGroupLabel: ({ label }) => `Reorder grouping by ${label}`,
  toolPanelNoGroupsMessage: () => "No groups. Rows are ungrouped.",
  toolPanelExpandAllLabel: () => "Expand all",
  toolPanelCollapseAllLabel: () => "Collapse all",
  toolPanelHideGroupedColumnsLabel: () => "Hide grouped columns",
  toolPanelAggregatesLabel: () => "Aggregates",
  toolPanelAggregateColumnLabel: ({ label }) => `${label} aggregate`,
  toolPanelAggregateDefaultOption: ({ label }) => `Default (${label})`,
  toolPanelAggregateNoneOption: () => "None",
  toolPanelAggregateSumLabel: () => "Sum",
  toolPanelAggregateAvgLabel: () => "Average",
  toolPanelAggregateMinLabel: () => "Min",
  toolPanelAggregateMaxLabel: () => "Max",
  toolPanelAggregateCountLabel: () => "Count",
  toolPanelAggregateCustomLabel: () => "Custom",
};

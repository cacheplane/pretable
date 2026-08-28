/**
 * Internal barrel for the grouping section. Nothing here is public API — the
 * surface constructs the section's descriptor, and consumers address the
 * section by id through `PretableToolPanelConfig`.
 *
 * `aggregate-options` is deliberately absent, like `filter-paths` in the
 * filters barrel: it is the section's own vocabulary, directly unit-tested at
 * its module path, and the aggregates block imports it directly when it
 * lands. The section's remaining components join here when they land.
 */
export {
  GroupingSection,
  type GroupingSectionColumn,
  type GroupingSectionGrid,
  type GroupingSectionProps,
  type GroupingSectionRowModel,
} from "./GroupingSection";

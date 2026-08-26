/**
 * Internal barrel for the filter builder. Nothing here is public API — the
 * surface constructs the section's descriptor, and consumers address the
 * section by id through `PretableToolPanelConfig`.
 *
 * `filter-paths` is deliberately absent: it is the section's own arithmetic,
 * directly unit-tested at its module path, and nothing outside this directory
 * has any business addressing a node by position.
 */
export {
  FiltersSection,
  type FiltersSectionGrid,
  type FiltersSectionProps,
} from "./FiltersSection";
export {
  FilterRow,
  type FilterRowColumn,
  type FilterRowLeaf,
  type FilterRowProps,
} from "./FilterRow";
export { JoinControl } from "./JoinControl";

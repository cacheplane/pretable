/**
 * Internal barrel for the grouping section. Nothing here is public API — the
 * surface constructs the section's descriptor, and consumers address the
 * section by id through `PretableToolPanelConfig`.
 *
 * `aggregate-options` is deliberately absent, like `filter-paths` in the
 * filters barrel: it is the section's own vocabulary, directly unit-tested at
 * its module path, and `GroupingSection` (a later task) imports it directly.
 * The section's components join here when they land.
 */
export {};

/**
 * Internal barrel for the grouping section. Nothing here is public API — the
 * surface constructs the section's descriptor, and consumers address the
 * section by id through `PretableToolPanelConfig`.
 *
 * `GroupingSection` joins in a later task; for now the barrel carries the
 * aggregate picker's closed vocabulary.
 */
export {
  builtinAggregatesForType,
  effectiveAggregate,
  type AggregateChoice,
  type BuiltinAggregate,
} from "./aggregate-options";

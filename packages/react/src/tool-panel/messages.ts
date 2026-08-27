/**
 * What each piece of the tool panel reads out of the surface's messages layer.
 *
 * Every user-facing string in this directory comes from
 * {@link PretableSurfaceMessages} — declared there, defaulted there
 * (`defaultMessages`), resolved there (`effectiveMessages`) and handed down as
 * a prop. Nothing here defaults a string of its own, for `ToolPanelProps`'
 * stated reason: a localizer must be able to override the panel's English in
 * exactly one place, and a component-local fallback is a second place that
 * an override silently fails to reach.
 *
 * The types are `Pick`s rather than one panel-wide bag so each component
 * declares the keys it actually reads. A caller may always pass something
 * wider — the surface passes its whole `effectiveMessages` — because a
 * structural supertype is assignable to the narrower shape.
 *
 * `Required<...>` because these are the RESOLVED messages: the surface has
 * already filled every default, so no call site inside the panel has to
 * consider a missing one.
 *
 * The import is type-only and therefore erased: the surface imports this
 * directory at runtime, and a value import back would be a cycle.
 */
import type { PretableSurfaceMessages } from "../pretable-surface";

type Resolved<K extends keyof PretableSurfaceMessages> = Required<
  Pick<PretableSurfaceMessages, K>
>;

/** The pin menu names its three placements and itself. */
export type ColumnPinMenuMessages = Resolved<
  "toolPanelColumnMenuLabel" | "toolPanelPinLabel"
>;

/** The columns section — the pin menu's keys included, since it renders one. */
export type ToolPanelColumnsMessages = ColumnPinMenuMessages &
  Resolved<
    | "toolPanelColumnGroupLabel"
    | "toolPanelSearchColumnsLabel"
    | "toolPanelSearchColumnsPlaceholder"
    | "toolPanelNoColumnsMatchMessage"
    | "toolPanelResetColumnsLabel"
    | "toolPanelReorderColumnLabel"
    | "toolPanelShowColumnLabel"
  >;

/** The connective between two rows of a sibling run. */
export type JoinControlMessages = Resolved<
  | "toolPanelFilterWhereLabel"
  | "toolPanelFilterJoinLabel"
  | "toolPanelFilterJoinActionLabel"
>;

/** One leaf row: its pickers, its operand fields and its remove button. */
export type FilterRowMessages = Resolved<
  | "toolPanelFilterColumnLabel"
  | "toolPanelColumnGroupedMarker"
  | "toolPanelFilterOperatorLabel"
  | "toolPanelFilterValueLabel"
  | "toolPanelFilterMinimumLabel"
  | "toolPanelFilterMaximumLabel"
  | "toolPanelFilterValuesLabel"
  | "toolPanelNoFilterValuesMessage"
  | "toolPanelRemoveFilterLabel"
>;

/** The filters section, which renders both of the above. */
export type ToolPanelFiltersMessages = FilterRowMessages &
  JoinControlMessages &
  Resolved<
    | "toolPanelAddFilterLabel"
    | "toolPanelAddGroupLabel"
    | "toolPanelNoFiltersMessage"
    | "toolPanelFilterDepthRefusal"
    | "toolPanelNoFilterColumnsRefusal"
  >;

/**
 * The grouping section — every key its four blocks read. The rail tab's
 * `toolPanelGroupingLabel` is deliberately absent: the SURFACE renders the
 * tab (it constructs the descriptor), so that key stays surface-side, as the
 * other two sections' tab labels do.
 */
export type GroupingSectionMessages = Resolved<
  | "toolPanelGroupByLabel"
  | "toolPanelAddRowGroupLabel"
  | "toolPanelRemoveGroupLabel"
  | "toolPanelReorderGroupLabel"
  | "toolPanelNoGroupsMessage"
  | "toolPanelExpandAllLabel"
  | "toolPanelCollapseAllLabel"
  | "toolPanelHideGroupedColumnsLabel"
  | "toolPanelAggregatesLabel"
  | "toolPanelAggregateColumnLabel"
  | "toolPanelAggregateDefaultOption"
  | "toolPanelAggregateNoneOption"
  | "toolPanelAggregateSumLabel"
  | "toolPanelAggregateAvgLabel"
  | "toolPanelAggregateMinLabel"
  | "toolPanelAggregateMaxLabel"
  | "toolPanelAggregateCountLabel"
  | "toolPanelAggregateCustomLabel"
>;

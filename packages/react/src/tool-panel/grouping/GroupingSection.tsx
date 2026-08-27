import type { ColumnType } from "@pretable/core";

import type { GroupingSectionMessages } from "../messages";

/**
 * The slice of the react grid handle the grouping section drives. Structural,
 * exactly as `ColumnsSectionGrid` is: the surface hands in its own
 * `indexedGrid` (stable for the model's lifetime), and this type documents
 * that the section reads LIVE engine state — `hideGroupedColumns` and
 * `columnAggregates` — through it rather than closing over a snapshot, the
 * SP1 stale-closure trap.
 *
 * `setColumnAggregate` takes `unknown` here as it does on the full handle,
 * but the section only ever passes the closed vocabulary from
 * `aggregate-options.ts` — that restriction is the pane's validation (spec
 * decision 3), since an invalid aggregate destroys the mounted grid.
 */
export interface GroupingSectionGrid {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => {
    readonly hideGroupedColumns?: boolean;
    readonly columnAggregates: Readonly<Record<string, unknown>>;
  };
  readonly setHideGroupedColumns: (value: boolean) => void;
  readonly setColumnAggregate: (columnId: string, aggregate: unknown) => void;
}

/**
 * The slice of the row-model handle the section drives: `rowGroups` read live
 * from the query (the section subscribes itself, as `FiltersSection` does to
 * `query.filters`), and the two expansion writes. Return types erased to
 * `void`-shaped `unknown`: the section never reads a mutation result.
 */
export interface GroupingSectionRowModel {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getState: () => {
    readonly snapshot: {
      readonly query: {
        readonly rowGroups?: readonly { readonly columnId: string }[];
      };
    };
  };
  readonly expandAll: () => unknown;
  readonly collapseAll: () => unknown;
}

/**
 * One schema data column as the section sees it — props-derived, baked into
 * the descriptor by the surface's `groupingSectionColumns` memo. The derived
 * group column can never appear here (the memo starts from the authoritative
 * column DEFINITIONS), which is what keeps the synthetic column out of the
 * aggregates list by construction.
 */
export interface GroupingSectionColumn {
  readonly id: string;
  readonly label: string;
  readonly type?: ColumnType;
  /** The prop-declared `aggregate`, for the picker's `Default (…)` face. */
  readonly declaredAggregate?: unknown;
}

export interface GroupingSectionProps {
  readonly grid: GroupingSectionGrid;
  readonly rowModel: GroupingSectionRowModel;
  /**
   * The surface's one grouping write — the same stable function the strip and
   * the header menu call, so the pane never grows a second write path.
   */
  readonly applyRowGroups: (next: readonly string[]) => void;
  /** Label projection for schema columns — the surface's `labelForColumn`. */
  readonly labelForColumn: (columnId: string) => string;
  readonly columns: readonly GroupingSectionColumn[];
  /**
   * Rows mode only (spec decision 6): `false` in explicit-model mode, where
   * an aggregate write lands in engine state and changes nothing a group row
   * shows — the block is then absent, never visible-but-inert.
   */
  readonly aggregatesEnabled: boolean;
  /** Resolved surface messages — this section defaults no string itself. */
  readonly messages: GroupingSectionMessages;
}

/**
 * The tool panel's grouping section: group-by list, expansion buttons,
 * hide-grouped switch, aggregates block — in that order (spec decision 1).
 *
 * SHELL ONLY for now: the container and the four block placeholders. The
 * blocks land in the follow-on tasks, each filling one placeholder; every
 * prop is already the real value so those tasks only add markup and
 * subscriptions, never surface wiring.
 */
// The props are accepted (and wired with real values by the surface) but not
// yet read — an empty destructure, so no unused binding while the interface
// stands as the contract the block tasks fill in against.
export function GroupingSection({}: GroupingSectionProps) {
  return (
    <div data-pretable-tool-grouping="">
      {/* Group-by list: rows + Add group menu. */}
      <div />
      {/* Expansion: Expand all / Collapse all. */}
      <div />
      {/* Hide-grouped-columns switch. */}
      <div />
      {/* Aggregates: one picker per column, rows mode only. */}
      <div />
    </div>
  );
}

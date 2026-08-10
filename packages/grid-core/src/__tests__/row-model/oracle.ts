import type {
  PretableExpansionDefault,
  PretableGroupId,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import {
  deriveVisibleRows,
  type DeriveVisibleRowsInput,
} from "../../derived-rows";
import type { PretableRow } from "../../types";

export interface LegacyOracleExpansion {
  readonly default: PretableExpansionDefault;
  /** Explicit sparse decisions retained even while a group is absent. */
  readonly overrides?: ReadonlyMap<string, boolean>;
}

export type LegacyOracleRow<TRow extends PretableRow> =
  | {
      readonly kind: "data";
      readonly ref: PretableVisibleRowRef<string> & { readonly kind: "data" };
      readonly row: TRow;
      readonly sourceIndex: number;
      readonly depth: number;
    }
  | {
      readonly kind: "group";
      readonly ref: PretableVisibleRowRef<string> & { readonly kind: "group" };
      readonly depth: number;
      readonly columnId: string;
      readonly value: unknown;
      readonly childCount: number;
      readonly aggregates: Readonly<Record<string, unknown>>;
      readonly expanded: boolean;
    };

export type LegacyOracleInput<TRow extends PretableRow> = Omit<
  DeriveVisibleRowsInput<TRow>,
  "groupExpansionOverrides" | "groupsDefaultExpanded"
> & {
  readonly expansion?: LegacyOracleExpansion;
};

/**
 * Test-only compatibility oracle for the legacy full derivation pipeline.
 *
 * Its return shape deliberately uses discriminated row references so a data ID
 * may equal serialized group text without becoming ambiguous. Keep this wrapper
 * independent of the incremental implementation: later randomized tests use it
 * as the source of truth after every operation.
 */
export function runLegacyOracle<TRow extends PretableRow>(
  input: LegacyOracleInput<TRow>,
): readonly LegacyOracleRow<TRow>[] {
  const expansion = input.expansion ?? {
    default: { kind: "expanded" as const },
  };
  const fullyExpanded = deriveVisibleRows({
    ...input,
    groupExpansionOverrides: new Set<string>(),
    groupsDefaultExpanded: true,
  });
  const collapsed = new Set(
    fullyExpanded.flatMap((entry) =>
      entry.kind === "group" && !isExpanded(entry.id, entry.depth, expansion)
        ? [entry.id]
        : [],
    ),
  );
  const rows =
    collapsed.size === 0
      ? fullyExpanded
      : deriveVisibleRows({
          ...input,
          groupExpansionOverrides: collapsed,
          groupsDefaultExpanded: true,
        });

  return rows.map((entry): LegacyOracleRow<TRow> => {
    if (entry.kind === "data") {
      return {
        kind: "data",
        ref: { kind: "data", rowId: entry.id },
        row: entry.row,
        sourceIndex: entry.sourceIndex,
        depth: entry.depth,
      };
    }

    const groupId = entry.id as PretableGroupId;
    return {
      kind: "group",
      ref: { kind: "group", groupId },
      depth: entry.depth,
      columnId: entry.columnId,
      value: entry.value,
      childCount: entry.childCount,
      aggregates: entry.aggregates,
      expanded: isExpanded(entry.id, entry.depth, expansion),
    };
  });
}

function isExpanded(
  groupId: string,
  depth: number,
  expansion: LegacyOracleExpansion,
): boolean {
  const override = expansion.overrides?.get(groupId);
  if (override !== undefined) return override;
  if (expansion.default.kind === "expanded") return true;
  if (expansion.default.kind === "collapsed") return false;
  return depth <= expansion.default.depth;
}

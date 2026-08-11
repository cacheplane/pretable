import { createGridUiCore } from "@pretable-internal/grid-core";
import type {
  CreateGridUiCoreOptions,
  PretableGridUiCore,
} from "@pretable-internal/grid-core";
import type { PretableRowId } from "@pretable-internal/row-model";

/**
 * Create a framework-independent UI-state grid over an explicit indexed row
 * model. Data, queries, grouping, aggregation, and expansion remain owned by
 * `rowModel`; this handle owns only focus, selection, editing, viewport, and
 * visual column layout.
 *
 * @public
 */
export function createGrid<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  options: CreateGridUiCoreOptions<TRow, TRowId, TColumns>,
): PretableGridUiCore<TRow, TRowId, TColumns> {
  return createGridUiCore(options);
}

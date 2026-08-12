import {
  createColumnHelper as createInternalColumnHelper,
  type PretableColumnHelper,
} from "@pretable-internal/row-model";

/**
 * Creates a typed column-definition helper for an ordinary row object.
 *
 * @public
 */
export function createColumnHelper<
  TRow extends object,
>(): PretableColumnHelper<TRow> {
  return createInternalColumnHelper<TRow>();
}

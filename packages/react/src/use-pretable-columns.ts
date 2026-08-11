import { type DependencyList, useMemo } from "react";

/**
 * Memoizes a typed column tuple while preserving literal column IDs and
 * accessor value types.
 *
 * @public
 */
export function usePretableColumns<const TColumns>(
  factory: () => TColumns,
  deps: DependencyList,
): TColumns {
  // The caller deliberately supplies the dependency list, mirroring useMemo.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  return useMemo(factory, deps);
}

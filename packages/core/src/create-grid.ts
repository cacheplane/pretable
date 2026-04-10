import type { PretableGrid, PretableGridOptions } from "./types";

export function createGrid<TRow extends Record<string, unknown>>(
  options: PretableGridOptions<TRow>,
): PretableGrid<TRow> {
  return {
    kind: "pretable-grid",
    options,
  };
}

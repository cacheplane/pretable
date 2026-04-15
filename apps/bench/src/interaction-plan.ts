import type { ScenarioDataset, ScenarioRow } from "@pretable-internal/scenario-data";

import type { BenchQueryState } from "./bench-types";

export interface BenchInteractionPlan {
  focusedRowId: string | null;
  filters: Record<string, string>;
  mode: Exclude<BenchQueryState["scriptName"], "initial" | "scroll">;
  probeColumnId: string;
  resultRowCount: number;
  rows: readonly ScenarioRow[];
  selectedRowId: string | null;
  sort:
    | {
        columnId: string;
        direction: "asc" | "desc";
      }
    | null;
}

const SORT_COLUMN_ID = "col_3";
const METADATA_FILTER = {
  columnId: "col_6",
  value: "running",
} as const;
const TEXT_FILTER = {
  columnId: "col_0",
  value: "Bonjour",
} as const;

export function createBenchInteractionPlan(
  dataset: ScenarioDataset,
  scriptName: BenchQueryState["scriptName"],
): BenchInteractionPlan | null {
  if (scriptName === "sort") {
    const rows = sortRows(dataset.rows, SORT_COLUMN_ID, "desc");
    const probeRow = rows[Math.floor(rows.length / 3)] ?? rows[0];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

    return {
      focusedRowId: probeRowId,
      filters: {},
      mode: "sort",
      probeColumnId: SORT_COLUMN_ID,
      resultRowCount: rows.length,
      rows,
      selectedRowId: probeRowId,
      sort: {
        columnId: SORT_COLUMN_ID,
        direction: "desc",
      },
    };
  }

  if (scriptName === "filter-metadata") {
    const rows = filterRows(dataset.rows, METADATA_FILTER.columnId, METADATA_FILTER.value);
    const probeRow = rows[Math.floor(rows.length / 2)] ?? rows[0];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

    return {
      focusedRowId: probeRowId,
      filters: {
        [METADATA_FILTER.columnId]: METADATA_FILTER.value,
      },
      mode: "filter-metadata",
      probeColumnId: METADATA_FILTER.columnId,
      resultRowCount: rows.length,
      rows,
      selectedRowId: probeRowId,
      sort: null,
    };
  }

  if (scriptName === "filter-text") {
    const rows = filterRows(dataset.rows, TEXT_FILTER.columnId, TEXT_FILTER.value);
    const probeRow = rows[Math.floor(rows.length / 2)] ?? rows[0];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

    return {
      focusedRowId: probeRowId,
      filters: {
        [TEXT_FILTER.columnId]: TEXT_FILTER.value,
      },
      mode: "filter-text",
      probeColumnId: TEXT_FILTER.columnId,
      resultRowCount: rows.length,
      rows,
      selectedRowId: probeRowId,
      sort: null,
    };
  }

  return null;
}

function filterRows(
  rows: readonly ScenarioRow[],
  columnId: string,
  needle: string,
): readonly ScenarioRow[] {
  const normalizedNeedle = needle.trim().toLowerCase();

  return rows.filter((row) =>
    String(row[columnId] ?? "").toLowerCase().includes(normalizedNeedle),
  );
}

function sortRows(
  rows: readonly ScenarioRow[],
  columnId: string,
  direction: "asc" | "desc",
): readonly ScenarioRow[] {
  const sorted = [...rows].sort((left, right) => {
    const leftValue = Number(left[columnId] ?? 0);
    const rightValue = Number(right[columnId] ?? 0);

    return leftValue - rightValue;
  });

  return direction === "desc" ? sorted.reverse() : sorted;
}

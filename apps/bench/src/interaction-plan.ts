import type { ColumnFilter, PretableSortEntry } from "@pretable/react";
import type {
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

import type { BenchQueryState } from "./bench-types";

export interface BenchInteractionPlan {
  focusedRowId: string | null;
  filters: Record<string, ColumnFilter>;
  mode: Exclude<BenchQueryState["scriptName"], "initial" | "scroll">;
  probeColumnId: string;
  resultRowCount: number;
  rows: readonly ScenarioRow[];
  selectedRowId: string | null;
  /** Ordered multi-sort entry list; `[]` = unsorted. */
  sort: PretableSortEntry[];
  /** Grouping levels, outermost first; `[]` = ungrouped. */
  rowGroups: string[];
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

/**
 * Grouping level for the `group` / `group-expand` / `group-updates` scripts.
 *
 * `packages/scenario-data` emits an owner value at every `columnIndex % 4 === 1`
 * and a status value at every `% 4 === 2`, from a pool of exactly four each:
 * `owners[(seed + rowIndex + columnIndex) % 4]`. Cardinality is therefore 4 for
 * ANY row count above 3 — every bench scale qualifies — so the group count
 * stays pinned while rows scale, and the measurement isolates per-row cost
 * from per-group cost.
 *
 * `col_5` is an owner column in all three scenarios these scripts run on:
 * `5 % 4 === 1`, and 5 is past the wrapped prefix in each (S2/S7 wrap 3
 * columns, S5 wraps 1), so it holds a real four-value key rather than wrapped
 * multilingual prose. It is also deliberately NOT `col_6` — that is already
 * the `filter-metadata` probe, and reusing it would entangle two scripts.
 */
const GROUP_COLUMN_ID = "col_5";

/**
 * Same configuration as the engine's sibling ordering (see `collator` in
 * `packages/grid-core/src/row-utils.ts`), so the plan can predict which group
 * `flatten` will emit first without reaching into the engine.
 */
const groupKeyCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

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
      rowGroups: [],
      selectedRowId: probeRowId,
      sort: [
        {
          columnId: SORT_COLUMN_ID,
          direction: "desc",
        },
      ],
    };
  }

  if (scriptName === "filter-metadata") {
    const rows = filterRows(
      dataset.rows,
      METADATA_FILTER.columnId,
      METADATA_FILTER.value,
    );
    const probeRow = rows[Math.floor(rows.length / 2)] ?? rows[0];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

    return {
      focusedRowId: probeRowId,
      filters: {
        [METADATA_FILTER.columnId]: {
          operator: "contains",
          value: METADATA_FILTER.value,
        },
      },
      mode: "filter-metadata",
      probeColumnId: METADATA_FILTER.columnId,
      resultRowCount: rows.length,
      rows,
      rowGroups: [],
      selectedRowId: probeRowId,
      sort: [],
    };
  }

  if (scriptName === "filter-text") {
    const rows = filterRows(
      dataset.rows,
      TEXT_FILTER.columnId,
      TEXT_FILTER.value,
    );
    const probeRow = rows[Math.floor(rows.length / 2)] ?? rows[0];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

    return {
      focusedRowId: probeRowId,
      filters: {
        [TEXT_FILTER.columnId]: {
          operator: "contains",
          value: TEXT_FILTER.value,
        },
      },
      mode: "filter-text",
      probeColumnId: TEXT_FILTER.columnId,
      resultRowCount: rows.length,
      rows,
      rowGroups: [],
      selectedRowId: probeRowId,
      sort: [],
    };
  }

  if (scriptName === "group") {
    // Every data row stays visible (groups default to expanded), so the
    // probe row can be any row — and `selected_row_preserved` then answers a
    // real question: does applying a grouping keep the user's selection?
    const rows = dataset.rows;
    const probeRow = rows[Math.floor(rows.length / 3)] ?? rows[0];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

    return {
      focusedRowId: probeRowId,
      filters: {},
      mode: "group",
      probeColumnId: GROUP_COLUMN_ID,
      // The engine's row model interleaves one group row per distinct key
      // with the data rows, and `rowModelRowCount` counts both.
      resultRowCount: rows.length + countGroupKeys(rows, GROUP_COLUMN_ID),
      rows,
      rowGroups: [GROUP_COLUMN_ID],
      selectedRowId: probeRowId,
      sort: [],
    };
  }

  if (scriptName === "group-expand") {
    // The grouping itself is applied BEFORE the measurement window (see
    // bench-app.tsx), so this plan describes the pre-window state. The window
    // contains exactly one `grid.setGroupExpanded` — the same call the twisty
    // click makes — which collapses the FIRST group in sibling order.
    //
    // The probe row is therefore taken from the LAST group, so it survives the
    // collapse: `reconcileFocusAfterVisibleModelChange({ preferAncestor })`
    // would otherwise move focus to the ancestor group row and the
    // preservation metrics would report a collapse artifact rather than a
    // regression.
    const rows = dataset.rows;
    const keys = sortedGroupKeys(rows, GROUP_COLUMN_ID);
    const collapsedKey = keys[0] ?? null;
    const survivingKey = keys[keys.length - 1] ?? null;
    const probeRow =
      survivingKey === null
        ? rows[0]
        : (rows.find(
            (row) => String(row[GROUP_COLUMN_ID] ?? "") === survivingKey,
          ) ?? rows[0]);
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;
    const collapsedRowCount =
      collapsedKey === null
        ? 0
        : rows.filter(
            (row) => String(row[GROUP_COLUMN_ID] ?? "") === collapsedKey,
          ).length;

    return {
      focusedRowId: probeRowId,
      filters: {},
      mode: "group-expand",
      probeColumnId: GROUP_COLUMN_ID,
      // Post-collapse: every group row survives, the collapsed group's data
      // rows do not.
      resultRowCount:
        rows.length - collapsedRowCount + countGroupKeys(rows, GROUP_COLUMN_ID),
      rows,
      rowGroups: [GROUP_COLUMN_ID],
      selectedRowId: probeRowId,
      sort: [],
    };
  }

  if (scriptName === "group-updates") {
    // Streaming script: no selection or focus probe, so the measured window
    // holds nothing but the update stream (`updates` runs with no controlled
    // state at all, and this keeps the two comparable).
    const rows = dataset.rows;

    return {
      focusedRowId: null,
      filters: {},
      mode: "group-updates",
      probeColumnId: GROUP_COLUMN_ID,
      resultRowCount: rows.length + countGroupKeys(rows, GROUP_COLUMN_ID),
      rows,
      rowGroups: [GROUP_COLUMN_ID],
      selectedRowId: null,
      sort: [],
    };
  }

  return null;
}

/** Distinct values of `columnId`, ordered the way `flatten` emits siblings. */
export function sortedGroupKeys(
  rows: readonly ScenarioRow[],
  columnId: string,
): string[] {
  const keys = new Set<string>();

  for (const row of rows) {
    keys.add(String(row[columnId] ?? ""));
  }

  return [...keys].sort((left, right) => groupKeyCollator.compare(left, right));
}

function countGroupKeys(rows: readonly ScenarioRow[], columnId: string) {
  return sortedGroupKeys(rows, columnId).length;
}

function filterRows(
  rows: readonly ScenarioRow[],
  columnId: string,
  needle: string,
): readonly ScenarioRow[] {
  const normalizedNeedle = needle.trim().toLowerCase();

  return rows.filter((row) =>
    String(row[columnId] ?? "")
      .toLowerCase()
      .includes(normalizedNeedle),
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

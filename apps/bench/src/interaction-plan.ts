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
 * filter-as-you-type sequence for the `filter-keystrokes` script: the prefixes
 * of the existing text-filter needle, applied as successive `contains` commits.
 * Reuses TEXT_FILTER's column and needle so the final keystroke's result set is
 * byte-identical to the single-commit `filter-text` script's — the two read
 * side by side, cold commit vs cold commit.
 */
export interface BenchFilterKeystrokeStep {
  /** The filter value this keystroke commits (a prefix of the full needle). */
  readonly value: string;
  readonly plan: BenchInteractionPlan;
}

export function createBenchFilterKeystrokePlans(
  dataset: Pick<ScenarioDataset, "rows">,
): BenchFilterKeystrokeStep[] | null {
  const { columnId, value: needle } = TEXT_FILTER;
  const prefixes = Array.from({ length: needle.length }, (_, index) =>
    needle.slice(0, index + 1),
  );

  // The settle machinery latches on a signature whose first component is the
  // result row count (visible rows can be identical across a narrowing), so a
  // step that does not move the count would starve the latch: keep only steps
  // that strictly reduce the count, starting from the unfiltered total.
  const kept: { value: string; rows: readonly ScenarioRow[] }[] = [];
  let previousCount = dataset.rows.length;
  for (const prefix of prefixes) {
    const rows = filterRows(dataset.rows, columnId, prefix);
    if (rows.length > previousCount) {
      // Monotone narrowing is structural (contains "Bo" ⊆ contains "B"); a
      // violation means filterRows and this builder disagree — a plan bug.
      throw new Error(
        `filter-keystrokes: prefix "${prefix}" widened the row set (${rows.length} > ${previousCount})`,
      );
    }
    if (rows.length === previousCount) {
      continue;
    }
    kept.push({ value: prefix, rows });
    previousCount = rows.length;
  }

  // The full needle must always be the last committed value — it is what makes
  // the final state comparable to `filter-text`. Equal count under monotone
  // narrowing means an identical row set, so swapping the last kept prefix for
  // the full needle preserves the strict decrease.
  const fullNeedle = prefixes.at(-1)!;
  if (kept.length > 0 && kept.at(-1)!.value !== fullNeedle) {
    const finalRows = filterRows(dataset.rows, columnId, fullNeedle);
    if (finalRows.length === kept.at(-1)!.rows.length) {
      kept[kept.length - 1] = { value: fullNeedle, rows: finalRows };
    } else {
      kept.push({ value: fullNeedle, rows: finalRows });
    }
  }

  if (kept.length < 2) {
    // One commit is the single-commit script; a sequence needs a warm tail.
    return null;
  }

  const finalRows = kept.at(-1)!.rows;
  const probeRow = finalRows[Math.floor(finalRows.length / 2)] ?? finalRows[0];
  const probeRowId = probeRow ? String(probeRow.id ?? "") : null;

  return kept.map(({ value, rows }) => ({
    value,
    plan: {
      focusedRowId: probeRowId,
      filters: { [columnId]: { operator: "contains", value } },
      mode: "filter-keystrokes",
      probeColumnId: columnId,
      resultRowCount: rows.length,
      rows,
      rowGroups: [],
      selectedRowId: probeRowId,
      sort: [],
    },
  }));
}

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
    // The probe row is therefore taken from the SECOND group. It has to be
    // outside the collapsed one, or `reconcileFocusAfterVisibleModelChange({
    // preferAncestor })` walks focus up to the ancestor group row and the
    // preservation metrics report a collapse artifact rather than a
    // regression. Second rather than last because controlled focus scrolls
    // itself into view: a probe in the LAST group parks the viewport at the
    // end of the content, where collapsing 25% of the rows clamps scrollTop
    // and leaves two rendered rows to settle — a measurement of scroll
    // clamping, not of the toggle.
    const rows = dataset.rows;
    const keys = sortedGroupKeys(rows, GROUP_COLUMN_ID);
    const collapsedKey = keys[0] ?? null;
    const survivingKey = keys[1] ?? keys[0] ?? null;
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

  if (
    scriptName === "group-updates" ||
    scriptName === "group-updates-stable-keys"
  ) {
    // Streaming scripts: no selection or focus probe, so the measured window
    // holds nothing but the update stream (`updates` runs with no controlled
    // state at all, and this keeps the three comparable).
    //
    // The two variants describe the SAME pre-window state and differ only in
    // which columns the patch generator may write — see
    // `benchUpdatesExcludedColumnIds` below.
    const rows = dataset.rows;

    return {
      focusedRowId: null,
      filters: {},
      mode: scriptName,
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

/**
 * Columns the streaming patch generator must NOT write, per script.
 *
 * `updates` and `group-updates` return `[]` — their generator is byte-identical
 * and picks uniformly from every column, which is what makes them comparable.
 * Because `group-updates` groups on `col_5`, that uniform pick lands on the
 * grouping level about 1 patch in 30 on S5, minting new group keys: the group
 * count observed in the 2026-08-10 baseline went 4 → ~100 over a 3 s run. The
 * measurement therefore conflates two different things — grouping under
 * streaming, and grouping-KEY CHURN under streaming.
 *
 * `group-updates-stable-keys` excludes the grouping level and nothing else, so
 * rows update but never re-path between groups. That is the realistic case (a
 * price ticks; its sector does not) and the one the streaming-hero decision
 * actually needs.
 *
 * Known and deliberate asymmetry: removing one of S5's 30 columns from the pool
 * lifts every surviving column's share from 1/30 to 1/29, including the single
 * wrapped column (3.33% → 3.45% of patches). That is a ~0.1 percentage-point
 * shift in wrapped-cell hit rate and cannot account for effects of the size
 * being measured here. Restricting the pool further — say, to one fixed column
 * — would be a much larger departure from `updates`.
 */
export function benchUpdatesExcludedColumnIds(
  scriptName: BenchQueryState["scriptName"],
): readonly string[] {
  return scriptName === "group-updates-stable-keys" ? [GROUP_COLUMN_ID] : [];
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

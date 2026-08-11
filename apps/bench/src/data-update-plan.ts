import type {
  ScenarioColumn,
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

/** The Inspector's request window and resident cap (design §11). Mirrored here so the
 *  client bench measures the exact shapes the remote consumer produces. Exported so the
 *  caller's `unsupported` reason names the same numbers the gate below applies. */
export const BENCH_WINDOW_ROWS = 200;
export const BENCH_RESIDENT_CAP_ROWS = 1_000;

export interface BenchDataUpdatePlan {
  mode: "replace" | "append";
  /** Resident before the measured update. */
  initialRows: readonly ScenarioRow[];
  /** Handed to the surface when the trigger fires. */
  nextRows: readonly ScenarioRow[];
  focusedRowId: string | null;
  selectedRowId: string | null;
  resultRowCount: number;
  /** The column the measurement watches for the first repainted frame: a same-ids
   *  replacement moves no row id and no row top, so cell text is the only visible
   *  evidence the new payload landed. See `selectProbeColumn` for why it is not
   *  `columns[0]`. */
  probeColumnId: string;
}

/** `reason` is non-null exactly when `plan` is null, so the caller reports why the
 *  scenario cannot express this script instead of restating one guess. */
export type BenchDataUpdatePlanResult =
  | { plan: BenchDataUpdatePlan; reason?: undefined }
  | { plan: null; reason: string };

/**
 * `replace` = one window of the SAME ids with new payloads — the poll-refresh path.
 * `append`  = 800 resident rows extended to the 1 000-row cap — the load-more path.
 *
 * Both shapes come off the SAME dataset slice, which is why the size gate below
 * demands enough rows for the larger of the two even when building the smaller: a
 * replace measured on a dataset that could not also host an append would not be
 * comparable with the append it is budgeted against.
 */
export function createBenchDataUpdatePlan(
  dataset: ScenarioDataset,
  mode: "replace" | "append",
): BenchDataUpdatePlanResult {
  const requiredRows = BENCH_RESIDENT_CAP_ROWS + BENCH_WINDOW_ROWS;

  if (dataset.rows.length < requiredRows) {
    // Too small to express either shape honestly. The caller reports `unsupported`
    // rather than measuring a different thing under the same name.
    return {
      plan: null,
      reason: `holds ${dataset.rows.length} rows, fewer than the ${requiredRows} the ${BENCH_WINDOW_ROWS}-row window and its ${BENCH_RESIDENT_CAP_ROWS}-row resident cap need`,
    };
  }

  const probeColumn = selectProbeColumn(dataset);

  if (!probeColumn) {
    return {
      plan: null,
      reason: `exposes no string-valued column for the update probe to watch (${dataset.columns.length} columns)`,
    };
  }

  const probeColumnId = probeColumn.id;
  const mutableColumnIds = dataset.columns.map((column) => column.id);

  if (mode === "replace") {
    const initialRows = dataset.rows.slice(0, BENCH_WINDOW_ROWS);
    // Same ids, changed payloads. Identity is what lets the engine preserve selection,
    // focus and measured heights across the replacement — the property the budget's
    // "no grid reconstruction" clause is really about.
    const nextRows = initialRows.map((row) =>
      createRefreshedRow(row, mutableColumnIds),
    );
    // Mid-window, so the replacement lands on rows that are on screen: every row the
    // viewport holds is one this update rewrites.
    const probeRowId = readRowId(
      initialRows[Math.floor(initialRows.length / 3)],
    );

    return {
      plan: {
        mode,
        initialRows,
        nextRows,
        focusedRowId: probeRowId,
        selectedRowId: probeRowId,
        resultRowCount: nextRows.length,
        probeColumnId,
      },
    };
  }

  // 200 onto 800, not onto 1 800: §11's own resident cap is 1 000 rows, so this is
  // the largest append the cap permits.
  const initialRows = dataset.rows.slice(
    0,
    BENCH_RESIDENT_CAP_ROWS - BENCH_WINDOW_ROWS,
  );
  const nextRows = dataset.rows.slice(0, BENCH_RESIDENT_CAP_ROWS);
  // The LAST resident row, not a mid-set one. Controlled focus scrolls the probe into
  // view, and the tail is the only viewport position where the appended page renders —
  // a load-more the user is looking at. Probing mid-set parks the viewport 500+ rows
  // above the seam, where blank-gap frames, anchor shift and row-height error are all
  // computed over rows the append never touched and are zero by construction.
  const probeRowId = readRowId(initialRows[initialRows.length - 1]);

  return {
    plan: {
      mode,
      initialRows,
      nextRows,
      focusedRowId: probeRowId,
      selectedRowId: probeRowId,
      resultRowCount: nextRows.length,
      probeColumnId,
    },
  };
}

/**
 * The column whose rendered text the change detector watches.
 *
 * Not `columns[0]`: column 0 is pinned wherever a scenario sets `pinned_left > 0` and
 * wrapped wherever it sets `wrapped_columns > 0`. A wrapped cell re-measures its row
 * height after the new text paints, so the detector would be racing the wrap
 * re-measure instead of reading the payload swap; a pinned cell lives in a separate
 * track from the scrollable rows the sampler walks. A fixed-width, unpinned string
 * column changes exactly once, on the frame the new payload paints.
 */
function selectProbeColumn(dataset: ScenarioDataset): ScenarioColumn | null {
  const sampleRow = dataset.rows[0];
  const holdsString = (column: ScenarioColumn) =>
    typeof sampleRow?.[column.id] === "string";

  return (
    dataset.columns.find(
      (column) =>
        !column.wrap && column.pinned === undefined && holdsString(column),
    ) ??
    dataset.columns.find(holdsString) ??
    null
  );
}

/**
 * A poll-refresh returns a fresh payload for every column, not one changed cell, so
 * the measured replace rewrites them all — anything less would time the engine
 * diffing 1 changed value out of N and call it a window refresh.
 *
 * Type-preserving because `ScenarioRow` values are `string | number` and the surface
 * formats the two differently: coercing a numeric column to a string would measure a
 * type change rather than a value change. `id` is absent from `columns` and therefore
 * never rewritten — same-id identity is the property under test.
 */
function createRefreshedRow(
  row: ScenarioRow,
  columnIds: readonly string[],
): ScenarioRow {
  const next: ScenarioRow = { ...row };

  for (const columnId of columnIds) {
    const value = row[columnId];
    next[columnId] =
      typeof value === "number" ? value + 1 : `${String(value ?? "")}·`;
  }

  return next;
}

function readRowId(row: ScenarioRow | undefined) {
  return row ? String(row.id ?? "") : null;
}

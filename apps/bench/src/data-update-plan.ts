import type {
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

/** The Inspector's request window and resident cap (design §11). Mirrored here so the
 *  client bench measures the exact shapes the remote consumer produces. */
const WINDOW_ROWS = 200;
const RESIDENT_CAP_ROWS = 1_000;

export interface BenchDataUpdatePlan {
  mode: "replace" | "append";
  /** Resident before the measured update. */
  initialRows: readonly ScenarioRow[];
  /** Handed to the surface when the trigger fires. */
  nextRows: readonly ScenarioRow[];
  focusedRowId: string | null;
  selectedRowId: string | null;
  resultRowCount: number;
  /** The column `replace` rewrites. Also the column the measurement watches for the
   *  first repainted frame: a same-ids replacement moves no row id and no row top, so
   *  cell text is the only visible evidence the new payload landed. */
  probeColumnId: string;
}

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
): BenchDataUpdatePlan | null {
  const probeColumnId = dataset.columns[0]?.id;
  if (probeColumnId === undefined) {
    return null;
  }
  if (dataset.rows.length < RESIDENT_CAP_ROWS + WINDOW_ROWS) {
    // Too small to express either shape honestly. The caller reports `unsupported`
    // rather than measuring a different thing under the same name.
    return null;
  }

  if (mode === "replace") {
    const initialRows = dataset.rows.slice(0, WINDOW_ROWS);
    // Same ids, changed payloads. Identity is what lets the engine preserve selection,
    // focus and measured heights across the replacement — the property the budget's
    // "no grid reconstruction" clause is really about.
    const nextRows = initialRows.map((row) => ({
      ...row,
      [probeColumnId]: `${String(row[probeColumnId] ?? "")}·`,
    }));
    const probeRow = initialRows[Math.floor(initialRows.length / 3)];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;
    return {
      mode,
      initialRows,
      nextRows,
      focusedRowId: probeRowId,
      selectedRowId: probeRowId,
      resultRowCount: nextRows.length,
      probeColumnId,
    };
  }

  // 200 onto 800, not onto 1 800: §11's own resident cap is 1 000 rows, so this is
  // the largest append the cap permits.
  const initialRows = dataset.rows.slice(0, RESIDENT_CAP_ROWS - WINDOW_ROWS);
  const nextRows = dataset.rows.slice(0, RESIDENT_CAP_ROWS);
  const probeRow = initialRows[Math.floor(initialRows.length / 3)];
  const probeRowId = probeRow ? String(probeRow.id ?? "") : null;
  return {
    mode,
    initialRows,
    nextRows,
    focusedRowId: probeRowId,
    selectedRowId: probeRowId,
    resultRowCount: nextRows.length,
    probeColumnId,
  };
}

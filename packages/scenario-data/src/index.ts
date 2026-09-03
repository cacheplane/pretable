export type ScenarioId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
export type ScenarioScale =
  "smoke" | "dev" | "hypothesis" | "target" | "local-max";
export type {
  InspectionColumn,
  InspectionDataset,
  InspectionDatasetScale,
  InspectionFilterableColumnId,
  InspectionRow,
  InspectionSeverity,
} from "./inspection-profile";
export {
  createInspectionDataset,
  getInspectionFilterValue,
  inspectionColumns,
  inspectionDatasetScaleOptions,
  inspectionFilterableColumnIds,
} from "./inspection-profile";

import { buildPmsRows, pmsColumns, pmsRoles } from "./pms-profile";
export { derivePmsRow, PMS_SECTORS, PMS_STRATEGIES } from "./pms-profile";

export type RowHeightMode = "fixed" | "variable" | "mixed";

export interface ScenarioUpdateStream {
  mode: "batched";
  batch_every_ms: number;
  visible_update_rate_per_sec: number;
  offscreen_update_rate_per_sec: number;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  rows: number;
  cols: number;
  row_height_mode: RowHeightMode;
  wrapped_columns: number;
  pinned_left: number;
  purpose: string;
  corpus?: "multilingual";
  autosize_all_columns?: boolean;
  rich_cells_percent?: number;
  update_stream: "none" | ScenarioUpdateStream;
}

export interface ScenarioColumn {
  id: string;
  header: string;
  wrap: boolean;
  widthPx?: number;
  pinned?: "left";
  /**
   * Value type. Absent means "legacy typing": the bench types the
   * `roles.sortColumnId` column as number and everything else as text, which
   * is exactly what it did before this field existed.
   */
  type?: "text" | "number";
}

export type ScenarioRow = Record<string, string | number>;

export interface ScenarioPatchStreamUniformCell {
  /**
   * One patch moves one cell; row and column are drawn uniformly. The
   * pre-ripple generator, byte for byte.
   */
  readonly mode: "uniform-cell";
}

export interface ScenarioPatchStreamRipple {
  readonly mode: "ripple";
  /** The column each patch moves. */
  readonly tickColumnId: string;
  /** Columns recomputed from the moved tick in the same patch. */
  readonly derivedColumnIds: readonly string[];
  /**
   * Recompute `derivedColumnIds` from a row whose tick column has already
   * been updated. Returns only the derived cells.
   */
  readonly derive: (row: ScenarioRow) => Readonly<Record<string, number>>;
}

/**
 * How the bench's deterministic update plan shapes each patch — unrelated to
 * `ScenarioUpdateStream`, which is the scenario's update cadence.
 */
export type ScenarioPatchStream =
  ScenarioPatchStreamUniformCell | ScenarioPatchStreamRipple;

/**
 * Which columns the bench scripts act on. Read by apps/bench instead of the
 * `col_N` literals it used to carry — see the 2026-08-30 PMS profile spec.
 */
export interface ScenarioRoles {
  /** Numeric column the `sort` script orders by. */
  readonly sortColumnId: string;
  readonly textFilter: { readonly columnId: string; readonly value: string };
  readonly metadataFilter: {
    readonly columnId: string;
    readonly value: string;
  };
  /**
   * Grouping levels, outermost first, for `group`, `group-expand`,
   * `group-updates` and `group-updates-stable-keys`.
   */
  readonly groupColumnIds: readonly string[];
  /**
   * Grouping for `updates-grouped` and the row-model diagnostics controller.
   * Kept separate from `groupColumnIds` because the bench has always grouped
   * those two families on DIFFERENT columns (col_5 vs col_1), and reproducing
   * that is what keeps S5's baselines still.
   */
  readonly streamingGrouping: {
    readonly groupColumnIds: readonly string[];
    readonly aggregateColumnId: string;
  };
  readonly stream: ScenarioPatchStream;
}

/**
 * The bench's pre-roles column picks, verbatim. Every S1–S7 dataset uses it.
 *
 * The picks are constrained, not arbitrary. The synthetic generator emits an
 * owner value at every `columnIndex % 4 === 1` and a status value at every
 * `% 4 === 2`, each from a pool of exactly four
 * (`owners[(seed + rowIndex + columnIndex) % 4]`), so those columns have
 * cardinality 4 at ANY row count above 3 — the group count stays pinned while
 * rows scale, which is what lets the grouping scripts isolate per-row cost
 * from per-group cost.
 *
 * - `groupColumnIds: ["col_5"]` — an owner column (`5 % 4 === 1`) in all three
 *   scenarios the grouping scripts run on, and past the wrapped prefix in each
 *   (S2/S7 wrap 3 columns, S5 wraps 1), so it holds a real four-value key
 *   rather than wrapped multilingual prose. Deliberately NOT `col_6`: that is
 *   the `filter-metadata` probe, and reusing it would entangle two scripts.
 * - `streamingGrouping.groupColumnIds: ["col_1"]` — the other owner column, kept
 *   distinct from `col_5` because the streaming family has always grouped there.
 * - `sortColumnId: "col_3"` — numeric-valued and unwrapped in every scenario.
 * - `metadataFilter: col_6 / "running"` — a status column (`6 % 4 === 2`), so
 *   the needle hits a bounded value pool.
 * - `textFilter: col_0 / "Bonjour"` — column 0 is wrapped multilingual prose in
 *   every scenario, which is the point: the text filter measures wrapped cells.
 */
export const legacyScenarioRoles: ScenarioRoles = Object.freeze({
  sortColumnId: "col_3",
  textFilter: Object.freeze({ columnId: "col_0", value: "Bonjour" }),
  metadataFilter: Object.freeze({ columnId: "col_6", value: "running" }),
  groupColumnIds: Object.freeze(["col_5"]),
  streamingGrouping: Object.freeze({
    groupColumnIds: Object.freeze(["col_1"]),
    aggregateColumnId: "col_3",
  }),
  stream: Object.freeze({ mode: "uniform-cell" as const }),
});

export interface ScenarioDataset {
  scenario: ScenarioDefinition;
  scale: ScenarioScale;
  columns: readonly ScenarioColumn[];
  rows: readonly ScenarioRow[];
  rowCount: number;
  seed: number;
  roles: ScenarioRoles;
}

const scenarioScaleRowCounts: Record<
  ScenarioId,
  Record<ScenarioScale, number>
> = {
  S1: {
    smoke: 250,
    dev: 2_000,
    hypothesis: 10_000,
    target: 100_000,
    "local-max": 100_000,
  },
  S2: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 50_000,
    "local-max": 50_000,
  },
  S3: {
    smoke: 120,
    dev: 500,
    hypothesis: 2_500,
    target: 10_000,
    "local-max": 10_000,
  },
  S4: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 25_000,
    "local-max": 25_000,
  },
  S5: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 20_000,
    "local-max": 100_000,
  },
  S6: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 10_000,
    "local-max": 10_000,
  },
  S7: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 50_000,
    "local-max": 50_000,
  },
  S8: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 20_000,
    "local-max": 100_000,
  },
};

const scenarioDefinitions = [
  {
    id: "S1",
    name: "fixed-dense-text",
    rows: 100_000,
    cols: 50,
    row_height_mode: "fixed",
    wrapped_columns: 0,
    pinned_left: 0,
    update_stream: "none",
    purpose: "Simple baseline before variable height enters.",
  },
  {
    id: "S2",
    name: "wrap-auto-height",
    rows: 50_000,
    cols: 40,
    row_height_mode: "variable",
    wrapped_columns: 3,
    pinned_left: 1,
    corpus: "multilingual",
    update_stream: "none",
    purpose: "Primary wedge benchmark.",
  },
  {
    id: "S3",
    name: "many-columns",
    rows: 10_000,
    cols: 500,
    row_height_mode: "fixed",
    wrapped_columns: 0,
    pinned_left: 2,
    update_stream: "none",
    purpose: "Column virtualization and pinned-zone overhead.",
  },
  {
    id: "S4",
    name: "offscreen-autosize",
    rows: 25_000,
    cols: 200,
    row_height_mode: "mixed",
    wrapped_columns: 2,
    pinned_left: 1,
    autosize_all_columns: true,
    update_stream: "none",
    purpose: "Directly test unseen-column sizing.",
  },
  {
    id: "S5",
    name: "streaming-updates",
    rows: 20_000,
    cols: 30,
    row_height_mode: "fixed",
    wrapped_columns: 1,
    pinned_left: 1,
    purpose: "Scheduler discipline and cache invalidation.",
    update_stream: {
      mode: "batched",
      batch_every_ms: 50,
      visible_update_rate_per_sec: 200,
      offscreen_update_rate_per_sec: 800,
    },
  },
  {
    id: "S6",
    name: "light-rich-cells",
    rows: 10_000,
    cols: 25,
    row_height_mode: "fixed",
    wrapped_columns: 0,
    pinned_left: 1,
    rich_cells_percent: 10,
    update_stream: "none",
    purpose: "Check whether richer content breaks the design too early.",
  },
  {
    id: "S7",
    name: "pinned-inspection",
    rows: 50_000,
    cols: 40,
    row_height_mode: "variable",
    wrapped_columns: 3,
    pinned_left: 3,
    corpus: "multilingual",
    update_stream: "none",
    purpose: "Pinned-column overhead on variable-height inspection content.",
  },
  {
    id: "S8",
    name: "pms-positions",
    rows: 20_000,
    cols: 40,
    row_height_mode: "variable",
    wrapped_columns: 1,
    pinned_left: 2,
    purpose:
      "Portfolio-management cockpit: grouped positions under a price stream.",
    update_stream: {
      mode: "batched",
      batch_every_ms: 50,
      visible_update_rate_per_sec: 200,
      offscreen_update_rate_per_sec: 800,
    },
  },
] as const satisfies readonly ScenarioDefinition[];

const scenarioSeeds: Record<ScenarioId, number> = {
  S1: 101,
  S2: 202,
  S3: 303,
  S4: 404,
  S5: 505,
  S6: 606,
  S7: 707,
  S8: 808,
};

const englishMessages = [
  "Dense text baseline row",
  "Viewport should stay stable",
  "Rows remain fixed height",
  "Simple text still deserves predictable mounting",
];

const multilingualMessages = [
  "Hola desde Pretable",
  "Bonjour depuis Pretable",
  "Pretable says hello in English",
  "Pretableからこんにちは",
  "مرحبا من بريتيبل",
  "Pretable manda um oi em portugues",
];

const owners = ["text-core", "layout-core", "grid-core", "renderer-dom"];
const statuses = ["queued", "ready", "running", "done"];

export function listScenarios(): readonly ScenarioDefinition[] {
  return scenarioDefinitions;
}

export function getScenarioById(id: ScenarioId): ScenarioDefinition {
  const scenario = scenarioDefinitions.find((candidate) => candidate.id === id);

  if (!scenario) {
    throw new Error(`Unknown scenario: ${id}`);
  }

  return scenario;
}

export function createScenarioDataset(
  id: ScenarioId,
  options: { scale?: ScenarioScale; seed?: number } = {},
): ScenarioDataset {
  const scenario = getScenarioById(id);
  const seed = options.seed ?? scenarioSeeds[id];
  const scale = options.scale ?? "smoke";
  const rowCount = scenarioScaleRowCounts[id][scale];

  if (id === "S8") {
    return {
      scenario,
      scale,
      columns: pmsColumns,
      rows: buildPmsRows(seed, rowCount),
      rowCount,
      seed,
      roles: pmsRoles,
    };
  }

  return {
    scenario,
    scale,
    columns: buildColumns(scenario),
    rows: buildRows(scenario, seed, rowCount),
    rowCount,
    seed,
    roles: legacyScenarioRoles,
  };
}

function buildColumns(scenario: ScenarioDefinition): readonly ScenarioColumn[] {
  return Array.from({ length: scenario.cols }, (_, index) => {
    const column: ScenarioColumn = {
      id: `col_${index}`,
      header: createColumnHeader(index),
      wrap: index < scenario.wrapped_columns,
      pinned: index < scenario.pinned_left ? "left" : undefined,
    };

    if (!scenario.autosize_all_columns) {
      column.widthPx =
        index < scenario.wrapped_columns ? 220 : index % 4 === 3 ? 96 : 140;
    }

    return column;
  });
}

function buildRows(
  scenario: ScenarioDefinition,
  seed: number,
  count: number,
): readonly ScenarioRow[] {
  return Array.from({ length: count }, (_, index) => {
    const row = {
      id: `${scenario.id}-row-${index}`,
    } as ScenarioRow;

    for (let columnIndex = 0; columnIndex < scenario.cols; columnIndex += 1) {
      row[`col_${columnIndex}`] = createCellValue({
        scenario,
        seed,
        rowIndex: index,
        columnIndex,
      });
    }

    return row;
  });
}

function createColumnHeader(index: number) {
  if (index % 4 === 0) {
    return `Message ${Math.floor(index / 4) + 1}`;
  }

  if (index % 4 === 1) {
    return `Owner ${Math.floor(index / 4) + 1}`;
  }

  if (index % 4 === 2) {
    return `Status ${Math.floor(index / 4) + 1}`;
  }

  return `Score ${Math.floor(index / 4) + 1}`;
}

function createCellValue(input: {
  scenario: ScenarioDefinition;
  seed: number;
  rowIndex: number;
  columnIndex: number;
}): string | number {
  const { scenario, seed, rowIndex, columnIndex } = input;

  if (columnIndex < scenario.wrapped_columns) {
    return createWrappedTextValue(input);
  }

  switch (columnIndex % 4) {
    case 1:
      return owners[(seed + rowIndex + columnIndex) % owners.length];
    case 2:
      return statuses[(seed + rowIndex + columnIndex) % statuses.length];
    case 3:
      return ((seed + rowIndex * 7 + columnIndex * 13) % 1000) / 10;
    default:
      return `${englishMessages[(seed + rowIndex + columnIndex) % englishMessages.length]} ${seed + rowIndex + columnIndex}`;
  }
}

function createWrappedTextValue(input: {
  scenario: ScenarioDefinition;
  seed: number;
  rowIndex: number;
  columnIndex: number;
}) {
  const { scenario, seed, rowIndex, columnIndex } = input;
  const messagePool =
    scenario.corpus === "multilingual" ? multilingualMessages : englishMessages;
  const repeatCount = 1 + ((seed + rowIndex + columnIndex) % 4);
  const message = messagePool[(rowIndex + columnIndex) % messagePool.length];

  return Array.from({ length: repeatCount }, (_, repeatIndex) => {
    const token = seed + rowIndex * 17 + columnIndex * 29 + repeatIndex;
    return `${message} token-${token}`;
  }).join(" ");
}

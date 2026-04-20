export type ScenarioId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";
export type ScenarioScale = "smoke" | "dev" | "hypothesis" | "target";
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
  widthPx: number;
  pinned?: "left";
}

export type ScenarioRow = Record<string, string | number>;

export interface ScenarioDataset {
  scenario: ScenarioDefinition;
  scale: ScenarioScale;
  columns: readonly ScenarioColumn[];
  rows: readonly ScenarioRow[];
  rowCount: number;
  seed: number;
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
  },
  S2: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 50_000,
  },
  S3: {
    smoke: 120,
    dev: 500,
    hypothesis: 2_500,
    target: 10_000,
  },
  S4: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 25_000,
  },
  S5: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 20_000,
  },
  S6: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 10_000,
  },
  S7: {
    smoke: 120,
    dev: 750,
    hypothesis: 3_000,
    target: 50_000,
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
] as const satisfies readonly ScenarioDefinition[];

const scenarioSeeds: Record<ScenarioId, number> = {
  S1: 101,
  S2: 202,
  S3: 303,
  S4: 404,
  S5: 505,
  S6: 606,
  S7: 707,
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
  options: { scale?: ScenarioScale } = {},
): ScenarioDataset {
  const scenario = getScenarioById(id);
  const seed = scenarioSeeds[id];
  const scale = options.scale ?? "smoke";
  const rowCount = scenarioScaleRowCounts[id][scale];

  return {
    scenario,
    scale,
    columns: buildColumns(scenario),
    rows: buildRows(scenario, seed, rowCount),
    rowCount,
    seed,
  };
}

function buildColumns(scenario: ScenarioDefinition): readonly ScenarioColumn[] {
  return Array.from({ length: scenario.cols }, (_, index) => ({
    id: `col_${index}`,
    header: createColumnHeader(index),
    wrap: index < scenario.wrapped_columns,
    widthPx:
      index < scenario.wrapped_columns ? 220 : index % 4 === 3 ? 96 : 140,
    pinned: index < scenario.pinned_left ? "left" : undefined,
  }));
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

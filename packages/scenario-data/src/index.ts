export type ScenarioId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";

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
}

export type ScenarioRow = Record<string, string | number>;

export interface ScenarioDataset {
  scenario: ScenarioDefinition;
  columns: readonly ScenarioColumn[];
  rows: readonly ScenarioRow[];
  seed: number;
}

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
] as const satisfies readonly ScenarioDefinition[];

const scenarioColumns: readonly ScenarioColumn[] = [
  { id: "message", header: "Message" },
  { id: "owner", header: "Owner" },
  { id: "status", header: "Status" },
  { id: "score", header: "Score" },
];

const scenarioSeeds: Record<ScenarioId, number> = {
  S1: 101,
  S2: 202,
  S3: 303,
  S4: 404,
  S5: 505,
  S6: 606,
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

export function createScenarioDataset(id: ScenarioId): ScenarioDataset {
  const scenario = getScenarioById(id);
  const seed = scenarioSeeds[id];
  const sampleSize = id === "S1" ? 24 : id === "S2" ? 18 : 12;

  return {
    scenario,
    columns: scenarioColumns,
    rows: buildRows(scenario, seed, sampleSize),
    seed,
  };
}

function buildRows(
  scenario: ScenarioDefinition,
  seed: number,
  count: number,
): readonly ScenarioRow[] {
  return Array.from({ length: count }, (_, index) => {
    const messagePool =
      scenario.corpus === "multilingual" ? multilingualMessages : englishMessages;

    return {
      id: `${scenario.id}-row-${index}`,
      message: `${messagePool[index % messagePool.length]} #${seed + index}`,
      owner: owners[(seed + index) % owners.length],
      status: statuses[(seed + index) % statuses.length],
      score: ((seed + index * 7) % 1000) / 10,
    };
  });
}

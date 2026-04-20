export type InspectionSeverity = "trace" | "info" | "warn" | "error";

export interface InspectionRow extends Record<string, unknown> {
  id: string;
  timestamp: string;
  severity: InspectionSeverity;
  source: string;
  owner: string;
  tags: string[];
  message: string;
}

export type InspectionFilterableColumnId =
  | "timestamp"
  | "severity"
  | "source"
  | "message";

export type InspectionColumnId =
  | "id"
  | "timestamp"
  | "severity"
  | "source"
  | "owner"
  | "tags"
  | "message";

export type InspectionDatasetScale = "tiny" | "dev" | "stress";

export interface InspectionColumn {
  id: InspectionColumnId;
  header: string;
  pinned?: "left";
  widthPx: number;
  wrap?: boolean;
  getValue?: (row: InspectionRow) => string;
}

export interface InspectionDataset {
  columns: readonly InspectionColumn[];
  filterableColumnIds: readonly InspectionFilterableColumnId[];
  rowCount: number;
  rows: readonly InspectionRow[];
  scale: InspectionDatasetScale;
}

export const inspectionColumns: readonly InspectionColumn[] = [
  { id: "timestamp", header: "Timestamp", pinned: "left", widthPx: 188 },
  { id: "severity", header: "Severity", pinned: "left", widthPx: 112 },
  { id: "source", header: "Source", widthPx: 160 },
  { id: "owner", header: "Owner", widthPx: 144 },
  {
    id: "tags",
    header: "Tags",
    widthPx: 200,
    getValue: (row) => row.tags.join(", "),
  },
  { id: "message", header: "Message", wrap: true, widthPx: 480 },
];

export const inspectionFilterableColumnIds: readonly InspectionFilterableColumnId[] =
  ["timestamp", "severity", "source", "message"];

export const inspectionDatasetScaleOptions = [
  { label: "Tiny", value: "tiny" },
  { label: "Dev", value: "dev" },
  { label: "Stress", value: "stress" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: InspectionDatasetScale;
}>;

const inspectionScaleRowCounts: Record<InspectionDatasetScale, number> = {
  tiny: 7,
  dev: 250,
  stress: 2_500,
};

const tinyRows: readonly InspectionRow[] = [
  {
    id: "evt-001",
    timestamp: "2026-04-12T09:18:11Z",
    severity: "info",
    source: "gateway",
    owner: "routing",
    tags: ["cold-start", "tenant-a"],
    message:
      "Cold request path completed after a fresh worker spin-up while keeping trace stitching intact across two proxy hops.",
  },
  {
    id: "evt-002",
    timestamp: "2026-04-12T09:18:44Z",
    severity: "error",
    source: "retriever",
    owner: "rag-pipeline",
    tags: ["customer-facing", "timeout"],
    message:
      "Retrieval fan-out exceeded the budget after a region failover and the downstream answer stream stalled before the model could emit the first token.",
  },
  {
    id: "evt-003",
    timestamp: "2026-04-12T09:19:03Z",
    severity: "warn",
    source: "session-cache",
    owner: "state",
    tags: ["eviction", "burst"],
    message:
      "Session cache hit-rate fell below the burst target; the next compaction window should be widened before the afternoon replay job starts.",
  },
  {
    id: "evt-004",
    timestamp: "2026-04-12T09:19:19Z",
    severity: "trace",
    source: "planner",
    owner: "agents",
    tags: ["tool-call", "spec"],
    message:
      "Planner emitted a single-tool branch after confirming the benchmark matrix already had current repeated-run evidence for H1 and H3.",
  },
  {
    id: "evt-005",
    timestamp: "2026-04-12T09:19:57Z",
    severity: "error",
    source: "stream-router",
    owner: "inference",
    tags: ["backpressure", "sse"],
    message:
      "Stream router dropped a partial chunk when the client reconnected mid-flight; the replay cursor recovered, but the user saw a duplicate completion banner.",
  },
  {
    id: "evt-006",
    timestamp: "2026-04-12T09:20:21Z",
    severity: "info",
    source: "analytics",
    owner: "benchmarks",
    tags: ["runset", "median"],
    message:
      "Repeated-run medians stayed inside the current volatility envelope, with policy notes preserved in the runset summary and no blank-gap regressions.",
  },
  {
    id: "evt-007",
    timestamp: "2026-04-12T09:20:58Z",
    severity: "warn",
    source: "policy-audit",
    owner: "safety",
    tags: ["drift", "review"],
    message:
      "Policy-note drift was detected across two candidate runs, so the report downgraded the claim from satisfied to directional instead of over-claiming confidence.",
  },
] as const;

const generatedSeverities: readonly InspectionSeverity[] = [
  "info",
  "warn",
  "error",
  "trace",
];

const generatedSources = [
  "gateway",
  "retriever",
  "session-cache",
  "planner",
  "stream-router",
  "analytics",
  "policy-audit",
  "vector-index",
];

const generatedOwners = [
  "routing",
  "rag-pipeline",
  "state",
  "agents",
  "inference",
  "benchmarks",
  "safety",
  "storage",
];

const generatedTagSets = [
  ["cold-start", "tenant-a"],
  ["customer-facing", "timeout"],
  ["eviction", "burst"],
  ["tool-call", "spec"],
  ["backpressure", "sse"],
  ["runset", "median"],
  ["drift", "review"],
  ["warm-cache", "steady-state"],
];

const generatedMessages = [
  "Wrapped inspection rows should stay legible while the grid keeps backward scroll anchor behavior stable under sustained navigation.",
  "Pinned metadata columns must remain readable without forcing the renderer onto a separate code path that hides real layout costs.",
  "Local filtering, sorting, and selection should work on the same core state machine that future remote and streaming modes will use.",
  "Large local inspection datasets are for manual pressure testing, not marketing claims; benchmark evidence still decides whether the wedge is real.",
  "Telemetry in the prototype should explain rendered rows and planned height without requiring developers to scrape DOM state by hand.",
];

export function createInspectionDataset(
  scale: InspectionDatasetScale = "dev",
): InspectionDataset {
  const rows =
    scale === "tiny"
      ? tinyRows
      : createGeneratedInspectionRows(scale, inspectionScaleRowCounts[scale]);

  return {
    columns: inspectionColumns,
    filterableColumnIds: inspectionFilterableColumnIds,
    rowCount: rows.length,
    rows,
    scale,
  };
}

export function getInspectionFilterValue(
  row: InspectionRow,
  columnId: InspectionFilterableColumnId,
) {
  switch (columnId) {
    case "timestamp":
      return row.timestamp;
    case "severity":
      return row.severity;
    case "source":
      return row.source;
    case "message":
      return row.message;
  }
}

function createGeneratedInspectionRows(
  scale: Exclude<InspectionDatasetScale, "tiny">,
  count: number,
): readonly InspectionRow[] {
  const baseTimestamp = Date.UTC(2026, 3, 12, 9, 30, 0, 0);

  return Array.from({ length: count }, (_, index) => {
    const severity = generatedSeverities[index % generatedSeverities.length]!;
    const source = generatedSources[index % generatedSources.length]!;
    const owner = generatedOwners[(index * 3) % generatedOwners.length]!;
    const tags = generatedTagSets[index % generatedTagSets.length]!;
    const timestamp = new Date(baseTimestamp + index * 17_000).toISOString();
    const id = `evt-${scale}-${String(index).padStart(4, "0")}`;
    const messageTemplate =
      generatedMessages[index % generatedMessages.length]!;
    const repeatCount = 1 + (index % 4);
    const message = Array.from({ length: repeatCount }, (_, repeatIndex) => {
      const token = `${scale}-${index}-${repeatIndex}`;
      return `${messageTemplate} token-${token}`;
    }).join(" ");

    return {
      id,
      message,
      owner,
      severity,
      source,
      tags: [...tags],
      timestamp,
    };
  });
}

import type { PretableTelemetry } from "@pretable/react/internal";
import { PretableSurface } from "@pretable/react/internal";
import type { ScenarioDataset } from "@pretable-internal/scenario-data";

export interface PretableAdapterProps {
  dataset: ScenarioDataset;
  onTelemetryChange?: (telemetry: PretableTelemetry) => void;
  runKey: number;
}

const VIEWPORT_HEIGHT = 320;
const BENCHMARK_VIEWPORT_STYLE = {
  contain: "none",
  containIntrinsicSize: "none",
  contentVisibility: "visible",
  overflowAnchor: "none",
  overscrollBehavior: "contain",
} as const;

function getScenarioRowId(row: ScenarioDataset["rows"][number]) {
  return String(row.id ?? "");
}

export function PretableAdapter({
  dataset,
  onTelemetryChange,
  runKey,
}: PretableAdapterProps) {
  return (
    <section
      aria-label="Pretable React adapter"
      className="adapter-surface"
      data-benchmark-adapter="pretable"
      key={runKey}
      style={{
        display: "grid",
        gap: 12,
      }}
    >
      <header>
        <p
          style={{
            margin: 0,
            fontWeight: 700,
          }}
        >
          Pretable React adapter
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {dataset.rows.length}
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Columns: {dataset.columns.length}
        </p>
      </header>

      <PretableSurface
        ariaLabel="Pretable React adapter"
        columns={[...dataset.columns]}
        getRowId={getScenarioRowId}
        onTelemetryChange={onTelemetryChange}
        renderBodyCell={({ value }) => String(value ?? "")}
        renderHeaderCell={({ label }) => label}
        rows={[...dataset.rows]}
        viewportHeight={VIEWPORT_HEIGHT}
        viewportStyle={BENCHMARK_VIEWPORT_STYLE}
      />
    </section>
  );
}

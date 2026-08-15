import { useEffect, useRef, useState } from "react";
import {
  PretableSurface,
  type PretableColumn,
  type PretableIndexedCellSelectionSummary,
  type PretableSelectionState,
  type PretableSurfaceGrid,
} from "@pretable/react";

interface WindowedRow {
  readonly id: string;
  readonly value: number;
}

/**
 * Large enough that "the extent spans the loaded window" and "the extent
 * spans the dataset" are visibly, unmissably different numbers — 50 loaded
 * rows against 10,000 total rows at a 48px row height is a ~2,400px viewport
 * extent either way it is wired, versus a ~480,000px one the other way.
 */
const TOTAL_ROWS = 10_000;
const PAGE_SIZE = 50;

/**
 * The population every dataset span is measured in. Spans fail CLOSED on this
 * (see `PretableIndexedDatasetRowSpan.datasetKey`): a windowed grid that
 * publishes no key gets no span survival at all, because the engine cannot
 * tell a scroll from a re-sort. Constant here because this harness never
 * re-sorts or re-filters — `?datasetKey=0` is the only thing that removes it.
 */
const DATASET_KEY = "windowed-harness";

function makeWindowRows(start: number, count: number): WindowedRow[] {
  const rows: WindowedRow[] = [];
  const end = Math.min(start + count, TOTAL_ROWS);
  for (let index = start; index < end; index += 1) {
    rows.push({ id: `row-${index}`, value: index });
  }
  return rows;
}

const columns: readonly PretableColumn<WindowedRow>[] = [
  {
    id: "value",
    header: "Dataset index",
    value: (row) => row.value,
    type: "number",
  },
];

declare global {
  interface Window {
    /**
     * The pager gesture under test: swap to a new window by changing
     * `resultMeta.window.start` and the `rows` prop together, in one React
     * state update — no `onTelemetryChange` round-trip, because this harness
     * never wires one. This is deliberate: it is the one thing `<Pretable>`,
     * the drop-in component, can actually do — it cannot receive telemetry.
     */
    __pretableWindowedHarness?: {
      setWindowStart: (start: number) => void;
      /**
       * The CELL-RANGE slice's row count, and whether it is proven — read
       * straight off the grid, which answers it by arithmetic over dataset
       * spans rather than by visiting rows. `null` before the grid is ready.
       *
       * Deliberately not the checkbox column's `getSelectionSummary()`: that
       * is a separate, already-sparse selection program, and a count taken
       * from it would survive eviction whether or not any of this shipped.
       */
      cellSelectionSummary: () => PretableIndexedCellSelectionSummary | null;
      /** The last selection this grid reported through `onSelectionChange`. */
      lastSelection: () => PretableSelectionState | null;
    };
  }
}

export interface WindowedHarnessProps {
  search: string;
}

/**
 * Task 4 (windowed-data plan) and Task 4 (eviction plan) — GATE harness.
 *
 * Mounted via `PretableSurface` in its ROWS-OWNED, UNCONTROLLED mode: `rows`
 * + `getRowId`, no `model`, no `onTelemetryChange`. That is exactly the code
 * path `<Pretable>` (the drop-in) wraps — `<Pretable>` is a thin pass-through
 * to this same mode and does not expose `model` or telemetry either. Using
 * `PretableSurface` directly here rather than `<Pretable>` only because
 * `<Pretable>` does not yet forward a `resultMeta` prop; the rendering path
 * under test — the one W1–W3 built — is identical either way, so this
 * faithfully answers the question the gate asks.
 *
 * `?windowStart=N` sets the initial window offset.
 *
 * Two independent kill switches, each stripping one input the engine needs:
 *
 * - `?windowMeta=0` strips `resultMeta.window` entirely (keeping `total`).
 *   Without it nothing can tell an evicted row from a deleted one, so a
 *   selection whose rows leave the window is PRUNED and never comes back.
 * - `?datasetKey=0` keeps the window but strips the population identity.
 *   Positioning still works; dataset spans are refused, so a selection
 *   degrades to whatever the loaded window can still resolve.
 */
export function WindowedHarness({ search }: WindowedHarnessProps) {
  const params = new URLSearchParams(search);
  const parsedStart = Number(params.get("windowStart") ?? "0");
  const initialStart =
    Number.isFinite(parsedStart) && parsedStart >= 0 ? parsedStart : 0;
  const includeWindow = params.get("windowMeta") !== "0";
  const includeDatasetKey = params.get("datasetKey") !== "0";

  const [windowStart, setWindowStart] = useState(initialStart);
  const rows = makeWindowRows(windowStart, PAGE_SIZE);
  const gridRef = useRef<PretableSurfaceGrid<
    WindowedRow,
    string,
    readonly PretableColumn<WindowedRow>[]
  > | null>(null);
  const lastSelectionRef = useRef<PretableSelectionState | null>(null);

  useEffect(() => {
    window.__pretableWindowedHarness = {
      setWindowStart: (start: number) => {
        setWindowStart(start);
      },
      cellSelectionSummary: () =>
        gridRef.current?.getCellSelectionSummary() ?? null,
      lastSelection: () => lastSelectionRef.current,
    };
    return () => {
      delete window.__pretableWindowedHarness;
    };
  }, []);

  return (
    <div data-windowed-harness="" style={{ padding: 16 }}>
      <PretableSurface
        ariaLabel="Windowed harness"
        columns={columns}
        getRowId={(row) => row.id}
        onGridReady={(grid) => {
          gridRef.current = grid;
        }}
        onSelectionChange={(next) => {
          lastSelectionRef.current = next;
        }}
        processing={{ filter: "external", sort: "external" }}
        renderBodyCell={({ value }) => String(value)}
        renderHeaderCell={({ label }) => label}
        resultMeta={{
          total: { kind: "exact", count: TOTAL_ROWS },
          ...(includeWindow
            ? {
                window: {
                  start: windowStart,
                  hasMore: windowStart + rows.length < TOTAL_ROWS,
                },
              }
            : {}),
          ...(includeDatasetKey ? { datasetKey: DATASET_KEY } : {}),
        }}
        rows={rows}
        viewportHeight={400}
      />
    </div>
  );
}

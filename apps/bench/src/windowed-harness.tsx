import { useEffect, useState } from "react";
import { PretableSurface, type PretableColumn } from "@pretable/react";

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
    };
  }
}

export interface WindowedHarnessProps {
  search: string;
}

/**
 * Task 4 (windowed-data plan) — GATE harness.
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
 * `?windowStart=N` sets the initial window offset. `?windowMeta=0` strips
 * `resultMeta.window` entirely (keeping `total`) — the mutation this task's
 * test uses to prove its positioning assertions can actually fail.
 */
export function WindowedHarness({ search }: WindowedHarnessProps) {
  const params = new URLSearchParams(search);
  const parsedStart = Number(params.get("windowStart") ?? "0");
  const initialStart =
    Number.isFinite(parsedStart) && parsedStart >= 0 ? parsedStart : 0;
  const includeWindow = params.get("windowMeta") !== "0";

  const [windowStart, setWindowStart] = useState(initialStart);
  const rows = makeWindowRows(windowStart, PAGE_SIZE);

  useEffect(() => {
    window.__pretableWindowedHarness = {
      setWindowStart: (start: number) => {
        setWindowStart(start);
      },
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
        }}
        rows={rows}
        viewportHeight={400}
      />
    </div>
  );
}

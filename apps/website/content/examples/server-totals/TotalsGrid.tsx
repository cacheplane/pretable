"use client";

import { useEffect, useRef, useState } from "react";

import {
  PretableSurface,
  resolveDataScope,
  type PretableDataState,
  type PretableMatchingTotal,
} from "@pretable/react";

import { columns } from "./columns";
import {
  fetchRows,
  type Order,
  type OrderQuery,
  type TotalKind,
} from "./fetch-rows";

const KINDS: TotalKind[] = ["exact", "estimate", "unknown"];

/** The query never changes here; only the confidence of the count does. */
const EMPTY_QUERY: OrderQuery = { filters: [], sort: [], rowGroups: [] };

const PROCESSING = { filter: "external", sort: "external" } as const;

/**
 * The same population whichever total is claimed: the radio buttons change the
 * server's confidence, not which records matched, so the key must NOT change
 * with them.
 */
const DATASET_KEY = JSON.stringify(EMPTY_QUERY);

const VIEWPORT_HEIGHT = 320;

export function TotalsGrid() {
  const [totalKind, setTotalKind] = useState<TotalKind>("exact");
  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState<PretableMatchingTotal>({
    kind: "unknown",
  });
  const [dataState, setDataState] = useState<PretableDataState>({
    phase: "loading",
  });

  // Whether a result has ever committed. The first request is `loading`; every
  // radio press after it is `stale` — the rows stay up, untouched, while the
  // new count is in flight.
  const hasCommitted = useRef(false);

  useEffect(() => {
    let cancelled = false;

    setDataState({ phase: hasCommitted.current ? "stale" : "loading" });

    fetchRows(EMPTY_QUERY, { totalKind }).then(
      (result) => {
        if (cancelled) return;
        hasCommitted.current = true;
        setRows(result.rows);
        setTotal(result.total);
        setDataState({ phase: "idle" });
      },
      (error: unknown) => {
        if (cancelled) return;
        hasCommitted.current = true;
        setDataState({
          phase: "error",
          message: error instanceof Error ? error.message : "Request failed",
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [totalKind]);

  // The function the CSV export calls, given what this grid could give it:
  // how many records are loaded, what the server claims exists, and who has
  // authority over which records those are.
  const scope = resolveDataScope(
    { loadedRowCount: rows.length, matchingTotal: total },
    PROCESSING,
  );

  const [gridRef, ariaRowCount] = useAnnouncedRowCount();

  return (
    <div>
      <fieldset
        style={{
          border: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          margin: "0 0 8px",
          padding: 0,
        }}
      >
        <legend style={{ fontSize: 13, padding: 0 }}>
          The count the server claims
        </legend>
        {KINDS.map((kind) => (
          <label key={kind} style={{ fontSize: 13 }}>
            <input
              checked={totalKind === kind}
              name="server-totals-kind"
              onChange={() => setTotalKind(kind)}
              type="radio"
              value={kind}
            />{" "}
            {kind}
          </label>
        ))}
      </fieldset>
      <p role="status" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Reported:{" "}
        <code data-testid="reported-total">{JSON.stringify(total)}</code> — an
        export of this grid would be scoped{" "}
        <code data-testid="export-scope">{scope}</code>, and the grid announces{" "}
        <code>aria-rowcount</code>{" "}
        <code data-testid="aria-rowcount">{ariaRowCount ?? "…"}</code>. The same
        480 records every time: only the claim about them changed.
      </p>
      <div ref={gridRef}>
        <PretableSurface<Order>
          ariaLabel="Orders"
          columns={columns}
          dataState={dataState}
          getRowId={(row) => row.id}
          // Fixed for the life of this grid, and the reason the funnels are
          // switched off: under external filter authority the engine stops
          // applying `query.filters`, so a funnel here would set one that did
          // nothing. What the claim changes on this page is what the grid is
          // willing to SAY about how many records there are.
          processing={PROCESSING}
          resultMeta={{ total, datasetKey: DATASET_KEY }}
          rows={rows}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
    </div>
  );
}

/**
 * Reads the `aria-rowcount` the grid actually published, rather than
 * recomputing what it ought to be — the point of the readout is that it is the
 * attribute a screen reader gets.
 *
 * A `MutationObserver` rather than an effect keyed on the total, because the
 * attribute settles a beat after the rows commit: the row model ingests new
 * rows asynchronously, so the count is derived twice per change and only the
 * second value is the final one.
 */
function useAnnouncedRowCount(): [
  React.RefObject<HTMLDivElement | null>,
  string | null,
] {
  const ref = useRef<HTMLDivElement>(null);
  const [rowCount, setRowCount] = useState<string | null>(null);

  useEffect(() => {
    const viewport = ref.current?.querySelector(
      "[data-pretable-scroll-viewport]",
    );
    if (!viewport) return;

    const read = (): void =>
      setRowCount(viewport.getAttribute("aria-rowcount"));

    read();
    const observer = new MutationObserver(read);
    observer.observe(viewport, { attributeFilter: ["aria-rowcount"] });

    return () => observer.disconnect();
  }, []);

  return [ref, rowCount];
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  PretableSurface,
  type PretableDataState,
  type PretableMatchingTotal,
} from "@pretable/react";

import { columns } from "./columns";
import { fetchRows, type Order, type OrderQuery } from "./fetch-rows";

const EMPTY_QUERY: OrderQuery = { filters: [], sort: [], rowGroups: [] };

const VIEWPORT_HEIGHT = 320;

export function ServerDataGrid() {
  const [query, setQuery] = useState<OrderQuery>(EMPTY_QUERY);
  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState<PretableMatchingTotal>({
    kind: "unknown",
  });
  const [dataState, setDataState] = useState<PretableDataState>({
    phase: "loading",
  });

  // Whether a result has ever committed. The first fetch is `loading` (there is
  // nothing on screen yet); every one after it is `stale` — the previous rows
  // stay up, and stay sortable, while the new ones are in flight.
  const hasCommitted = useRef(false);

  useEffect(() => {
    let cancelled = false;

    setDataState({ phase: hasCommitted.current ? "stale" : "loading" });

    fetchRows(query).then(
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
        // Rows are left untouched: a failed request never discards the last
        // result that did answer.
        setDataState({
          phase: "error",
          message: error instanceof Error ? error.message : "Request failed",
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [query]);

  const onQueryChange = useCallback((next: OrderQuery) => setQuery(next), []);

  return (
    <div>
      <p role="status" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Phase: <code>{dataState.phase}</code>
        {dataState.phase === "error" ? ` — ${dataState.message}` : ""}. Click a
        header or open a funnel: each one is a request, and the server decides
        the rows.
      </p>
      <PretableSurface<Order>
        ariaLabel="Orders"
        columns={columns}
        dataState={dataState}
        getRowId={(row) => row.id}
        onQueryChange={onQueryChange}
        // Declares that the SERVER chose these records and their order. It is
        // a claim about authority, not a switch: the engine still applies the
        // published query to the rows below, which is a no-op while the two
        // agree. What it buys is honest counts — see the totals page.
        processing={{ filter: "external", sort: "external" }}
        query={query}
        resultMeta={{ total, datasetKey: JSON.stringify(query) }}
        rows={rows}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}

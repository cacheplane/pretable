"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Pretable, type PretableDataState } from "@pretable/react";

import { columns } from "./columns";
import { fetchRows, type Order, type OrderQuery } from "./fetch-rows";

/** What the grid starts with, and so what the first request asks for. */
const EMPTY_QUERY: OrderQuery = { filters: [], sort: [], rowGroups: [] };

export function NotifyOnlyGrid() {
  const [rows, setRows] = useState<Order[]>([]);
  const [requests, setRequests] = useState(0);
  const [dataState, setDataState] = useState<PretableDataState>({
    phase: "loading",
  });

  // Whether a result has ever committed: the first fetch is `loading` (nothing
  // is on screen yet), every one after it is `stale`.
  const hasCommitted = useRef(false);

  // Notify-only hands you a callback, not an effect, so there is no cleanup to
  // run when a newer query supersedes an in-flight one. A sequence number does
  // the same job: a response that is no longer the latest request's is dropped
  // rather than committed out of order.
  const latestRequest = useRef(0);

  const load = useCallback((query: OrderQuery) => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setRequests(requestId);
    setDataState({ phase: hasCommitted.current ? "stale" : "loading" });

    fetchRows(query).then(
      (result) => {
        if (requestId !== latestRequest.current) return;
        hasCommitted.current = true;
        setRows(result.rows);
        setDataState({ phase: "idle" });
      },
      (error: unknown) => {
        if (requestId !== latestRequest.current) return;
        hasCommitted.current = true;
        // Rows are left untouched: a failed request never discards the last
        // result that did answer.
        setDataState({
          phase: "error",
          message: error instanceof Error ? error.message : "Request failed",
        });
      },
    );
  }, []);

  // The one request the grid cannot ask for: nothing changed yet, so
  // `onQueryChange` has not fired.
  useEffect(() => {
    load(EMPTY_QUERY);
  }, [load]);

  return (
    <div>
      <p role="status" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Requests sent: <code data-testid="request-count">{requests}</code> —
        phase <code>{dataState.phase}</code>
        {dataState.phase === "error" ? ` (${dataState.message})` : ""}. The grid
        holds the query; it only tells you when it changed.
      </p>
      <Pretable<Order>
        ariaLabel="Orders"
        columns={columns}
        dataState={dataState}
        getRowId={(row) => row.id}
        // No `query` prop — `<Pretable>` does not accept one. The engine owns
        // the reader's intent and reports it here, which is enough to fetch
        // against and one prop less to keep in sync.
        onQueryChange={load}
        // Declares that the SERVER chose these records and their order. It is a
        // claim about authority, not a switch: the engine goes on applying the
        // reported query to the rows below, which is a no-op while the two
        // agree — and is not one while a request is in flight or has failed.
        processing={{ filter: "external", sort: "external" }}
        rows={rows}
      />
    </div>
  );
}

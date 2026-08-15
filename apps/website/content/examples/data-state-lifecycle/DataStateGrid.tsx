"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PretableSurface, type PretableDataState } from "@pretable/react";

import { columns } from "./columns";
import { type Order, searchOrders } from "./search-orders";

const VIEWPORT_HEIGHT = 320;

export function DataStateGrid() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  // The query the rows on screen answer, not the one being typed. It changes
  // when the result changes and at no other moment — that is the whole job of
  // a dataset key.
  const [datasetKey, setDatasetKey] = useState("");
  const [dataState, setDataState] = useState<PretableDataState>({
    phase: "loading",
  });

  // Whether a result has ever committed — the first search is `loading`
  // (nothing to show yet); every search after that is `stale` (the PREVIOUS
  // result stays on screen while the new one loads).
  const hasCommitted = useRef(false);

  const runSearch = useCallback((q: string) => {
    setDataState({ phase: hasCommitted.current ? "stale" : "loading" });
    searchOrders(q).then(
      (result) => {
        hasCommitted.current = true;
        setRows(result.rows);
        setTotal(result.total);
        setDatasetKey(q);
        setDataState({ phase: "idle" });
      },
      (error: unknown) => {
        hasCommitted.current = true;
        // Rows are deliberately left untouched — an error never discards the
        // last fulfilled result. The surface reads bodyRowCount to decide
        // between the full-viewport error block and this error strip. The
        // dataset key is left alone too: the rows still answer the query it
        // names.
        setDataState({
          phase: "error",
          message: error instanceof Error ? error.message : "Search failed",
        });
      },
    );
  }, []);

  // First load, on mount.
  useEffect(() => {
    runSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          runSearch(query);
        }}
        style={{ display: "flex", gap: 8, marginBottom: 8 }}
      >
        <input
          aria-label="Search orders by customer"
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Try "calder", or "fail" to see the error phase'
          style={{ flex: 1, fontSize: 13 }}
          value={query}
        />
        <button type="submit">Search</button>
      </form>
      <p role="status" style={{ margin: "0 0 8px", fontSize: 13 }}>
        Phase: <code>{dataState.phase}</code>
        {dataState.phase === "error" ? ` — ${dataState.message}` : ""}. Rows
        stay clickable and sortable throughout — try the column header, even
        during an error.
      </p>
      <PretableSurface<Order>
        ariaLabel="Order search results"
        columns={columns}
        dataState={dataState}
        getRowId={(row) => row.id}
        // The server does the filtering; the header sort stays local, which is
        // what makes it something you can still use while a request is failing.
        processing={{ filter: "external" }}
        resultMeta={{
          total: { kind: "exact", count: total },
          datasetKey,
        }}
        rows={rows}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}

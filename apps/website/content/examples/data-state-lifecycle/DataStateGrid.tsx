"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PretableSurface, type PretableDataState } from "@pretable/react";

import { columns } from "./columns";
import type { Product } from "./data";
import { searchProducts } from "./search-products";

const VIEWPORT_HEIGHT = 320;

export function DataStateGrid() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [dataState, setDataState] = useState<PretableDataState>({
    phase: "loading",
  });

  // Whether a result has ever committed — the first search is `loading`
  // (nothing to show yet); every search after that is `stale` (the PREVIOUS
  // result stays on screen while the new one loads).
  const hasCommitted = useRef(false);

  const runSearch = useCallback((q: string) => {
    setDataState({ phase: hasCommitted.current ? "stale" : "loading" });
    searchProducts(q).then(
      (result) => {
        hasCommitted.current = true;
        setRows(result.rows);
        setTotal(result.total);
        setDataState({ phase: "idle" });
      },
      (error: unknown) => {
        hasCommitted.current = true;
        // Rows are deliberately left untouched — an error never discards the
        // last fulfilled result. The surface reads bodyRowCount to decide
        // between the full-viewport error block and this error strip.
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
          aria-label="Search products"
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Try "jacket", or "fail" to see the error phase'
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
      <PretableSurface
        ariaLabel="Product search results"
        columns={columns}
        dataState={dataState}
        getRowId={(row) => row.id}
        processing={{ filter: "external" }}
        resultMeta={{
          total: { kind: "exact", count: total },
          datasetKey: query,
        }}
        rows={rows}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </div>
  );
}

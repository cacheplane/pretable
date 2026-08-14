"use client";

import { PretableSurface, type PretableColumn } from "@pretable/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import type { ServerRow } from "../../api/rows/dataset";

const COLUMNS: PretableColumn<ServerRow>[] = [
  { id: "region", header: "Region", type: "enum", widthPx: 140 },
  { id: "rep", header: "Rep", widthPx: 140 },
  { id: "amount", header: "Amount", type: "number", widthPx: 140 },
];

type SurfaceQuery = NonNullable<
  ComponentProps<typeof PretableSurface<ServerRow>>["query"]
>;

const EMPTY_QUERY: SurfaceQuery = { filters: [], sort: [], rowGroups: [] };

/**
 * Test fixture for `apps/website/e2e/server-query.spec.ts`, and the reference
 * for wiring a real backend.
 *
 * Controlled mode against a real endpoint: the grid reports the query the user
 * asked for, this component fetches rows for it, and the grid renders what
 * comes back. Nothing here sorts or filters — that is the whole point.
 *
 * The two data attributes are the test's only honest evidence, and they exist
 * because the screen is not evidence. Controlled mode stops the grid applying
 * a query *transition* itself, but it still applies the `query` prop it holds
 * to the `rows` prop it holds — and this component hands it both. So the
 * engine re-sorts and re-filters the server's answer, and a rendered order
 * assertion would pass even if `/api/rows` returned rows in a random order.
 *
 * - `data-fetch-count` proves a round-trip happened at all (freeze the fetch
 *   and it stops moving, while the screen keeps working).
 * - `data-server-row-ids` is the server's answer verbatim, in the order it
 *   arrived, before the engine touches it. It is the one thing on the page
 *   that changes if the server stops applying the query.
 *
 * `groupPanel` is enabled because the column menu — the only way to add a row
 * group by pointer — is rendered only when it is (`showColumnMenu` in
 * packages/react/src/pretable-surface.tsx).
 *
 * Deliberately not part of the product surface, and not linked from the site.
 */
export function ServerQueryGrid() {
  const columns = useMemo(() => COLUMNS, []);
  const [query, setQuery] = useState<SurfaceQuery>(EMPTY_QUERY);
  const [rows, setRows] = useState<ServerRow[]>([]);
  const [fetchCount, setFetchCount] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    void (async () => {
      const response = await fetch("/api/rows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(query),
      });
      const payload = (await response.json()) as { rows: ServerRow[] };
      // A slower earlier request must not overwrite a newer answer.
      if (mine !== generation.current) return;
      setRows(payload.rows);
      setFetchCount((count) => count + 1);
    })();
  }, [query]);

  return (
    <div
      data-testid="server-query-fixture"
      data-fetch-count={fetchCount}
      data-server-row-ids={rows.map((row) => row.id).join(",")}
    >
      <PretableSurface<ServerRow>
        ariaLabel="Server query grid"
        columns={columns}
        getRowId={(row) => row.id}
        groupPanel={{ enabled: true }}
        onQueryChange={setQuery}
        query={query}
        rows={rows}
        viewportHeight={320}
      />
    </div>
  );
}

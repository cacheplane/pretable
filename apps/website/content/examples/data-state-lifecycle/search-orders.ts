export interface Order {
  id: string;
  customer: string;
  region: string;
  status: string;
  total: number;
  placedAt: string;
}

export interface SearchResult {
  rows: Order[];
  total: number;
}

/**
 * One POST per search, against the docs' own endpoint: a real 500ms delay so
 * `stale` is visible, and a deterministic failure — any query containing
 * "fail" — so the `error` phase is reachable without waiting on network flake.
 */
export async function searchOrders(query: string): Promise<SearchResult> {
  const response = await fetch("/api/docs/rows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: {
        filters: query.trim()
          ? [{ columnId: "customer", operator: "contains", value: query }]
          : [],
        sort: [],
        rowGroups: [],
      },
      totalKind: "exact",
    }),
  });

  if (!response.ok) throw new Error("Search service unavailable");

  const body = (await response.json()) as {
    rows: Order[];
    total: { kind: string; count?: number };
  };

  return { rows: body.rows, total: body.total.count ?? body.rows.length };
}

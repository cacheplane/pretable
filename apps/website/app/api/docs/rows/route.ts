import { NextResponse } from "next/server";

import {
  applyDocsQuery,
  asksToFail,
  DOCS_ORDERS,
  type DocsQuery,
  type DocsTotalKind,
  EMPTY_DOCS_QUERY,
  totalFor,
} from "./dataset";

/**
 * Enough delay that `loading` and `stale` are things a reader can watch
 * happen. The docs pages state this number, so changing it changes prose.
 */
const LATENCY_MS = 500;

interface DocsRowsRequest {
  query?: Partial<DocsQuery>;
  offset?: number;
  limit?: number;
  totalKind?: DocsTotalKind;
  datasetKey?: string;
}

/**
 * Rows for a query. POST so the query travels as JSON rather than a
 * hand-rolled encoding, and `no-store` so one query change is one request —
 * the e2e counts them.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as DocsRowsRequest;

  const query: DocsQuery = {
    filters: body.query?.filters ?? EMPTY_DOCS_QUERY.filters,
    sort: body.query?.sort ?? EMPTY_DOCS_QUERY.sort,
    rowGroups: body.query?.rowGroups ?? EMPTY_DOCS_QUERY.rowGroups,
  };

  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

  if (asksToFail(query)) {
    return NextResponse.json(
      { message: "Order service unavailable" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  const matched = applyDocsQuery(DOCS_ORDERS, query);
  const offset = body.offset ?? 0;
  const limit = body.limit ?? matched.length;
  const rows = matched.slice(offset, offset + limit);

  return NextResponse.json(
    {
      rows,
      total: totalFor(
        body.totalKind ?? "exact",
        matched.length,
        offset,
        rows.length,
      ),
      datasetKey: body.datasetKey ?? "",
    },
    { headers: { "cache-control": "no-store" } },
  );
}

import { NextResponse } from "next/server";

import {
  applyDocsQuery,
  asksToFail,
  DOCS_ORDERS,
  type DocsQuery,
  DocsQueryError,
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
  let body: DocsRowsRequest;

  try {
    body = (await request.json()) as DocsRowsRequest;
  } catch {
    // A body that will not parse is the caller's mistake, and it must not read
    // as the deliberate 500 the failure demo teaches.
    return NextResponse.json(
      { message: "Request body must be JSON" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

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

  let matched;

  try {
    matched = applyDocsQuery(DOCS_ORDERS, query);
  } catch (error) {
    // A filter this fixture cannot answer surfaces as the error phase rather
    // than as an unfiltered grid that looks like the server ignored the query.
    if (error instanceof DocsQueryError) {
      return NextResponse.json(
        { message: error.message },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }

    throw error;
  }

  const offset = Math.max(0, body.offset ?? 0);
  const limit = Math.max(0, body.limit ?? matched.length);
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

import { NextResponse } from "next/server";

import { applyServerQuery, SERVER_ROWS, type ServerQuery } from "./dataset";

/**
 * Rows for a query. POST rather than GET so the query travels as JSON instead
 * of a hand-rolled encoding, and so responses are never cached — the test
 * asserts one request per query change and a cache hit would swallow them.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const query = (await request.json()) as Partial<ServerQuery>;
  const rows = applyServerQuery(SERVER_ROWS, {
    filters: query.filters ?? [],
    sort: query.sort ?? [],
    rowGroups: query.rowGroups ?? [],
  });

  return NextResponse.json(
    { rows, total: rows.length },
    { headers: { "cache-control": "no-store" } },
  );
}

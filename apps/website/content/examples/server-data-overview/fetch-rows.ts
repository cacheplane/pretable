import type {
  PretableMatchingTotal,
  PretableQueryFor,
  PretableSurfaceQueryColumns,
} from "@pretable/react";

export interface Order {
  id: string;
  customer: string;
  region: string;
  status: string;
  total: number;
  placedAt: string;
}

/**
 * The query the surface hands back, typed once and shared by everything that
 * touches it.
 *
 * Not `PretableQueryFor<typeof columns>`: these are plain `PretableColumn<Order>`
 * descriptors with no `accessor` field, and `PretableQueryFor` needs one to
 * resolve a filter to anything but `never`. `PretableSurfaceQueryColumns<Order>`
 * is the shape `<PretableSurface>` itself falls back to for accessor-less
 * columns, so this is the type the `query` / `onQueryChange` pair actually
 * speaks.
 */
export type OrderQuery = PretableQueryFor<PretableSurfaceQueryColumns<Order>>;

export interface RowsResponse {
  rows: Order[];
  total: PretableMatchingTotal;
  datasetKey: string;
}

/**
 * The whole of the client's job: send the query, receive rows plus a
 * description of them. The grid never does this — it has no idea a network
 * exists.
 */
export async function fetchRows(
  query: OrderQuery,
  options: { totalKind?: "exact" | "estimate" | "unknown" } = {},
): Promise<RowsResponse> {
  const response = await fetch("/api/docs/rows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, totalKind: options.totalKind ?? "exact" }),
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;

    throw new Error(problem?.message ?? "Order service unavailable");
  }

  return (await response.json()) as RowsResponse;
}

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
 * The query shape the surface speaks, typed once and shared by everything that
 * touches it.
 *
 * Not `PretableQueryFor<typeof columns>`: these are plain `PretableColumn<Order>`
 * descriptors with no `accessor` field, and `PretableQueryFor` needs one to
 * resolve a filter to anything but `never`. `PretableSurfaceQueryColumns<Order>`
 * is the shape `<PretableSurface>` itself falls back to for accessor-less
 * columns.
 */
export type OrderQuery = PretableQueryFor<PretableSurfaceQueryColumns<Order>>;

/** How sure the endpoint should claim to be about the count. */
export type TotalKind = "exact" | "estimate" | "unknown";

export interface RowsResponse {
  rows: Order[];
  total: PretableMatchingTotal;
  datasetKey: string;
}

/**
 * Sends the query and receives rows plus a description of them. Note what is
 * NOT sent: no `limit`, so every matching record comes back and the loaded
 * records really are the whole population — which is the only situation where
 * an exact total can honestly say so.
 */
export async function fetchRows(
  query: OrderQuery,
  options: { totalKind: TotalKind },
): Promise<RowsResponse> {
  const response = await fetch("/api/docs/rows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, totalKind: options.totalKind }),
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;

    throw new Error(problem?.message ?? "Order service unavailable");
  }

  return (await response.json()) as RowsResponse;
}

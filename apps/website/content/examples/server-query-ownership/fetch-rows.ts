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
 * The query the grid reports, typed once and shared by everything that touches
 * it.
 *
 * Not `PretableQueryFor<typeof columns>`: these are plain `PretableColumn<Order>`
 * descriptors with no `accessor` field, and `PretableQueryFor` needs one to
 * resolve a filter to anything but `never`. Both spellings compile, so nothing
 * would have told you — every filter would just be `never`.
 * `PretableSurfaceQueryColumns<Order>` is the shape the component itself falls
 * back to for accessor-less columns, so it is the type `onQueryChange` speaks.
 */
export type OrderQuery = PretableQueryFor<PretableSurfaceQueryColumns<Order>>;

export interface RowsResponse {
  rows: Order[];
  /**
   * How many records matched. This example never publishes it — with no
   * `resultMeta`, the grid counts the rows it holds — because notify-only is
   * the subject here. See the totals page for the honest version.
   */
  total: PretableMatchingTotal;
  datasetKey: string;
}

/**
 * The whole of the client's job: send the query, receive rows. The grid never
 * does this — it has no idea a network exists, which is why the query has to
 * reach you through a callback before anything can be fetched.
 */
export async function fetchRows(query: OrderQuery): Promise<RowsResponse> {
  const response = await fetch("/api/docs/rows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, totalKind: "exact" }),
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;

    throw new Error(problem?.message ?? "Order service unavailable");
  }

  return (await response.json()) as RowsResponse;
}

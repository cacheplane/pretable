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
 * The query the surface speaks, typed once.
 *
 * Not `PretableQueryFor<typeof columns>`: these are plain `PretableColumn<Order>`
 * descriptors with no `accessor` field, and `PretableQueryFor` needs one to
 * resolve a filter to anything but `never`. Both forms compile, so the wrong
 * one is a silent `never` rather than a type error.
 */
export type OrderQuery = PretableQueryFor<PretableSurfaceQueryColumns<Order>>;

/**
 * This grid's query never changes — see `columns.ts` for why it is the one
 * grid in this section with its funnels and header sorts switched off. One
 * population, held still, so the only thing moving is the window over it.
 */
export const EMPTY_QUERY: OrderQuery = { filters: [], sort: [], rowGroups: [] };

export interface WindowResponse {
  /** Dataset index of `rows[0]` — what `resultMeta.window.start` publishes. */
  start: number;
  rows: Order[];
  total: PretableMatchingTotal;
  /** Whether anything follows this window. Not how much. */
  hasMore: boolean;
}

interface RawResponse {
  rows: Order[];
  total: PretableMatchingTotal;
}

/**
 * One block of `limit` records beginning at dataset index `start`.
 *
 * The response describes the population (`total`) and the client already knows
 * where it asked from, so both halves of `resultMeta.window` are things this
 * layer holds before the grid ever sees them. `hasMore` is derived from the
 * exact count here; against a keyset cursor it would be whatever the cursor
 * says about a next page, which is why the field promises existence rather
 * than a remaining count.
 */
export async function fetchWindow(
  start: number,
  limit: number,
): Promise<WindowResponse> {
  const response = await fetch("/api/docs/rows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: EMPTY_QUERY,
      offset: start,
      limit,
      totalKind: "exact",
    }),
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;

    throw new Error(problem?.message ?? "Order service unavailable");
  }

  const { rows, total } = (await response.json()) as RawResponse;

  return {
    start,
    rows,
    total,
    hasMore:
      total.kind === "exact"
        ? start + rows.length < total.count
        : rows.length === limit,
  };
}

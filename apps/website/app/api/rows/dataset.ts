export interface ServerRow extends Record<string, unknown> {
  id: string;
  region: string;
  rep: string;
  amount: number;
}

/** Deliberately small and low-cardinality: three regions, four reps. */
export const SERVER_ROWS: ServerRow[] = [
  { id: "s1", region: "East", rep: "Ada", amount: 120 },
  { id: "s2", region: "East", rep: "Brin", amount: 340 },
  { id: "s3", region: "East", rep: "Cyd", amount: 55 },
  { id: "s4", region: "North", rep: "Ada", amount: 900 },
  { id: "s5", region: "North", rep: "Dara", amount: 210 },
  { id: "s6", region: "West", rep: "Brin", amount: 75 },
  { id: "s7", region: "West", rep: "Cyd", amount: 480 },
  { id: "s8", region: "West", rep: "Dara", amount: 260 },
];

/**
 * The wire shape of a query, as it arrives over JSON.
 *
 * Structurally looser than `PretableQueryFor<TColumns>`: the arrays are
 * readonly and the entries carry only what this handler reads, so the grid's
 * own query — which also carries `nulls`, and `direction` on row groups —
 * assigns to it without a cast. `operator` and `value` are widened because a
 * request body is untrusted input, not a typed value.
 */
export interface ServerQuery {
  filters: readonly { columnId: string; operator: string; value?: unknown }[];
  sort: readonly { columnId: string; direction: "asc" | "desc" }[];
  rowGroups: readonly { columnId: string }[];
}

/**
 * The "server". Applies the query to its own rows and returns the result.
 *
 * Read this before trusting any screen assertion built on it: the fixture is in
 * controlled mode, which means the grid does not apply a query *transition*
 * itself — it reports intent and waits for the consumer to hand back the next
 * `query`. It does still apply whatever `query` prop it is holding to whatever
 * `rows` prop it is holding. So when the fixture feeds it both the new query
 * and the server's rows, the engine sorts and filters the server's answer a
 * second time, and the two applications agree.
 *
 * The consequence is sharp: if this function returned rows in a random order,
 * the grid would still show them correctly sorted, and a test that only looks
 * at the screen would still pass. That is why the fixture publishes the
 * server's answer verbatim (`data-server-row-ids`) and the e2e asserts on it
 * and on the outgoing request bodies rather than on the rendered order alone.
 */
export function applyServerQuery(
  rows: readonly ServerRow[],
  query: ServerQuery,
): ServerRow[] {
  let out = [...rows];

  for (const filter of query.filters) {
    const { columnId, operator, value } = filter;
    if (operator === "isAnyOf" && Array.isArray(value)) {
      out = out.filter((row) => value.includes(row[columnId]));
    } else if (operator === "contains" && typeof value === "string") {
      out = out.filter((row) =>
        String(row[columnId]).toLowerCase().includes(value.toLowerCase()),
      );
    } else if (operator === "gte" && typeof value === "number") {
      out = out.filter((row) => Number(row[columnId]) >= value);
    }
  }

  for (const entry of [...query.sort].reverse()) {
    const { columnId, direction } = entry;
    out.sort((left, right) => {
      const a = left[columnId];
      const b = right[columnId];
      const cmp =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b));
      return direction === "desc" ? -cmp : cmp;
    });
  }

  // Grouping is expressed as ordering here: rows arrive already clustered by
  // the group key, which is what a server that cannot send tree structure does.
  for (const group of [...query.rowGroups].reverse()) {
    out.sort((left, right) =>
      String(left[group.columnId]).localeCompare(String(right[group.columnId])),
    );
  }

  return out;
}

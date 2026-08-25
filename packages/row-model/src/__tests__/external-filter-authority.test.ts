import { describe, expect, test } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  createLocalRowModel,
  ɵsetLocalRowModelFilterAuthority,
  type PretableQueryFor,
} from "../index";
import { filterVerdict } from "../compiled-query";

interface Holding {
  id: string;
  sector: string;
  customer: string;
  quantity: number;
}

const helper = createColumnHelper<Holding>();
const columns = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("customer", { type: "text" }),
  helper.accessor("quantity", { type: "number", aggregate: "sum" }),
] as const;

/** The window the caller was handed; only `c` and `d` answer the filter. */
const rows: Holding[] = [
  { id: "a", sector: "Tech", customer: "Contoso", quantity: 10 },
  { id: "b", sector: "Tech", customer: "Fabrikam", quantity: 20 },
  { id: "c", sector: "Energy", customer: "Northwind Retail", quantity: 30 },
  { id: "d", sector: "Energy", customer: "Northwind Trade", quantity: 40 },
];

/**
 * Checks a query literal against a column tuple, exactly as
 * `compiled-query.test.ts` does. `PretableQueryFor<TColumns>` is not an
 * inference site — `compileQuery`'s `TColumns` cannot be recovered from a bare
 * object literal, and it collapses to `readonly [unknown, unknown, unknown]`,
 * which makes every filter `never`. Naming the tuple once here keeps the
 * column ids and operators genuinely checked instead.
 */
function queryFor<TColumns>(
  value: PretableQueryFor<TColumns>,
): PretableQueryFor<TColumns> {
  return value;
}

const NORTHWIND = queryFor<typeof columns>({
  filters: [{ columnId: "customer", operator: "contains", value: "Northwind" }],
  sort: [],
  rowGroups: [],
});

function visibleRowIds(model: {
  getState: () => {
    snapshot: {
      range: (
        start: number,
        end: number,
      ) => readonly { kind: string; rowId?: string }[];
    };
  };
}): string[] {
  return model
    .getState()
    .snapshot.range(0, 100)
    .flatMap((row) => (row.kind === "data" ? [row.rowId as string] : []));
}

describe("external filter authority", () => {
  test("suppresses the engine's application of query.filters", () => {
    const model = createLocalRowModel({
      rows,
      columns,
      query: NORTHWIND,
      ɵfilterAuthority: "external",
    });
    expect(visibleRowIds(model)).toEqual(["a", "b", "c", "d"]);
  });

  test("still applies them under the default engine authority", () => {
    const model = createLocalRowModel({ rows, columns, query: NORTHWIND });
    expect(visibleRowIds(model)).toEqual(["c", "d"]);
  });

  test("reports the filters it stopped applying", () => {
    const model = createLocalRowModel({
      rows,
      columns,
      query: NORTHWIND,
      ɵfilterAuthority: "external",
    });
    const engine = createLocalRowModel({ rows, columns, query: NORTHWIND });
    expect(model.getState().snapshot.query).toEqual(
      engine.getState().snapshot.query,
    );
    expect(model.getState().snapshot.query.filters).toEqual([
      { columnId: "customer", operator: "contains", value: "Northwind" },
    ]);
  });

  test("still rejects a filter the reported query could not name", () => {
    expect(() =>
      createLocalRowModel({
        rows,
        columns,
        query: {
          filters: [
            // @ts-expect-error unknown columns are rejected — the point is that
            // suppression does not stop the reported query being validated.
            { columnId: "missing", operator: "contains", value: "x" },
          ],
          sort: [],
          rowGroups: [],
        },
        ɵfilterAuthority: "external",
      }),
    ).toThrow(/missing/);
  });

  test("folds every loaded row into group aggregates, not the filtered set", () => {
    const grouped = (authority: "engine" | "external") =>
      createLocalRowModel({
        rows,
        columns,
        aggregateFilteredRows: true,
        initialExpansion: { kind: "expanded" },
        query: {
          filters: NORTHWIND.filters,
          sort: [],
          rowGroups: [{ columnId: "sector", direction: "asc" }],
        },
        ɵfilterAuthority: authority,
      });
    const totals = (model: ReturnType<typeof grouped>) =>
      model
        .getState()
        .snapshot.range(0, 100)
        .flatMap((row) =>
          row.kind === "group"
            ? [[String(row.value), row.aggregates.quantity] as const]
            : [],
        );

    // Deliberate behaviour change: `a` and `b` fail the filter, so today's
    // engine leaves Tech with no aggregated rows at all. Under external
    // authority the server chose these records, so all four fold.
    expect(totals(grouped("engine"))).toEqual([["Energy", 70]]);
    expect(totals(grouped("external"))).toEqual([
      ["Energy", 70],
      ["Tech", 30],
    ]);
  });

  test("recompiles rather than reusing the plan when authority flips", async () => {
    const model = createLocalRowModel({ rows, columns, query: NORTHWIND });
    expect(visibleRowIds(model)).toEqual(["c", "d"]);

    ɵsetLocalRowModelFilterAuthority(model, "external");
    await model.setQuery(NORTHWIND).finished;
    expect(visibleRowIds(model)).toEqual(["a", "b", "c", "d"]);
    expect(model.getState().snapshot.query.filters).toEqual([
      { columnId: "customer", operator: "contains", value: "Northwind" },
    ]);

    ɵsetLocalRowModelFilterAuthority(model, "engine");
    await model.setQuery(NORTHWIND).finished;
    expect(visibleRowIds(model)).toEqual(["c", "d"]);
  });

  test("keeps setQuery a semantic no-op when authority has not moved", () => {
    const model = createLocalRowModel({
      rows,
      columns,
      query: NORTHWIND,
      ɵfilterAuthority: "external",
    });
    const before = model.getState().snapshot;
    model.setQuery({
      filters: [
        { columnId: "customer", operator: "contains", value: "Northwind" },
      ],
      sort: [],
      rowGroups: [],
    });
    expect(model.getState().snapshot).toBe(before);
  });
});

describe("compileQuery filter authority", () => {
  const derivations = columns;

  test("publishes the filters while evaluating every row as passing", () => {
    const plan = compileQuery<typeof columns>({
      derivations,
      query: NORTHWIND,
      filterAuthority: "external",
    });
    expect(plan.query.filters).toEqual([
      { columnId: "customer", operator: "contains", value: "Northwind" },
    ]);
    expect(
      rows.map((row, index) =>
        filterVerdict(plan, {
          row,
          rowId: row.id,
          sourceOrder: index,
          slot: index,
        }),
      ),
    ).toEqual([true, true, true, true]);
  });

  test("refuses to reuse a plan compiled under the other authority", () => {
    const engine = compileQuery<typeof columns>({
      derivations,
      query: NORTHWIND,
    });
    const reused = compileQuery<typeof columns>({
      derivations,
      query: NORTHWIND,
      previous: engine,
    });
    const flipped = compileQuery<typeof columns>({
      derivations,
      query: NORTHWIND,
      previous: engine,
      filterAuthority: "external",
    });
    expect(reused).toBe(engine);
    expect(flipped).not.toBe(engine);
  });

  test("still reuses a suppressed plan when only the filter order changes", () => {
    const query = queryFor<typeof columns>({
      filters: [
        { columnId: "customer", operator: "contains", value: "Northwind" },
        { columnId: "sector", operator: "contains", value: "e" },
      ],
      sort: [],
      rowGroups: [],
    });
    const plan = compileQuery<typeof columns>({
      derivations,
      query,
      filterAuthority: "external",
    });
    const reordered = compileQuery<typeof columns>({
      derivations,
      query: queryFor<typeof columns>({
        ...query,
        filters: [query.filters[1], query.filters[0]],
      }),
      previous: plan,
      filterAuthority: "external",
    });
    expect(reordered).toBe(plan);
  });

  test("rejects an authority it does not recognise", () => {
    expect(() =>
      compileQuery<typeof columns>({
        derivations,
        query: NORTHWIND,
        // @ts-expect-error — the runtime guard is the thing under test, and
        // the type system is what keeps a well-typed caller away from it.
        filterAuthority: "server",
      }),
    ).toThrow(/filterAuthority/);
  });
});

import { describe, expect, test } from "vitest";

import {
  CompiledQueryValidationError,
  compileQuery,
  createColumnHelper,
  getCapturedFilterTreeForTesting,
  isPretableFilterGroup,
  type PretableQueryFor,
} from "../index";

interface Holding {
  id: number;
  sector: string | null;
  quantity: number | null;
  asOf: Date;
  status: "open" | "closed";
}

const column = createColumnHelper<Holding>();
const columns = [
  column.accessor("sector", { type: "text" }),
  column.accessor("quantity", { type: "number" }),
  column.accessor("asOf", { type: "date" }),
  column.accessor("status", { type: "enum" }),
] as const;

type Columns = typeof columns;
type Node = PretableQueryFor<Columns>["filters"][number];

function queryFor(value: PretableQueryFor<Columns>): PretableQueryFor<Columns> {
  return value;
}

function compile(query: unknown) {
  return compileQuery<Columns>({
    derivations: columns,
    query,
  } as never);
}

function recompile(query: unknown, previous: unknown) {
  return compileQuery<Columns>({
    derivations: columns,
    query,
    previous,
  } as never);
}

function caughtFrom(query: unknown): unknown {
  try {
    compile(query);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("isPretableFilterGroup", () => {
  test("accepts both join operators, including an empty group", () => {
    expect(isPretableFilterGroup<Columns>({ op: "and", children: [] })).toBe(
      true,
    );
    expect(
      isPretableFilterGroup<Columns>({
        op: "or",
        children: [{ columnId: "sector", operator: "isEmpty" }],
      }),
    ).toBe(true);
  });

  test.each([
    ["text", { columnId: "sector", operator: "contains", value: "x" }],
    [
      "number range",
      { columnId: "quantity", operator: "between", value: [1, 2] },
    ],
    ["date", { columnId: "asOf", operator: "on", value: "2026-01-01" }],
    ["enum set", { columnId: "status", operator: "isAnyOf", value: ["open"] }],
    ["valueless", { columnId: "sector", operator: "isEmpty" }],
  ] as const)("rejects a %s leaf", (_family, leaf) => {
    expect(isPretableFilterGroup<Columns>(leaf as Node)).toBe(false);
  });

  test("fails closed on shapes that are neither", () => {
    for (const shape of [
      null,
      undefined,
      "and",
      42,
      {},
      { op: "and" },
      { children: [] },
      { op: "nor", children: [] },
      { op: "AND", children: [] },
    ]) {
      expect(isPretableFilterGroup<Columns>(shape as never)).toBe(false);
    }
  });
});

describe("capture of a filter tree", () => {
  test("round-trips a nested group into the compiled query", () => {
    const plan = compile(
      queryFor({
        filters: [
          { columnId: "quantity", operator: "gte", value: 4 },
          {
            op: "or",
            children: [
              { columnId: "sector", operator: "contains", value: "tech" },
              {
                op: "and",
                children: [
                  { columnId: "status", operator: "isAnyOf", value: ["open"] },
                  { columnId: "sector", operator: "isNotEmpty" },
                ],
              },
            ],
          },
        ],
        sort: [],
        rowGroups: [],
      }),
    );

    expect(plan.query.filters).toHaveLength(2);
    const group = plan.query.filters[1];
    expect(isPretableFilterGroup<Columns>(group)).toBe(true);
    if (!isPretableFilterGroup<Columns>(group)) throw new Error("unreachable");
    expect(group.op).toBe("or");
    expect(group.children).toHaveLength(2);
    expect(group.children[0]).toMatchObject({
      columnId: "sector",
      operator: "contains",
      value: "tech",
    });
    const nested = group.children[1];
    if (!isPretableFilterGroup<Columns>(nested)) throw new Error("unreachable");
    expect(nested.op).toBe("and");
    expect(nested.children[0]).toMatchObject({
      columnId: "status",
      operator: "isAnyOf",
      value: ["open"],
    });
  });

  test("rejects an unknown join operator at its own path", () => {
    const caught = caughtFrom({
      filters: [
        { columnId: "quantity", operator: "gte", value: 4 },
        { op: "xor", children: [] },
      ],
      sort: [],
      rowGroups: [],
    });

    expect(caught).toBeInstanceOf(CompiledQueryValidationError);
    expect(caught).toMatchObject({
      code: "invalid-query",
      path: "query.filters[1].op",
    });
  });

  test("rejects a group whose children are not an array at its own path", () => {
    const caught = caughtFrom({
      filters: [{ op: "and", children: { length: 0 } }],
      sort: [],
      rowGroups: [],
    });

    expect(caught).toBeInstanceOf(CompiledQueryValidationError);
    expect(caught).toMatchObject({
      code: "invalid-query",
      path: "query.filters[0].children",
    });
  });

  test("reports a nested failure with its full breadcrumb", () => {
    const caught = caughtFrom({
      filters: [
        {
          op: "and",
          children: [
            { columnId: "sector", operator: "isEmpty" },
            { op: "and", children: [{ op: "nope", children: [] }] },
          ],
        },
      ],
      sort: [],
      rowGroups: [],
    });

    expect(caught).toBeInstanceOf(CompiledQueryValidationError);
    expect(caught).toMatchObject({
      path: "query.filters[0].children[1].children[0].op",
    });
  });

  test("deep-freezes every level of the tree it captured", () => {
    const plan = compile(
      queryFor({
        filters: [
          {
            op: "and",
            children: [
              {
                op: "or",
                children: [{ columnId: "sector", operator: "isEmpty" }],
              },
            ],
          },
        ],
        sort: [],
        rowGroups: [],
      }),
    );

    // Deliberately NOT `plan.query`: that getter re-freezes everything it
    // hands back, so it proves `snapshotQuery` froze a copy and says nothing
    // about capture. This reads the plan's own captured tree.
    const captured = getCapturedFilterTreeForTesting(plan) as readonly Node[];
    const outer = captured[0];
    if (!isPretableFilterGroup<Columns>(outer)) throw new Error("unreachable");
    const inner = outer.children[0];
    if (!isPretableFilterGroup<Columns>(inner)) throw new Error("unreachable");
    const leaf = inner.children[0];

    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(outer)).toBe(true);
    expect(Object.isFrozen(outer.children)).toBe(true);
    expect(Object.isFrozen(inner)).toBe(true);
    expect(Object.isFrozen(inner.children)).toBe(true);
    expect(Object.isFrozen(leaf)).toBe(true);
    expect(() => {
      (outer as { op: string }).op = "or";
    }).toThrow(TypeError);
    expect(() => {
      (inner as { op: string }).op = "and";
    }).toThrow(TypeError);
    expect(() => {
      (leaf as { columnId: string }).columnId = "quantity";
    }).toThrow(TypeError);
  });

  test("re-freezes every level of the tree it publishes", () => {
    const plan = compile(
      queryFor({
        filters: [
          {
            op: "and",
            children: [
              {
                op: "or",
                children: [{ columnId: "sector", operator: "isEmpty" }],
              },
            ],
          },
        ],
        sort: [],
        rowGroups: [],
      }),
    );

    const outer = plan.query.filters[0];
    if (!isPretableFilterGroup<Columns>(outer)) throw new Error("unreachable");
    const inner = outer.children[0];
    if (!isPretableFilterGroup<Columns>(inner)) throw new Error("unreachable");

    expect(Object.isFrozen(outer)).toBe(true);
    expect(Object.isFrozen(inner)).toBe(true);
    expect(Object.isFrozen(inner.children[0])).toBe(true);
    expect(() => {
      (inner as { op: string }).op = "and";
    }).toThrow(TypeError);
  });

  test("copies the incoming tree rather than retaining it", () => {
    const child = { columnId: "sector", operator: "isEmpty" };
    const group = { op: "and", children: [child] };
    const plan = compile({ filters: [group], sort: [], rowGroups: [] });

    const captured = plan.query.filters[0];
    expect(captured).not.toBe(group);
    if (!isPretableFilterGroup<Columns>(captured))
      throw new Error("unreachable");
    expect(captured.children[0]).not.toBe(child);
  });

  test("still accepts an array of plain leaves", () => {
    const plan = compile(
      queryFor({
        filters: [
          { columnId: "quantity", operator: "gte", value: 4 },
          { columnId: "sector", operator: "contains", value: "tech" },
        ],
        sort: [],
        rowGroups: [],
      }),
    );
    expect(plan.query.filters).toHaveLength(2);
    expect(
      plan.query.filters.every((node) => !isPretableFilterGroup(node)),
    ).toBe(true);
  });
});

describe("group identity", () => {
  const groupOf = (children: readonly unknown[]) => ({
    op: "and",
    children,
  });
  const containing = (value: string) => ({
    columnId: "sector",
    operator: "contains",
    value,
  });
  const queryOf = (children: readonly unknown[]) => ({
    filters: [groupOf(children)],
    sort: [],
    rowGroups: [],
  });

  test("rebuilds when a group child's value changes", () => {
    const first = compile(queryOf([containing("a"), containing("b")]));
    expect(recompile(queryOf([containing("a"), containing("b")]), first)).toBe(
      first,
    );
    expect(
      recompile(queryOf([containing("a"), containing("c")]), first),
    ).not.toBe(first);
  });

  test("reuses a plan when a group's children are merely reordered", () => {
    const first = compile(queryOf([containing("a"), containing("b")]));
    expect(recompile(queryOf([containing("b"), containing("a")]), first)).toBe(
      first,
    );
  });

  test("a child value cannot forge a sibling and impersonate a larger group", () => {
    // Built against the concatenated descriptor key: a leaf keys as
    // `columnId\0operator\0string:<value>` and a group joins its children
    // with \u0001, none of it length-framed. This single operand reproduces
    // the two-child key above byte for byte.
    const forged = containing("a\u0001sector\u0000contains\u0000string:b");
    const first = compile(queryOf([containing("a"), containing("b")]));

    expect(recompile(queryOf([forged]), first)).not.toBe(first);
  });

  test("distinguishes groups that differ only in their join operator", () => {
    const children = [containing("a"), containing("b")];
    const first = compile({
      filters: [{ op: "and", children }],
      sort: [],
      rowGroups: [],
    });
    expect(
      recompile(
        { filters: [{ op: "or", children }], sort: [], rowGroups: [] },
        first,
      ),
    ).not.toBe(first);
  });

  test("recurses into nested groups rather than stopping at the top", () => {
    const nested = (value: string) => ({
      filters: [
        {
          op: "and",
          children: [
            containing("a"),
            { op: "or", children: [containing(value)] },
          ],
        },
      ],
      sort: [],
      rowGroups: [],
    });
    const first = compile(nested("deep"));
    expect(recompile(nested("deep"), first)).toBe(first);
    expect(recompile(nested("deeper"), first)).not.toBe(first);
  });

  test("never matches a group against a leaf", () => {
    const first = compile(queryOf([containing("a")]));
    expect(
      recompile({ filters: [containing("a")], sort: [], rowGroups: [] }, first),
    ).not.toBe(first);
  });
});

import { describe, expect, test } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  createLocalRowModel,
  mergeColumnAggregateOverrides,
  type PretableAggregator,
  type PretableGroupId,
  type PretableQueryFor,
} from "../index";

interface Row {
  id: number;
  region: string;
  score: number;
}

const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("region", { type: "text" }),
  helper.accessor("score", { type: "number", aggregate: "sum" }),
] as const;

// Two rows per group, so `sum` (3) and `count` (2) disagree for West: an
// implementation that ignored the override would read 3 where the test
// demands 2.
const rows = [
  { id: 1, region: "West", score: 1 },
  { id: 2, region: "West", score: 2 },
  { id: 3, region: "East", score: 4 },
];
const west = "__group__:region=s:West" as PretableGroupId;

function groupedQuery(): PretableQueryFor<typeof columns> {
  return {
    filters: [],
    sort: [],
    rowGroups: [{ columnId: "region" }],
  } as PretableQueryFor<typeof columns>;
}

function scoreOfWest(model: ReturnType<typeof groupedModel>): unknown {
  const row = model
    .getState()
    .snapshot.range(0, 20)
    .find((entry) => entry.kind === "group" && entry.groupId === west);
  if (row?.kind !== "group") throw new Error("missing West group row");
  return row.aggregates.score;
}

function groupedModel() {
  return createLocalRowModel({
    rows,
    columns,
    query: groupedQuery(),
  });
}

describe("mergeColumnAggregateOverrides", () => {
  test("is total and order-preserving", () => {
    const merged = mergeColumnAggregateOverrides(columns, {
      score: "count",
    });

    expect(merged).toHaveLength(columns.length);
    expect(merged.map((column) => column.id)).toEqual(["region", "score"]);
  });

  test("returns the SAME array when no override applies", () => {
    // React memoises on this identity; a fresh array per render would defeat
    // the plan-reuse gate downstream.
    expect(mergeColumnAggregateOverrides(columns, {})).toBe(columns);
    expect(mergeColumnAggregateOverrides(columns, { missing: "count" })).toBe(
      columns,
    );
  });

  test("an override replaces a declared aggregate", () => {
    const merged = mergeColumnAggregateOverrides(columns, { score: "count" });

    expect(merged[1].aggregate).toBe("count");
    expect(merged[1].id).toBe("score");
    expect(merged[1].accessor).toBe(columns[1].accessor);
    expect(merged[0]).toBe(columns[0]);
    // The caller's array is never mutated.
    expect(columns[1].aggregate).toBe("sum");
  });

  test("an override applies to a column that declared none", () => {
    const merged = mergeColumnAggregateOverrides(columns, { region: "count" });

    expect(merged[0].aggregate).toBe("count");
    expect(merged[1]).toBe(columns[1]);
  });

  test("an override for an unknown id is ignored, not appended", () => {
    const merged = mergeColumnAggregateOverrides(columns, {
      score: "count",
      ghost: "sum",
    });

    expect(merged).toHaveLength(2);
    expect(merged.map((column) => column.id)).toEqual(["region", "score"]);
  });

  test("an override restating the declared value returns the SAME array", () => {
    // The tool panel writes this whenever a user picks the aggregate a column
    // already declares. Producing a fresh array here would make every render
    // look like a derivation change to react's identity gate, and each of
    // those costs two compileQuery calls before concluding no-op.
    const merged = mergeColumnAggregateOverrides(columns, { score: "sum" });

    expect(merged).toBe(columns);
    expect(merged[1]).toBe(columns[1]);
  });

  test("null strips a declared aggregate", () => {
    const merged = mergeColumnAggregateOverrides(columns, { score: null });

    expect("aggregate" in merged[1]).toBe(false);
    expect(merged[1].id).toBe("score");
    expect(merged[1].accessor).toBe(columns[1].accessor);
    expect(merged[0]).toBe(columns[0]);
    // The caller's array is never mutated.
    expect(columns[1].aggregate).toBe("sum");
  });

  test("null on a column that declares no aggregate returns the SAME array", () => {
    // The tool panel writes `null` whenever a user picks `None`, including on
    // a column whose prop already declares nothing; that must stay invisible
    // to react's identity gate.
    expect(mergeColumnAggregateOverrides(columns, { region: null })).toBe(
      columns,
    );
  });

  test("null on an own `aggregate: undefined` key returns the SAME array", () => {
    // createColumnHelper's `...options` spread can produce this shape. Every
    // consumer reads the aggregate VALUE, never key presence, so stripping
    // the key would churn identity over a semantic no-op.
    const explicit = [
      { id: "region", type: "text", aggregate: undefined },
      { id: "score", type: "number", aggregate: "sum" },
    ] as const;

    expect(mergeColumnAggregateOverrides(explicit, { region: null })).toBe(
      explicit,
    );
  });

  test("undefined still means no override, even alongside null", () => {
    const merged = mergeColumnAggregateOverrides(columns, {
      score: undefined,
      region: null,
    });

    expect(merged).toBe(columns);
    expect(merged[1].aggregate).toBe("sum");
  });

  test("a key carrying undefined is no override, and never deletes a declared one", () => {
    // grid-core strips a cleared key rather than storing `undefined`, but this
    // function is public API and a consumer can pass one. `undefined` must
    // stay "no override" — treating it as a value would DELETE the declared
    // aggregate, the exact inversion of the override contract.
    const merged = mergeColumnAggregateOverrides(columns, { score: undefined });

    expect(merged).toBe(columns);
    expect(merged[1].aggregate).toBe("sum");
  });
});

describe("aggregate overrides through the row model", () => {
  test("an override changes the computed group aggregate, and clearing restores it", async () => {
    const model = groupedModel();
    expect(scoreOfWest(model)).toBe(3);

    const overridden = model.setDerivations(
      mergeColumnAggregateOverrides(columns, { score: "count" }),
    );
    await expect(overridden.finished).resolves.toBeTypeOf("number");
    expect(scoreOfWest(model)).toBe(2);

    const cleared = model.setDerivations(
      mergeColumnAggregateOverrides(columns, {}),
    );
    await expect(cleared.finished).resolves.toBeTypeOf("number");
    expect(scoreOfWest(model)).toBe(3);
  });

  test("a null override removes the computed group aggregate, and clearing restores it", async () => {
    const model = groupedModel();
    expect(scoreOfWest(model)).toBe(3);

    const stripped = model.setDerivations(
      mergeColumnAggregateOverrides(columns, { score: null }),
    );
    await expect(stripped.finished).resolves.toBeTypeOf("number");
    // Absent the way an undeclared aggregate is — no key at all, not 0 or "".
    const westRow = model
      .getState()
      .snapshot.range(0, 20)
      .find((entry) => entry.kind === "group" && entry.groupId === west);
    if (westRow?.kind !== "group") throw new Error("missing West group row");
    expect(Object.hasOwn(westRow.aggregates, "score")).toBe(false);

    const cleared = model.setDerivations(
      mergeColumnAggregateOverrides(columns, {}),
    );
    await expect(cleared.finished).resolves.toBeTypeOf("number");
    expect(scoreOfWest(model)).toBe(3);
  });

  test("plan reuse: stripping a declared aggregate IS a change, both directions", () => {
    const query = groupedQuery();
    const base = compileQuery<typeof columns>({
      derivations: mergeColumnAggregateOverrides(columns, {}),
      query,
    });

    const stripped = compileQuery<typeof columns>({
      derivations: mergeColumnAggregateOverrides(columns, { score: null }),
      query,
      previous: base,
    });
    expect(stripped).not.toBe(base);

    const restated = compileQuery<typeof columns>({
      derivations: mergeColumnAggregateOverrides(columns, { score: null }),
      query,
      previous: stripped,
    });
    expect(restated).toBe(stripped);

    const back = compileQuery<typeof columns>({
      derivations: mergeColumnAggregateOverrides(columns, {}),
      query,
      previous: restated,
    });
    expect(back).not.toBe(restated);
  });

  test("plan reuse: a changed override recompiles, an unchanged one reuses", () => {
    const query = groupedQuery();
    const base = compileQuery<typeof columns>({
      derivations: mergeColumnAggregateOverrides(columns, {}),
      query,
    });

    const changed = compileQuery<typeof columns>({
      derivations: mergeColumnAggregateOverrides(columns, { score: "count" }),
      query,
      previous: base,
    });
    expect(changed).not.toBe(base);

    const restated = compileQuery<typeof columns>({
      derivations: mergeColumnAggregateOverrides(columns, { score: "count" }),
      query,
      previous: changed,
    });
    expect(restated).toBe(changed);

    const back = compileQuery<typeof columns>({
      derivations: mergeColumnAggregateOverrides(columns, {}),
      query,
      previous: restated,
    });
    expect(back).not.toBe(restated);
  });

  test("an overridden object aggregator is captured and frozen exactly as a declared one", () => {
    const mutable = {
      init: () => [] as readonly string[],
      accumulate: (accumulator: readonly string[], value: string) => [
        ...accumulator,
        value,
      ],
      merge: (left: readonly string[], right: readonly string[]) => [
        ...left,
        ...right,
      ],
      finalize: (accumulator: readonly string[]) => accumulator.join("|"),
      option: { label: "stable" },
    } as unknown as PretableAggregator<Row, string, readonly string[], string>;

    const declared = [
      helper.accessor("region", { type: "text", aggregate: mutable }),
      columns[1],
    ] as const;
    const overridden = mergeColumnAggregateOverrides(columns, {
      region: mutable,
    });

    const declaredPlan = compileQuery<typeof declared>({
      derivations: declared,
      query: groupedQuery() as PretableQueryFor<typeof declared>,
    });
    const overriddenPlan = compileQuery<typeof columns>({
      derivations: overridden,
      query: groupedQuery(),
    });
    const input = { rowId: 1, row: rows[0], sourceOrder: 0, slot: 0 } as const;
    const declaredLeaf = declaredPlan
      .evaluate(input)
      .aggregateLeaves.find((leaf) => leaf.columnId === "region");
    // Widened because the merged list's TYPE still says only `score`
    // aggregates; see the JSDoc on `mergeColumnAggregateOverrides`.
    const overriddenLeaf = overriddenPlan
      .evaluate(input)
      .aggregateLeaves.find((leaf) => (leaf.columnId as string) === "region");
    if (!declaredLeaf || !overriddenLeaf)
      throw new Error("missing region aggregate leaf");

    (
      mutable as unknown as { finalize: (value: readonly string[]) => string }
    ).finalize = () => "mutated";

    for (const leaf of [declaredLeaf, overriddenLeaf]) {
      const captured = leaf.aggregate as unknown as {
        finalize: (value: readonly string[]) => string;
        option: { label: string };
      };
      expect(captured).not.toBe(mutable);
      expect(Object.isFrozen(captured)).toBe(true);
      expect(captured.finalize(["a", "b"])).toBe("a|b");
      expect(captured.option).toEqual({ label: "stable" });
      expect(Object.isFrozen(captured.option)).toBe(true);
    }
  });
});

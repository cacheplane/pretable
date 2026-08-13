import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableGroupId,
} from "../index";
import type { PretableRowModelOperation } from "../errors";
import {
  setGroupOverride,
  type GroupIndexRoot,
  type GroupNode,
} from "../group-index";
import { createPersistentMap } from "../persistent/persistent-map";

interface Row {
  id: number;
  region: string;
  team: string;
  score: number;
}
const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("region", { type: "text" }),
  helper.accessor("team", { type: "text" }),
  helper.accessor("score", { type: "number", aggregate: "sum" }),
] as const;
const rows = [
  { id: 1, region: "West", team: "A", score: 1 },
  { id: 2, region: "West", team: "B", score: 2 },
  { id: 3, region: "East", team: "A", score: 3 },
];
const west = "__group__:region=s:West" as PretableGroupId;
const westA = "__group__:region=s:West/team=s:A" as PretableGroupId;

function model(
  initialExpansion?:
    | { readonly kind: "collapsed" | "expanded" }
    | { readonly kind: "through-depth"; readonly depth: number },
) {
  return createLocalRowModel({
    rows,
    columns,
    initialExpansion,
    query: {
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "region" }, { columnId: "team" }],
    },
  });
}

describe("group expansion policies", () => {
  test("defaults expanded and treats through-depth as inclusive and zero-based", () => {
    // Grouping is an interactive act here — the user drags a column into the
    // group panel while reading their rows — so the default keeps those rows on
    // screen. 2 region groups + 3 team groups + 3 data rows.
    const defaulted = model().getState().snapshot;
    expect(defaulted.visibleRowCount).toBe(8);
    expect(defaulted.visibleDataRowCount).toBe(rows.length);
    expect(defaulted.expansion.default).toEqual({ kind: "expanded" });
    expect(
      model({ kind: "collapsed" }).getState().snapshot.visibleRowCount,
    ).toBe(2);
    const through = model({ kind: "through-depth", depth: 0 }).getState()
      .snapshot;
    expect(
      through
        .range(0, 20)
        .flatMap((row) =>
          row.kind === "group" && row.depth === 0 ? [row.expanded] : [],
        )
        .every(Boolean),
    ).toBe(true);
    expect(
      through
        .range(0, 20)
        .flatMap((row) =>
          row.kind === "group" && row.depth === 1 ? [row.expanded] : [],
        )
        .every((expanded) => !expanded),
    ).toBe(true);
    expect(through.visibleDataRowCount).toBe(0);
  });

  test("stores sparse overrides and removes an override equal to the default", () => {
    // Explicitly collapsed: this is about override storage relative to A
    // default, so it must not silently inherit whichever one ships.
    const grouped = model({ kind: "collapsed" });
    const first = grouped.setGroupExpanded(west, true);
    expect(first.revision).toBe(1);
    expect(grouped.getState().snapshot.expansion.overrideCount).toBe(1);
    expect(grouped.getState().snapshot.isGroupExpanded(west)).toBe(true);
    const second = grouped.setGroupExpanded(west, false);
    expect(second.revision).toBe(2);
    expect(grouped.getState().snapshot.expansion.overrideCount).toBe(0);
  });

  test("returns a structured no-op issue for an unknown group", () => {
    const grouped = model();
    const unknown = "__group__:region=s:Missing" as PretableGroupId;
    const before = grouped.getState();
    expect(grouped.setGroupExpanded(unknown, true)).toMatchObject({
      previousRevision: 0,
      revision: 0,
      ignored: 1,
      issues: [{ code: "unknown-group-id", groupId: unknown }],
    });
    expect(grouped.getState()).toBe(before);
  });

  test("applies default changes to future groups and clears or preserves overrides", () => {
    const grouped = model({ kind: "collapsed" });
    grouped.setGroupExpanded(west, true);
    grouped.setExpansionDefault(
      { kind: "expanded" },
      { preserveOverrides: true },
    );
    expect(grouped.getState().snapshot.expansion.overrideCount).toBe(1);
    grouped.applyTransaction({
      add: [{ id: 4, region: "North", team: "N", score: 4 }],
    });
    const north = "__group__:region=s:North" as PretableGroupId;
    expect(grouped.getState().snapshot.isGroupExpanded(north)).toBe(true);
    grouped.setExpansionDefault({ kind: "collapsed" });
    expect(grouped.getState().snapshot.expansion.overrideCount).toBe(0);
  });

  test("retains a sparse override while its last all-population group row is filtered out", async () => {
    const grouped = createLocalRowModel({
      rows: [{ id: 1, region: "West", team: "A", score: 1 }],
      columns,
      initialExpansion: { kind: "collapsed" },
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 1 }],
        sort: [],
        rowGroups: [{ columnId: "team" }],
      },
    });
    const teamA = "__group__:team=s:A" as PretableGroupId;
    grouped.setGroupExpanded(teamA, true);

    expect(
      grouped.applyTransaction({
        update: [{ id: 1, changes: { score: 0 } }],
      }),
    ).toMatchObject({ previousRevision: 1, revision: 2, updated: 1 });
    expect(grouped.getState().snapshot.range(0, 10)).toEqual([]);
    expect(grouped.getState().snapshot.expansion.overrideCount).toBe(1);

    const transition = grouped.setQuery({
      filters: [{ columnId: "score", operator: "gte", value: 1 }],
      sort: [{ columnId: "score", direction: "desc" }],
      rowGroups: [{ columnId: "team" }],
    });
    await expect(transition.finished).resolves.toBe(3);
    expect(grouped.getState().snapshot.range(0, 10)).toEqual([]);
    expect(grouped.getState().snapshot.expansion.overrideCount).toBe(1);

    expect(grouped.setExpansionDefault({ kind: "collapsed" })).toMatchObject({
      previousRevision: 3,
      revision: 4,
    });
    expect(grouped.getState().snapshot.expansion.overrideCount).toBe(0);

    grouped.applyTransaction({
      update: [{ id: 1, changes: { score: 2 } }],
    });
    expect(grouped.getState().snapshot.range(0, 10)).toEqual([
      expect.objectContaining({
        kind: "group",
        groupId: teamA,
        expanded: false,
      }),
    ]);
  });

  test("updates expansion policy for hidden all-population groups", () => {
    const grouped = createLocalRowModel({
      rows: [{ id: 1, region: "West", team: "A", score: 1 }],
      columns,
      initialExpansion: { kind: "collapsed" },
      query: {
        filters: [{ columnId: "score", operator: "gte", value: 1 }],
        sort: [],
        rowGroups: [{ columnId: "team" }],
      },
    });
    const teamA = "__group__:team=s:A" as PretableGroupId;
    const held = grouped.getState().snapshot.rowAt(0);
    const listener = vi.fn();
    grouped.subscribe(listener);

    expect(grouped.setGroupExpanded(teamA, true)).toMatchObject({
      previousRevision: 0,
      revision: 1,
      ignored: 0,
      issues: [],
    });
    grouped.applyTransaction({
      update: [{ id: 1, changes: { score: 0 } }],
    });
    expect(grouped.getState().snapshot.range(0, 10)).toEqual([]);
    expect(grouped.getState().snapshot.visibleRowCount).toBe(0);
    expect(grouped.getState().snapshot.isGroupExpanded(teamA)).toBe(true);

    expect(grouped.setGroupExpanded(teamA, false)).toMatchObject({
      previousRevision: 2,
      revision: 3,
      ignored: 0,
      issues: [],
    });
    expect(grouped.getState().snapshot.isGroupExpanded(teamA)).toBe(false);
    expect(grouped.getState().snapshot.range(0, 10)).toEqual([]);
    expect(grouped.setGroupExpanded(teamA, true)).toMatchObject({
      previousRevision: 3,
      revision: 4,
    });

    grouped.applyTransaction({
      update: [{ id: 1, changes: { score: 2 } }],
    });
    const visible = grouped.getState().snapshot.range(0, 10);
    expect(visible).toHaveLength(2);
    expect(visible[0]).toMatchObject({
      kind: "group",
      groupId: teamA,
      expanded: true,
    });
    expect(visible[0]?.kind === "group" && visible[0].groupId).toBe(
      held?.kind === "group" ? held.groupId : undefined,
    );
    expect(visible[1]).toMatchObject({ kind: "data", rowId: 1 });
    expect(grouped.getState().snapshot.visibleRowCount).toBe(2);
    expect(grouped.getState().snapshot.visibleDataRowCount).toBe(1);
    expect(grouped.getState().snapshot.revision).toBe(5);
    expect(listener).toHaveBeenCalledTimes(5);
  });

  test("expandAll and collapseAll replace policy roots without enumerating groups", () => {
    // From collapsed, so `expandAll()` is a real policy change and not a no-op.
    const grouped = model({ kind: "collapsed" });
    const listener = vi.fn();
    grouped.subscribe(listener);
    expect(grouped.expandAll()).toMatchObject({
      previousRevision: 0,
      revision: 1,
    });
    expect(grouped.getState().snapshot.expansion).toEqual({
      default: { kind: "expanded" },
      overrideCount: 0,
    });
    expect(grouped.collapseAll()).toMatchObject({
      previousRevision: 1,
      revision: 2,
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("finds nearest visible ancestors for collapsed descendants", () => {
    const grouped = model({ kind: "expanded" });
    const captured = grouped.getState().snapshot;
    grouped.setGroupExpanded(west, false);
    const snapshot = grouped.getState().snapshot;
    expect(snapshot.nearestVisibleRef({ kind: "data", rowId: 1 })).toEqual({
      kind: "group",
      groupId: west,
    });
    expect(
      snapshot.nearestVisibleRef({ kind: "group", groupId: westA }),
    ).toEqual({ kind: "group", groupId: west });
    expect(captured.nearestVisibleRef({ kind: "data", rowId: 1 })).toEqual({
      kind: "data",
      rowId: 1,
    });
  });

  test("rebuilds grouped compatible derivations without changing the schema", async () => {
    const grouped = model();
    const replacements = [
      columns[0],
      columns[1],
      { ...columns[2], aggregate: "avg" as const },
    ] as const;

    const transition = grouped.setDerivations(replacements);
    await expect(transition.finished).resolves.toBe(1);
    const westGroup = grouped
      .getState()
      .snapshot.range(0, 10)
      .find((row) => row.kind === "group" && row.groupId === west);
    expect(westGroup?.kind === "group" && westGroup.aggregates.score).toBe(1.5);
    expect(transition.requestedDerivations[2]?.aggregate).toBe("avg");
  });

  test("attributes derivation rebuild failures to set-derivations and rolls back", async () => {
    const grouped = model();
    const before = grouped.getState();
    const failing = [
      {
        ...columns[0],
        accessor: (): string => {
          throw new Error("replacement accessor exploded");
        },
        value: (): string => {
          throw new Error("replacement accessor exploded");
        },
      },
      columns[1],
      columns[2],
    ] as const;

    await expect(grouped.setDerivations(failing).finished).rejects.toEqual(
      expect.objectContaining({
        code: "accessor-failed",
        operation: "set-derivations",
        rowId: 1,
        columnId: "region",
        cause: expect.objectContaining({
          message: "replacement accessor exploded",
        }),
      }),
    );
    expect(grouped.getState().snapshot).toBe(before.snapshot);

    const comparatorFailure = [
      {
        ...columns[0],
        compare: (): number => {
          throw new Error("replacement comparator exploded");
        },
      },
      columns[1],
      columns[2],
    ] as const;
    await expect(
      grouped.setDerivations(comparatorFailure).finished,
    ).rejects.toEqual(
      expect.objectContaining({
        code: "comparator-failed",
        operation: "set-derivations",
        columnId: "region",
        groupValues: expect.any(Array),
        cause: expect.objectContaining({
          message: "replacement comparator exploded",
        }),
      }),
    );
    expect(grouped.getState().snapshot).toBe(before.snapshot);

    const aggregateFailure = [
      columns[0],
      columns[1],
      {
        ...columns[2],
        aggregate: {
          init: () => 0,
          accumulate: (accumulator: number, value: number) =>
            accumulator + value,
          merge: (left: number, right: number) => left + right,
          finalize: (): number | null => {
            throw new Error("replacement finalize exploded");
          },
        },
      },
    ] as const;
    await expect(
      grouped.setDerivations(aggregateFailure).finished,
    ).rejects.toEqual(
      expect.objectContaining({
        code: "aggregator-failed",
        operation: "set-derivations",
        rowId: 1,
        columnId: "score",
        groupValues: expect.any(Array),
        cause: expect.objectContaining({
          message: "replacement finalize exploded",
        }),
      }),
    );
    expect(grouped.getState().snapshot).toBe(before.snapshot);
    expect(grouped.setDerivations(columns).id).toBe(4);
  });

  test("guards expansion and derivation commands after disposal", () => {
    const grouped = model();
    grouped.dispose();
    expect(() => grouped.setGroupExpanded(west, true)).toThrowError(
      expect.objectContaining({
        code: "disposed-model",
        operation: "set-group-expanded",
      }),
    );
    expect(() =>
      grouped.setExpansionDefault({ kind: "expanded" }),
    ).toThrowError(
      expect.objectContaining({
        code: "disposed-model",
        operation: "set-expansion-default",
      }),
    );
    expect(() => grouped.expandAll()).toThrowError(
      expect.objectContaining({
        code: "disposed-model",
        operation: "expand-all",
      }),
    );
    expect(() => grouped.collapseAll()).toThrowError(
      expect.objectContaining({
        code: "disposed-model",
        operation: "collapse-all",
      }),
    );
    expect(() => grouped.setDerivations(columns)).toThrowError(
      expect.objectContaining({
        code: "disposed-model",
        operation: "set-derivations",
      }),
    );
  });
});

function failingOverrideRoot(): {
  readonly root: GroupIndexRoot<Row, number, typeof columns>;
  readonly groupId: PretableGroupId;
} {
  const groupId = "__group__:team=s:A" as PretableGroupId;
  const aggregateTree = {
    size: 1,
    firstId: () => 1,
    finalize: () => {
      throw new Error("override finalize exploded");
    },
  };
  const node = {
    groupId,
    path: Object.freeze([{ columnId: "team", value: "A" }]),
    pathKeys: Object.freeze(["s:A"]),
    depth: 0,
    columnId: "team",
    value: "A",
    key: "s:A",
    parentGroupId: undefined,
    override: undefined,
    childrenByKey: createPersistentMap(),
    children: { size: 0 },
    leaves: { size: 1, entryAt: () => ({ rowId: 1 }) },
    filteredCount: 1,
    allCount: 1,
    aggregateRoots: {
      all: new Map([["score", aggregateTree]]),
      filtered: new Map([["score", aggregateTree]]),
    },
    aggregates: Object.freeze({ score: 1 }),
    publicCollapsed: Object.freeze({}),
    publicExpanded: Object.freeze({}),
    counts: Object.freeze({}),
  } as unknown as GroupNode<Row, number, typeof columns>;
  return {
    groupId,
    root: {
      levelCount: 1,
      queryPlan: {},
      aggregateFilteredRows: false,
      rootsByKey: createPersistentMap<string, typeof node>().set("s:A", node),
      roots: {},
      groups: createPersistentMap<PretableGroupId, typeof node>().set(
        groupId,
        node,
      ),
      rowParents: createPersistentMap<number, PretableGroupId>().set(
        1,
        groupId,
      ),
      counts: {},
    } as unknown as GroupIndexRoot<Row, number, typeof columns>,
  };
}

describe("expansion error attribution", () => {
  test.each([
    "set-group-expanded",
    "set-expansion-default",
    "expand-all",
    "collapse-all",
    "set-rows",
    "apply-transaction",
    "set-query",
    "set-derivations",
  ] satisfies readonly PretableRowModelOperation[])(
    "preserves the initiating %s operation when a retained override finalizer fails",
    (operation) => {
      const { root, groupId } = failingOverrideRoot();
      const apply = setGroupOverride as unknown as (
        current: typeof root,
        id: PretableGroupId,
        expanded: boolean,
        initiatingOperation: PretableRowModelOperation,
      ) => typeof root;

      expect(() => apply(root, groupId, true, operation)).toThrowError(
        expect.objectContaining({
          code: "aggregator-failed",
          operation,
          rowId: 1,
          columnId: "score",
          groupId,
          groupValues: ["A"],
          cause: expect.objectContaining({
            message: "override finalize exploded",
          }),
        }),
      );
    },
  );
});

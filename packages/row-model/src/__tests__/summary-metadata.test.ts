import { expect, test } from "vitest";
import {
  createColumnHelper,
  createLocalRowModel,
  mergeColumnAggregateOverrides,
} from "../index";

test("committed snapshots expose frozen effective aggregate IDs without acquiring summaries", async () => {
  const helper = createColumnHelper<{
    id: string;
    team: string;
    hours: number;
  }>();
  const columns = [
    helper.accessor("team", { type: "text" }),
    helper.accessor("hours", { type: "number", aggregate: "sum" }),
  ] as const;
  const model = createLocalRowModel({
    columns,
    rows: [{ id: "a", team: "Design", hours: 2 }],
    transitionClock: () => 0,
  });
  const originalSchema = model.getColumns();
  const first = model.getState().snapshot;
  expect(first.aggregateColumnIds).toEqual(["hours"]);
  expect(Object.isFrozen(first.aggregateColumnIds)).toBe(true);
  expect(first.getSummary?.("all")).toBeUndefined();
  model.applyTransaction({ update: [{ id: "a", changes: { hours: 4 } }] });
  expect(model.getState().snapshot.aggregateColumnIds).toBe(
    first.aggregateColumnIds,
  );
  await model.setQuery({
    filters: [],
    sort: [],
    rowGroups: [{ columnId: "team" }],
  }).finished;
  const grouped = model.getState().snapshot;
  expect(grouped.aggregateColumnIds).toEqual(["hours"]);
  model.collapseAll();
  expect(model.getState().snapshot.aggregateColumnIds).toBe(
    grouped.aggregateColumnIds,
  );
  await model.setDerivations(
    mergeColumnAggregateOverrides(columns, { hours: null, team: "count" }),
  ).finished;
  expect(model.getState().snapshot.aggregateColumnIds).toEqual(["team"]);
  expect(first.aggregateColumnIds).toEqual(["hours"]);
  expect(grouped.aggregateColumnIds).toEqual(["hours"]);
  expect(model.getColumns()).toBe(originalSchema);
  model.dispose();
});

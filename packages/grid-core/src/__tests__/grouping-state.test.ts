import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
} from "@pretable-internal/row-model";

import { createGridUiCore } from "../create-grid-ui-core";

interface Row {
  readonly id: number;
  readonly name: string;
  readonly quantity: number;
  readonly price: number;
}

const helper = createColumnHelper<Row>();
const modelColumns = [
  helper.accessor("name", { type: "text" }),
  helper.accessor("quantity", { type: "number" }),
  helper.accessor("price", { type: "number" }),
] as const;

function make(options: { readonly hideGroupedColumns?: boolean } = {}) {
  const rowModel = createLocalRowModel({
    rows: [
      { id: 1, name: "one", quantity: 1, price: 10 },
      { id: 2, name: "two", quantity: 2, price: 20 },
    ],
    columns: modelColumns,
  });
  return createGridUiCore({
    rowModel,
    columns: [
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ] as const,
    ...options,
  });
}

describe("hideGroupedColumns is UI state", () => {
  test("the initial value survives into getState()", () => {
    expect(
      make({ hideGroupedColumns: true }).getState().hideGroupedColumns,
    ).toBe(true);
    expect(
      make({ hideGroupedColumns: false }).getState().hideGroupedColumns,
    ).toBe(false);
  });

  test("absent in the config is ABSENT in the state, not false", () => {
    // The surface's default lives above grid-core: conflating "unset" with
    // "explicitly off" would make the two indistinguishable to a consumer.
    // `toEqual`/`toBeUndefined` cannot tell them apart — only `in` can.
    expect("hideGroupedColumns" in make().getState()).toBe(false);
  });

  test("setHideGroupedColumns(true) publishes exactly once", () => {
    const grid = make();
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setHideGroupedColumns(true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.getState().hideGroupedColumns).toBe(true);
  });

  test("an unchanged value publishes nothing", () => {
    const grid = make();
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setHideGroupedColumns(true);
    expect(listener).toHaveBeenCalledTimes(1);
    const published = grid.getState();

    grid.setHideGroupedColumns(true);
    expect(grid.getState()).toBe(published);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("an unchanged seeded value publishes nothing", () => {
    const grid = make({ hideGroupedColumns: true });
    const listener = vi.fn();
    grid.subscribe(listener);
    const before = grid.getState();

    grid.setHideGroupedColumns(true);

    expect(grid.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("setHideGroupedColumns(false) is distinct from unset", () => {
    const grid = make();
    expect("hideGroupedColumns" in grid.getState()).toBe(false);
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setHideGroupedColumns(false);

    expect(listener).toHaveBeenCalledTimes(1);
    const state = grid.getState();
    expect("hideGroupedColumns" in state).toBe(true);
    expect(state.hideGroupedColumns).toBe(false);
  });

  test("an unrelated publish preserves hideGroupedColumns", () => {
    // It survives only because every command SPREADS the current state rather
    // than rebuilding the object from named fields. Pinned here because a
    // rebuild would silently drop every optional key on this state.
    const grid = make({ hideGroupedColumns: true });

    grid.setColumnVisible("quantity", false);

    expect(grid.getState().hideGroupedColumns).toBe(true);
  });

  test("setHideGroupedColumns(false) overwrites a seeded true", () => {
    const grid = make({ hideGroupedColumns: true });

    grid.setHideGroupedColumns(false);

    const state = grid.getState();
    expect("hideGroupedColumns" in state).toBe(true);
    expect(state.hideGroupedColumns).toBe(false);
  });
});

describe("per-column aggregate overrides are UI state", () => {
  test("setColumnAggregate records an override readable from getState()", () => {
    const grid = make();
    expect(grid.getState().columnAggregates).toEqual({});

    grid.setColumnAggregate("quantity", "sum");

    expect(grid.getState().columnAggregates).toEqual({ quantity: "sum" });
  });

  test("setting the same value again publishes nothing", () => {
    const grid = make();
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setColumnAggregate("quantity", "sum");
    expect(listener).toHaveBeenCalledTimes(1);
    const published = grid.getState();

    grid.setColumnAggregate("quantity", "sum");

    expect(grid.getState()).toBe(published);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("a different value publishes once and replaces the old one", () => {
    const grid = make();
    grid.setColumnAggregate("quantity", "sum");
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setColumnAggregate("quantity", "avg");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.getState().columnAggregates).toEqual({ quantity: "avg" });
  });

  test("an object aggregator is stored uninterpreted", () => {
    // grid-core never reads the value — row-model resolves it — so an object
    // aggregator has to survive round-trip by identity.
    const grid = make();
    const aggregator = { kind: "custom", reduce: () => 1 };

    grid.setColumnAggregate("quantity", aggregator);

    expect(grid.getState().columnAggregates.quantity).toBe(aggregator);
  });

  test("undefined CLEARS the override by stripping the key", () => {
    const grid = make();
    grid.setColumnAggregate("quantity", "sum");
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setColumnAggregate("quantity", undefined);

    expect(listener).toHaveBeenCalledTimes(1);
    const state = grid.getState();
    // `toBeUndefined()` cannot tell a stripped key from one present and
    // undefined, and the difference is the whole override contract: a present
    // key means "the pane chose this", so a present `undefined` would read as
    // an override to nothing rather than a fall-back to the column's prop.
    expect("quantity" in state.columnAggregates).toBe(false);
    expect(state.columnAggregates).toEqual({});
  });

  test("clearing an override that was never set publishes nothing", () => {
    const grid = make();
    const listener = vi.fn();
    grid.subscribe(listener);
    const before = grid.getState();

    grid.setColumnAggregate("quantity", undefined);

    expect(grid.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("overrides on other columns survive a clear", () => {
    const grid = make();
    grid.setColumnAggregate("quantity", "sum");
    grid.setColumnAggregate("price", "max");

    grid.setColumnAggregate("quantity", undefined);

    expect(grid.getState().columnAggregates).toEqual({ price: "max" });
  });

  test("an unrelated publish preserves the overrides", () => {
    // The twin of the `hideGroupedColumns` test above: this is the second key
    // on the same state object, and it survives only because every command
    // SPREADS the current state rather than rebuilding it from named fields.
    const grid = make();
    grid.setColumnAggregate("quantity", "sum");

    grid.setColumnVisible("price", false);

    expect(grid.getState().columnAggregates).toEqual({ quantity: "sum" });
  });

  test("an unknown column id is a silent no-op", () => {
    // Matches `setColumnPinned`/`setColumnWidth`, which both early-return on a
    // missing layout entry. An override is not geometry, so it COULD live for
    // an id the layout has never seen — but nothing would ever evict it, so
    // the map would accumulate entries for ids that never draw.
    const grid = make();
    const listener = vi.fn();
    grid.subscribe(listener);
    const before = grid.getState();

    grid.setColumnAggregate("nope" as "quantity", "sum");

    expect(grid.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("setColumns drops overrides for columns it removes", () => {
    // The corollary of the no-op above: an id absent from the layout can no
    // longer be written OR cleared, so a removed column's override would be
    // unreachable state forever.
    const grid = make();
    grid.setColumnAggregate("quantity", "sum");
    grid.setColumnAggregate("price", "max");

    grid.setColumns([
      { id: "name", widthPx: 180 },
      { id: "price", widthPx: 120 },
    ]);

    expect(grid.getState().columnAggregates).toEqual({ price: "max" });
  });

  test("setColumns keeps overrides for columns it retains", () => {
    const grid = make();
    grid.setColumnAggregate("quantity", "sum");
    const before = grid.getState().columnAggregates;

    grid.setColumns([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 140 },
      { id: "price", widthPx: 120 },
    ]);

    const after = grid.getState().columnAggregates;
    expect(after).toEqual({ quantity: "sum" });
    // `toBe`, not just `toEqual`: `setColumns` publishes anyway because the
    // layout changed, so reusing the map is worth nothing EXCEPT referential
    // stability, and only an identity assertion can see that.
    expect(after).toBe(before);
  });

  test("setColumns keeps the override of a column it merely HIDES", () => {
    // The prune keys on LAYOUT membership, not the drawn set. Grouping hides
    // columns through layout `hidden` (that is what `hideGroupedColumns`
    // drives), so pruning against the drawn set would discard an override the
    // moment the rows were grouped by that column.
    const grid = make();
    grid.setColumnAggregate("quantity", "sum");

    grid.setColumns([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100, hidden: true },
      { id: "price", widthPx: 120 },
    ]);

    expect(grid.getState().columnAggregates).toEqual({ quantity: "sum" });
  });

  test("a HIDDEN column can take an override", () => {
    const grid = make();
    grid.setColumnVisible("quantity", false);

    grid.setColumnAggregate("quantity", "sum");

    expect(grid.getState().columnAggregates).toEqual({ quantity: "sum" });
  });

  test("an override survives a hide/show round trip", () => {
    // The contract `setColumnVisible` documents for width and pin: hiding
    // removes a column from the drawn set without forgetting anything about
    // it, so re-showing restores the whole cell, aggregate included.
    const grid = make();
    grid.setColumnAggregate("quantity", "sum");

    grid.setColumnVisible("quantity", false);
    expect(grid.getState().columnAggregates).toEqual({ quantity: "sum" });
    grid.setColumnVisible("quantity", true);

    expect(grid.getState().columnAggregates).toEqual({ quantity: "sum" });
  });
});

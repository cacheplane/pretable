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

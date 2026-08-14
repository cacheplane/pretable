import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pretable } from "../pretable";
import { PretableSurface } from "../pretable-surface";

/**
 * `getRowId` is optional when the row carries a conventional
 * `id: string | number`. The engine has always fallen back to `row.id`; only
 * the React components' prop types insisted on the accessor, so the docs and
 * the hooks disagreed with `<PretableSurface>` and `<Pretable>`.
 *
 * Types compiling proves nothing about identity, so every case here goes
 * through the observable that matters: a selection made before a row-set
 * update still names the same row afterwards. The fixtures are built so a
 * broken fallback cannot pass — `id` disagrees with array position, the
 * replacement arrays are fresh objects in a different order, and the rows that
 * exercise an explicit accessor carry BOTH an `id` and a separate stable key
 * with different values, so reading the wrong field is visible in the result.
 */

type Holding = {
  id: string;
  /** Deliberately disagrees with `id` so an accessor mix-up is detectable. */
  sku: string;
  name: string;
};

const columns = [
  { id: "name", header: "Name", value: (row: Holding) => row.name },
  { id: "sku", header: "SKU", value: (row: Holding) => row.sku },
];

/** `id` order is c, a, b — never the array order — so position-as-identity fails. */
const initialRows: Holding[] = [
  { id: "c", sku: "sku_1", name: "Cobalt" },
  { id: "a", sku: "sku_2", name: "Argon" },
  { id: "b", sku: "sku_3", name: "Boron" },
];

/** Fresh objects, reversed order, same ids, mutated values. */
const updatedRows: Holding[] = [
  { id: "b", sku: "sku_3", name: "Boron (rev 2)" },
  { id: "c", sku: "sku_1", name: "Cobalt (rev 2)" },
  { id: "a", sku: "sku_2", name: "Argon (rev 2)" },
];

function rowCheckbox(container: HTMLElement, rowId: string): HTMLElement {
  const box = container.querySelector(
    `[data-pretable-row-id="${rowId}"] button[data-pretable-row-select]`,
  );
  if (!box) throw new Error(`no checkbox for row ${rowId}`);
  return box as HTMLElement;
}

function renderedRowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-pretable-row-id]")).map(
    (element) => element.getAttribute("data-pretable-row-id") ?? "",
  );
}

function lastCall(fn: ReturnType<typeof vi.fn>): string[] {
  return fn.mock.calls.at(-1)?.[0] as string[];
}

afterEach(cleanup);

describe("<PretableSurface> row identity without getRowId", () => {
  it("derives row identity from the conventional `id` field", () => {
    const { container } = render(
      <PretableSurface<Holding>
        ariaLabel="Holdings"
        columns={columns}
        rows={initialRows}
        viewportHeight={400}
      />,
    );

    // Not [0, 1, 2], and not the `sku` values — the `id` field specifically.
    expect(renderedRowIds(container)).toEqual(["c", "a", "b"]);
  });

  it("keeps a selection pinned to the same row across a row-set update", async () => {
    const onRowSelectionChange = vi.fn();
    const { container, rerender } = render(
      <PretableSurface<Holding>
        ariaLabel="Holdings"
        columns={columns}
        rows={initialRows}
        viewportHeight={400}
        rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );

    fireEvent.click(rowCheckbox(container, "a"));
    expect(lastCall(onRowSelectionChange)).toEqual(["a"]);

    rerender(
      <PretableSurface<Holding>
        ariaLabel="Holdings"
        columns={columns}
        rows={updatedRows}
        viewportHeight={400}
        rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
        onRowSelectionChange={onRowSelectionChange}
      />,
    );

    // Row "a" moved from index 1 to index 2 and is a different object with a
    // different `name`. Identity is the `id`, so the selection follows it.
    await waitFor(() => {
      expect(renderedRowIds(container)).toEqual(["b", "c", "a"]);
    });
    expect(lastCall(onRowSelectionChange)).toEqual(["a"]);
    expect(rowCheckbox(container, "a")).toHaveAttribute("aria-checked", "true");
    expect(rowCheckbox(container, "c")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("keeps focus on the same row across a row-set update", async () => {
    const onFocusChange = vi.fn();
    const props = (rows: Holding[]) => ({
      ariaLabel: "Holdings",
      columns,
      rows,
      viewportHeight: 400,
      onFocusChange,
    });
    const { container, rerender } = render(
      <PretableSurface<Holding> {...props(initialRows)} />,
    );

    const cell = container.querySelector(
      '[data-pretable-row-id="a"] [data-pretable-column-id="name"]',
    );
    if (!cell) throw new Error("no cell for row a");
    fireEvent.click(cell);

    await waitFor(() => {
      expect(onFocusChange.mock.calls.at(-1)?.[0]?.ref?.rowId).toBe("a");
    });

    rerender(<PretableSurface<Holding> {...props(updatedRows)} />);

    await waitFor(() => {
      expect(renderedRowIds(container)).toEqual(["b", "c", "a"]);
    });
    // Focus is not re-reported on a pure row update, so read it off the DOM.
    const focused = container.querySelector('[data-pretable-focused="true"]');
    expect(focused?.closest("[data-pretable-row-id]")).toHaveAttribute(
      "data-pretable-row-id",
      "a",
    );
  });

  it("still lets an explicit getRowId win over the conventional `id`", async () => {
    const onRowSelectionChange = vi.fn();
    const props = (rows: Holding[]) => ({
      ariaLabel: "Holdings",
      columns,
      rows,
      viewportHeight: 400,
      getRowId: (row: Holding) => row.sku,
      rowSelectionColumn: { enabled: true, headerCheckbox: true } as const,
      onRowSelectionChange,
    });
    const { container, rerender } = render(
      <PretableSurface<Holding, string> {...props(initialRows)} />,
    );

    // `sku`, not `id` — the fallback must not shadow an explicit accessor.
    expect(renderedRowIds(container)).toEqual(["sku_1", "sku_2", "sku_3"]);

    fireEvent.click(rowCheckbox(container, "sku_2"));
    expect(lastCall(onRowSelectionChange)).toEqual(["sku_2"]);

    rerender(<PretableSurface<Holding, string> {...props(updatedRows)} />);

    await waitFor(() => {
      expect(renderedRowIds(container)).toEqual(["sku_3", "sku_1", "sku_2"]);
    });
    expect(lastCall(onRowSelectionChange)).toEqual(["sku_2"]);
  });
});

describe("<Pretable> row identity without getRowId", () => {
  it("derives row identity from the conventional `id` and holds it across an update", async () => {
    const onRowSelectionChange = vi.fn();
    const props = (rows: Holding[]) => ({
      ariaLabel: "Holdings",
      columns,
      rows,
      rowSelectionColumn: { enabled: true, headerCheckbox: true } as const,
      onRowSelectionChange,
    });
    const { container, rerender } = render(
      <Pretable<Holding> {...props(initialRows)} />,
    );

    expect(renderedRowIds(container)).toEqual(["c", "a", "b"]);

    fireEvent.click(rowCheckbox(container, "a"));
    expect(lastCall(onRowSelectionChange)).toEqual(["a"]);

    rerender(<Pretable<Holding> {...props(updatedRows)} />);

    await waitFor(() => {
      expect(renderedRowIds(container)).toEqual(["b", "c", "a"]);
    });
    expect(lastCall(onRowSelectionChange)).toEqual(["a"]);
  });
});

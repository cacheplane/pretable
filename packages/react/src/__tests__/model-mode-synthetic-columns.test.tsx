// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import {
  GROUP_COLUMN_ID,
  createColumnHelper,
  createLocalRowModel,
} from "@pretable/core";

import { ROW_SELECT_COLUMN_ID } from "../constants";
import { PretableSurface } from "../pretable-surface";

/**
 * Model mode is the ownership mode where the row model is the consumer's, so
 * the drawn column set is furthest from the schema the engine was built with:
 * the surface adds a grouped-row column and a row-checkbox column that the
 * model's `getColumns()` never declares. Those extras used to reach the engine
 * only through `as never`.
 *
 * Both synthetics are exercised TOGETHER and against behaviour, not just
 * presence — a drawn-but-inert checkbox column, or a group column drawn over
 * ungrouped rows, would both satisfy a header-only assertion.
 */
interface Row {
  key: `row_${number}`;
  city: string;
  score: number;
}

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("city", { type: "text" }),
  column.accessor("score", { type: "number" }),
] as const;
const rows: readonly Row[] = [
  { key: "row_1", city: "Oslo", score: 1 },
  { key: "row_2", city: "Oslo", score: 2 },
  { key: "row_3", city: "Lima", score: 3 },
];

/** The row-select header carries a marker attribute rather than a column id. */
function headerIds(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll<HTMLElement>("[data-pretable-header-cell]"),
  ].map((el) =>
    el.hasAttribute("data-pretable-row-select-header")
      ? ROW_SELECT_COLUMN_ID
      : (el.dataset["pretableColumnId"] ?? "?"),
  );
}

afterEach(cleanup);

describe("model mode draws the synthetic columns", () => {
  test("grouping and row-select both reach the engine layout, and both work", async () => {
    const model = createLocalRowModel({
      rows,
      columns,
      getRowId: (row) => row.key,
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "city" }],
      },
    });
    const selected: string[][] = [];
    const { container } = render(
      <PretableSurface
        ariaLabel="model mode synthetics"
        model={model}
        onRowSelectionChange={(rowIds) => selected.push([...rowIds])}
        overscan={0}
        rowSelectionColumn={{ enabled: true, pinned: false }}
        viewportHeight={300}
      />,
    );

    // Both synthetics drawn, in the engine's own order, alongside the schema
    // columns. `city` is absent because grouping on it hides it by default —
    // which is itself proof the group column is a consequence of the query
    // rather than a decoration drawn unconditionally.
    await waitFor(() => {
      expect(headerIds(container)).toEqual([
        ROW_SELECT_COLUMN_ID,
        GROUP_COLUMN_ID,
        "score",
      ]);
    });

    // The group column carries real group rows, one per distinct city, each
    // with a labelled cell in the synthetic column.
    await waitFor(() => {
      expect(
        container.querySelectorAll("[data-pretable-group-row]").length,
      ).toBe(2);
    });
    expect(
      [
        ...container.querySelectorAll<HTMLElement>(
          "[data-pretable-group-label]",
        ),
      ].map((el) => el.textContent),
    ).toEqual(["Lima", "Oslo"]);

    // The checkbox column is live, not merely drawn.
    const checkbox = container.querySelector<HTMLElement>(
      "button[data-pretable-row-select]",
    );
    expect(checkbox).not.toBeNull();
    fireEvent.click(checkbox!);
    await waitFor(() => {
      expect(selected.at(-1)?.length).toBe(1);
    });
    expect(checkbox!.getAttribute("aria-checked")).toBe("true");
  });
});

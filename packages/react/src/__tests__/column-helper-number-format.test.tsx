import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  numberFormats,
} from "@pretable/core";

import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import { mergeModelPresentationColumnsForTesting } from "../use-pretable";

afterEach(cleanup);

type Order = {
  id: string;
  region: string;
  revenue: number;
};

const rows: Order[] = [
  { id: "o1", region: "West", revenue: 1234.5 },
  { id: "o2", region: "West", revenue: 100 },
];

const usd = numberFormats.money({ currency: "USD" });
const column = createColumnHelper<Order>();

function cellTexts(container: HTMLElement, columnId: string): string[] {
  return Array.from(
    container.querySelectorAll(`[data-pretable-column-id="${columnId}"]`),
  ).map((node) => node.textContent ?? "");
}

describe("createColumnHelper numberFormat", () => {
  it("formats data cells through a helper-declared numberFormat", () => {
    const columns = [
      column.accessor("region", { type: "text", header: "Region" }),
      column.accessor("revenue", {
        type: "number",
        header: "Revenue",
        numberFormat: usd,
      }),
    ] as const;

    const view = render(
      <PretableSurface
        ariaLabel="Orders"
        columns={columns}
        getRowId={(row) => row.id}
        locale="en-US"
        rows={rows}
        viewportHeight={200}
      />,
    );

    expect(cellTexts(view.container, "revenue")).toContain("$1,234.50");
    expect(cellTexts(view.container, "revenue")).toContain("$100.00");
  });

  it("renders identically to the same numberFormat on a plain PretableColumn", () => {
    const helperColumns = [
      column.accessor("region", { type: "text", header: "Region" }),
      column.accessor("revenue", {
        type: "number",
        header: "Revenue",
        numberFormat: usd,
      }),
    ] as const;
    const plainColumns: PretableColumn<Order>[] = [
      { id: "region", type: "text", header: "Region" },
      { id: "revenue", type: "number", header: "Revenue", numberFormat: usd },
    ];

    const helperView = render(
      <PretableSurface
        ariaLabel="Orders via helper"
        columns={helperColumns}
        getRowId={(row) => row.id}
        locale="en-US"
        rows={rows}
        viewportHeight={200}
      />,
    );
    const helperTexts = cellTexts(helperView.container, "revenue");
    cleanup();

    const plainView = render(
      <PretableSurface
        ariaLabel="Orders via plain columns"
        columns={plainColumns}
        getRowId={(row) => row.id}
        locale="en-US"
        rows={rows}
        viewportHeight={200}
      />,
    );

    expect(cellTexts(plainView.container, "revenue")).toEqual(helperTexts);
    expect(helperTexts).toContain("$1,234.50");
  });

  it("keeps format outranking numberFormat on a helper column", () => {
    const columns = [
      column.accessor("region", { type: "text", header: "Region" }),
      column.accessor("revenue", {
        type: "number",
        header: "Revenue",
        numberFormat: usd,
        format: ({ value }) => `custom:${value}`,
      }),
    ] as const;

    const view = render(
      <PretableSurface
        ariaLabel="Orders"
        columns={columns}
        getRowId={(row) => row.id}
        locale="en-US"
        rows={rows}
        viewportHeight={200}
      />,
    );

    expect(cellTexts(view.container, "revenue")).toContain("custom:1234.5");
    expect(view.container).not.toHaveTextContent("$1,234.50");
  });

  it("lets group aggregates inherit a helper-declared numberFormat", () => {
    const columns = [
      column.accessor("region", { type: "text", header: "Region" }),
      column.accessor("revenue", {
        type: "number",
        header: "Revenue",
        aggregate: "sum",
        numberFormat: usd,
      }),
    ] as const;

    const view = render(
      <PretableSurface
        ariaLabel="Orders"
        columns={columns}
        getRowId={(row) => row.id}
        locale="en-US"
        onQueryChange={() => {}}
        query={{
          filters: [],
          sort: [],
          rowGroups: [{ columnId: "region" }],
        }}
        rows={rows}
        viewportHeight={200}
      />,
    );

    expect(cellTexts(view.container, "revenue")).toContain("$1,334.50");
  });

  it("keeps formatAggregate outranking an inherited numberFormat", () => {
    const columns = [
      column.accessor("region", { type: "text", header: "Region" }),
      column.accessor("revenue", {
        type: "number",
        header: "Revenue",
        aggregate: "sum",
        numberFormat: usd,
        formatAggregate: ({ value }) => `total:${value ?? 0}`,
      }),
    ] as const;

    const view = render(
      <PretableSurface
        ariaLabel="Orders"
        columns={columns}
        getRowId={(row) => row.id}
        locale="en-US"
        onQueryChange={() => {}}
        query={{
          filters: [],
          sort: [],
          rowGroups: [{ columnId: "region" }],
        }}
        rows={rows}
        viewportHeight={200}
      />,
    );

    expect(cellTexts(view.container, "revenue")).toContain("total:1334.5");
    expect(view.container).not.toHaveTextContent("$1,334.50");
  });

  it("formats through a schema numberFormat in explicit-model mode", () => {
    const schema = [
      column.accessor("region", { type: "text", header: "Region" }),
      column.accessor("revenue", {
        type: "number",
        header: "Revenue",
        numberFormat: usd,
      }),
    ] as const;
    const model = createLocalRowModel({ rows, columns: schema });

    const view = render(
      <PretableSurface
        ariaLabel="Orders"
        locale="en-US"
        model={model}
        viewportHeight={200}
      />,
    );

    expect(cellTexts(view.container, "revenue")).toContain("$1,234.50");
    model.dispose();
  });

  it("keeps numberFormat schema-authoritative, exactly like format", () => {
    const percent: Intl.NumberFormatOptions = { style: "percent" };
    const merged = mergeModelPresentationColumnsForTesting(
      [
        {
          id: "revenue",
          accessor: (row: Order) => row.revenue,
          value: (row: Order) => row.revenue,
          numberFormat: usd,
        },
      ],
      [{ id: "revenue", header: "Revenue", numberFormat: percent }],
    );

    expect(merged[0]?.numberFormat).toBe(usd);
    expect(merged[0]?.header).toBe("Revenue");
  });

  it("keeps dateFormat schema-authoritative with the same merge policy", () => {
    const schemaDateFormat = { dateStyle: "long" } as const;
    const presentationDateFormat = { dateStyle: "short" } as const;
    const merged = mergeModelPresentationColumnsForTesting(
      [
        {
          id: "due",
          accessor: () => "2026-01-02",
          value: () => "2026-01-02",
          dateFormat: schemaDateFormat,
        },
      ],
      [
        {
          id: "due",
          header: "Due",
          dateFormat: presentationDateFormat,
        },
      ],
    );

    expect(merged[0]?.dateFormat).toBe(schemaDateFormat);
    expect(merged[0]?.header).toBe("Due");
  });
});

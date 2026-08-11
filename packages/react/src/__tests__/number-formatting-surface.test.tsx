import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PretableGrid } from "@pretable/core";

import type { CopyPayload, SerializeRangesArgs } from "../copy";
import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import type { PretableSurfaceState } from "../use-pretable";

type NumberRow = {
  id: string;
  amount: unknown;
  count?: unknown;
};

const NativeNumberFormat = Intl.NumberFormat;
const oneDecimal: Intl.NumberFormatOptions = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};
const rows: NumberRow[] = [{ id: "row-1", amount: 1234.5, count: 12.5 }];
const getRowId = (row: NumberRow) => row.id;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function getCell(container: HTMLElement, rowId: string, columnId: string) {
  return container.querySelector(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"]`,
  );
}

function spyOnNumberFormatConstruction() {
  const construct = vi.fn(function NumberFormat(
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return new NativeNumberFormat(locales, options);
  });

  vi.spyOn(Intl, "NumberFormat").mockImplementation(
    construct as unknown as Intl.NumberFormatConstructor,
  );
  return construct;
}

function NumberGrid({
  columns,
  locale,
  gridRows = rows,
  state,
  onGridReady,
  onCopy,
}: {
  columns: PretableColumn<NumberRow>[];
  locale?: Intl.LocalesArgument;
  gridRows?: NumberRow[];
  state?: PretableSurfaceState;
  onGridReady?: (grid: PretableGrid<NumberRow>) => void;
  onCopy?: (args: SerializeRangesArgs<NumberRow>) => CopyPayload | null;
}) {
  return (
    <PretableSurface
      ariaLabel="number-grid"
      columns={columns}
      getRowId={getRowId}
      locale={locale}
      onCopy={onCopy}
      onGridReady={onGridReady}
      overscan={0}
      rows={gridRows}
      state={state}
      viewportHeight={132}
    />
  );
}

describe("PretableSurface native number formatting", () => {
  it("formats a numeric cell with an explicit locale and native options", () => {
    const columns: PretableColumn<NumberRow>[] = [
      { id: "amount", widthPx: 120, numberFormat: oneDecimal },
    ];

    const view = render(<NumberGrid columns={columns} locale="en-US" />);

    expect(getCell(view.container, "row-1", "amount")).toHaveTextContent(
      "1,234.5",
    );
  });

  it("passes locale through unchanged to the onCopy override", () => {
    const onCopy = vi.fn((args: SerializeRangesArgs<NumberRow>) => {
      expect(args.locale).toBe("en-US");
      return null;
    });
    const columns: PretableColumn<NumberRow>[] = [
      { id: "amount", widthPx: 120, numberFormat: oneDecimal },
    ];
    const view = render(
      <NumberGrid
        columns={columns}
        locale="en-US"
        onCopy={onCopy}
        state={{
          selection: {
            ranges: [
              {
                startRowId: "row-1",
                endRowId: "row-1",
                startColumnId: "amount",
                endColumnId: "amount",
              },
            ],
            anchor: { rowId: "row-1", columnId: "amount" },
          },
        }}
      />,
    );

    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("does not format a column configured with type number alone", () => {
    const columns: PretableColumn<NumberRow>[] = [
      { id: "amount", widthPx: 120, type: "number" },
    ];

    const view = render(<NumberGrid columns={columns} locale="en-US" />);

    expect(getCell(view.container, "row-1", "amount")).toHaveTextContent(
      "1234.5",
    );
  });

  it("lets column.format win and passes its formattedValue to column.render", () => {
    const renderCell = vi.fn(
      ({ formattedValue }: { formattedValue: string }) => (
        <output data-testid="rendered-number">{formattedValue}</output>
      ),
    );
    const columns: PretableColumn<NumberRow>[] = [
      {
        id: "amount",
        widthPx: 120,
        numberFormat: oneDecimal,
        format: ({ value }) => `custom:${String(value)}`,
        render: renderCell,
      },
    ];

    const view = render(<NumberGrid columns={columns} locale="en-US" />);

    expect(view.getByTestId("rendered-number")).toHaveTextContent(
      "custom:1234.5",
    );
    expect(renderCell).toHaveBeenCalledWith(
      expect.objectContaining({ formattedValue: "custom:1234.5" }),
    );
  });

  it("reformats on locale change without replacing the core grid", () => {
    const columns: PretableColumn<NumberRow>[] = [
      { id: "amount", widthPx: 120, numberFormat: oneDecimal },
    ];
    const onGridReady = vi.fn();
    const view = render(
      <NumberGrid columns={columns} locale="en-US" onGridReady={onGridReady} />,
    );
    const firstGrid = onGridReady.mock.calls[0]?.[0];

    expect(getCell(view.container, "row-1", "amount")).toHaveTextContent(
      "1,234.5",
    );

    view.rerender(
      <NumberGrid columns={columns} locale="de-DE" onGridReady={onGridReady} />,
    );

    expect(getCell(view.container, "row-1", "amount")).toHaveTextContent(
      "1.234,5",
    );
    expect(onGridReady).toHaveBeenCalledTimes(1);
    expect(onGridReady.mock.calls[0]?.[0]).toBe(firstGrid);
  });

  it("does not coerce numeric strings or Decimal-like objects", () => {
    const decimalLike = {
      valueOf: () => 1234.5,
      toString: () => "Decimal(1234.5)",
    };
    const gridRows: NumberRow[] = [
      { id: "string", amount: "1234.5" },
      { id: "decimal", amount: decimalLike },
    ];
    const columns: PretableColumn<NumberRow>[] = [
      { id: "amount", widthPx: 120, numberFormat: oneDecimal },
    ];

    const view = render(
      <NumberGrid columns={columns} gridRows={gridRows} locale="en-US" />,
    );

    expect(getCell(view.container, "string", "amount")).toHaveTextContent(
      "1234.5",
    );
    expect(getCell(view.container, "decimal", "amount")).toHaveTextContent(
      "Decimal(1234.5)",
    );
  });

  it("constructs once per formatted column across row, focus, selection, and scroll changes", () => {
    const construct = spyOnNumberFormatConstruction();
    const countOptions: Intl.NumberFormatOptions = {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    };
    const columns: PretableColumn<NumberRow>[] = [
      { id: "amount", widthPx: 120, numberFormat: oneDecimal },
      { id: "count", widthPx: 120, numberFormat: countOptions },
    ];
    const expandedRows: NumberRow[] = Array.from(
      { length: 10 },
      (_, index) => ({
        id: `row-${index + 1}`,
        amount: 1234.5 + index,
        count: 12.5 + index,
      }),
    );
    const view = render(
      <NumberGrid columns={columns} locale="en-US" state={{}} />,
    );

    expect(construct).toHaveBeenCalledTimes(2);

    view.rerender(
      <NumberGrid
        columns={columns}
        gridRows={expandedRows}
        locale="en-US"
        state={{}}
      />,
    );
    expect(construct).toHaveBeenCalledTimes(2);

    view.rerender(
      <NumberGrid
        columns={columns}
        gridRows={expandedRows}
        locale="en-US"
        state={{ focus: { rowId: "row-1", columnId: "amount" } }}
      />,
    );
    expect(construct).toHaveBeenCalledTimes(2);

    view.rerender(
      <NumberGrid
        columns={columns}
        gridRows={expandedRows}
        locale="en-US"
        state={{
          focus: { rowId: "row-1", columnId: "amount" },
          selection: {
            ranges: [
              {
                startRowId: "row-1",
                endRowId: "row-1",
                startColumnId: "amount",
                endColumnId: "amount",
              },
            ],
            anchor: { rowId: "row-1", columnId: "amount" },
          },
        }}
      />,
    );
    expect(construct).toHaveBeenCalledTimes(2);

    fireEvent.scroll(
      view.container.querySelector("[data-pretable-scroll-viewport]")!,
      { target: { scrollTop: 44 } },
    );
    expect(construct).toHaveBeenCalledTimes(2);
  });

  it("reconstructs only changed options and all columns after locale change", () => {
    const construct = spyOnNumberFormatConstruction();
    const countOptions: Intl.NumberFormatOptions = {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    };
    const columns: PretableColumn<NumberRow>[] = [
      { id: "amount", widthPx: 120, numberFormat: oneDecimal },
      { id: "count", widthPx: 120, numberFormat: countOptions },
    ];
    const view = render(<NumberGrid columns={columns} locale="en-US" />);

    expect(construct).toHaveBeenCalledTimes(2);

    const nextCountOptions: Intl.NumberFormatOptions = {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    };
    const nextColumns: PretableColumn<NumberRow>[] = [
      columns[0]!,
      { ...columns[1]!, numberFormat: nextCountOptions },
    ];
    view.rerender(<NumberGrid columns={nextColumns} locale="en-US" />);
    expect(construct).toHaveBeenCalledTimes(3);

    view.rerender(<NumberGrid columns={nextColumns} locale="de-DE" />);
    expect(construct).toHaveBeenCalledTimes(5);
  });

  it("server-renders and hydrates the same explicit locale without recovery", async () => {
    const columns: PretableColumn<NumberRow>[] = [
      { id: "amount", widthPx: 120, numberFormat: oneDecimal },
    ];
    const grid = <NumberGrid columns={columns} locale="en-US" />;
    vi.stubGlobal("document", undefined);
    let serverMarkup: string;
    try {
      serverMarkup = renderToString(grid);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(serverMarkup!).toContain("1,234.5");

    const recoverableErrors: unknown[] = [];
    let container: HTMLDivElement | undefined;
    let root: Root | undefined;

    try {
      const mountedContainer = document.createElement("div");
      container = mountedContainer;
      document.body.append(mountedContainer);
      mountedContainer.innerHTML = serverMarkup!;

      await act(async () => {
        root = hydrateRoot(mountedContainer, grid, {
          onRecoverableError(error) {
            recoverableErrors.push(error);
          },
        });
      });

      expect(mountedContainer).toHaveTextContent("1,234.5");
      expect(recoverableErrors).toEqual([]);
    } finally {
      try {
        if (root) {
          await act(async () => {
            root!.unmount();
          });
        }
      } finally {
        container?.remove();
      }
    }
  });
});

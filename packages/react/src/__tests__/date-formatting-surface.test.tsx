import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableQueryFor,
} from "@pretable/core";
import { dateValueToUtcMs } from "@pretable-internal/calendar-date";

import {
  PretableSurface,
  type PretableSurfaceQueryColumns,
} from "../pretable-surface";
import type { PretableLocale } from "../locale";
import type { PretableColumn } from "../types";

type DateRow = {
  id: string;
  settlementDate: string | null;
  dueDate: string | null;
  amount: number;
};

const NativeDateTimeFormat = Intl.DateTimeFormat;
const NativeNumberFormat = Intl.NumberFormat;
const mediumDate = { dateStyle: "medium" } as const;
const rows: DateRow[] = [
  {
    id: "later",
    settlementDate: "2026-08-11",
    dueDate: "2026-12-31",
    amount: 1234.5,
  },
  {
    id: "earlier",
    settlementDate: "2025-01-02",
    dueDate: "2025-06-30",
    amount: 5,
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function cell(
  container: HTMLElement,
  rowId: string,
  columnId = "settlementDate",
) {
  return container.querySelector(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"]`,
  );
}

type DateGridProps = {
  columns: readonly PretableColumn<DateRow>[];
  gridRows?: readonly DateRow[];
  locale?: PretableLocale;
} & Pick<
  React.ComponentProps<typeof PretableSurface<DateRow>>,
  "copyToClipboard" | "onGridReady" | "processing" | "state"
> &
  (
    | {
        query: PretableQueryFor<PretableSurfaceQueryColumns<DateRow>>;
        onQueryChange: (
          query: PretableQueryFor<PretableSurfaceQueryColumns<DateRow>>,
        ) => void;
      }
    | { query?: never; onQueryChange?: never }
  );

function DateGrid({
  columns,
  gridRows = rows,
  locale = "en-US",
  ...rest
}: DateGridProps) {
  return (
    <PretableSurface
      ariaLabel="date-grid"
      columns={columns}
      getRowId={(row: DateRow) => row.id}
      locale={locale}
      overscan={0}
      rows={gridRows}
      viewportHeight={180}
      {...rest}
    />
  );
}

describe("PretableSurface native date formatting", () => {
  it("formats canonical strings independently of the column processing type", () => {
    const columns: PretableColumn<DateRow>[] = [
      { id: "settlementDate", widthPx: 160, dateFormat: mediumDate },
    ];
    const view = render(<DateGrid columns={columns} />);

    expect(cell(view.container, "later")).toHaveTextContent("Aug 11, 2026");
    expect(cell(view.container, "earlier")).toHaveTextContent("Jan 2, 2025");
  });

  it("keeps noncanonical raw values visible through the display fallback", () => {
    const columns: PretableColumn<DateRow>[] = [
      { id: "settlementDate", widthPx: 200, dateFormat: mediumDate },
    ];
    const invalidRows = [
      { ...rows[0]!, id: "datetime", settlementDate: "2026-08-11T00:00:00Z" },
      { ...rows[0]!, id: "overflow", settlementDate: "2026-02-30" },
    ] as unknown as DateRow[];
    const view = render(<DateGrid columns={columns} gridRows={invalidRows} />);

    expect(cell(view.container, "datetime")).toHaveTextContent(
      "2026-08-11T00:00:00Z",
    );
    expect(cell(view.container, "overflow")).toHaveTextContent("2026-02-30");
  });

  it("keeps calendar output on the UTC day in a non-UTC process zone", () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const view = render(
        <DateGrid
          columns={[
            {
              id: "settlementDate",
              dateFormat: { dateStyle: "full" },
            },
          ]}
          gridRows={[
            { ...rows[0]!, id: "new-year", settlementDate: "2026-01-01" },
          ]}
        />,
      );

      expect(cell(view.container, "new-year")).toHaveTextContent(
        "Thursday, January 1, 2026",
      );
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });

  it("passes raw values and localized formattedValue to custom renderers", () => {
    const renderCell = vi.fn(
      ({ formattedValue }: { formattedValue: string }) => (
        <output data-testid="rendered-date">{formattedValue}</output>
      ),
    );
    const columns: PretableColumn<DateRow>[] = [
      {
        id: "settlementDate",
        widthPx: 160,
        dateFormat: mediumDate,
        render: renderCell,
      },
    ];
    const view = render(<DateGrid columns={columns} gridRows={[rows[0]!]} />);

    expect(view.getByTestId("rendered-date")).toHaveTextContent("Aug 11, 2026");
    expect(renderCell).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "2026-08-11",
        formattedValue: "Aug 11, 2026",
      }),
    );
  });

  it("lets the format callback outrank native date presentation", () => {
    const columns: PretableColumn<DateRow>[] = [
      {
        id: "settlementDate",
        dateFormat: mediumDate,
        format: ({ value }) => `custom:${String(value)}`,
      },
    ];
    const view = render(<DateGrid columns={columns} gridRows={[rows[0]!]} />);

    expect(cell(view.container, "later")).toHaveTextContent(
      "custom:2026-08-11",
    );
  });

  it("formats schema values in explicit-model mode", () => {
    const helper = createColumnHelper<DateRow>();
    const schema = [
      helper.accessor("settlementDate", {
        type: "date",
        dateFormat: mediumDate,
      }),
    ] as const;
    const model = createLocalRowModel({ rows, columns: schema });

    const view = render(
      <PretableSurface
        ariaLabel="explicit-date-grid"
        locale="en-US"
        model={model}
        viewportHeight={180}
      />,
    );

    expect(cell(view.container, "later")).toHaveTextContent("Aug 11, 2026");
    model.dispose();
  });

  it("preserves external membership and order while formatting locally", () => {
    const columns: PretableColumn<DateRow>[] = [
      {
        id: "settlementDate",
        type: "date",
        dateFormat: mediumDate,
      },
    ];
    const view = render(
      <DateGrid
        columns={columns}
        onQueryChange={() => {}}
        processing={{ filter: "external", sort: "external" }}
        query={{
          sort: [{ columnId: "settlementDate", direction: "asc" }],
          filters: [
            {
              columnId: "settlementDate",
              operator: "after",
              value: "2099-01-01",
            },
          ],
          rowGroups: [],
        }}
      />,
    );

    expect(
      view
        .getAllByTestId("pretable-row")
        .map((row) => row.getAttribute("data-pretable-row-id")),
    ).toEqual(["later", "earlier"]);
    expect(cell(view.container, "later")).toHaveTextContent("Aug 11, 2026");
    expect(
      view.container.querySelector(
        '[data-pretable-column-id="settlementDate"][role="columnheader"]',
      ),
    ).toHaveAttribute("aria-sort", "ascending");
  });

  it("reconciles option and locale identity without per-cell construction", () => {
    const dateConstruct = vi.fn(function DateTimeFormat(
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      return new NativeDateTimeFormat(locales, options);
    });
    const numberConstruct = vi.fn(function NumberFormat(
      locales?: Intl.LocalesArgument,
      options?: Intl.NumberFormatOptions,
    ) {
      return new NativeNumberFormat(locales, options);
    });
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      dateConstruct as unknown as Intl.DateTimeFormatConstructor,
    );
    vi.spyOn(Intl, "NumberFormat").mockImplementation(
      numberConstruct as unknown as Intl.NumberFormatConstructor,
    );
    const dueOptions = { dateStyle: "short" } as const;
    const amountOptions = { maximumFractionDigits: 1 } as const;
    const columns: PretableColumn<DateRow>[] = [
      { id: "settlementDate", dateFormat: mediumDate },
      { id: "dueDate", dateFormat: dueOptions },
      { id: "amount", numberFormat: amountOptions },
    ];
    const view = render(<DateGrid columns={columns} />);
    expect(dateConstruct).toHaveBeenCalledTimes(2);
    expect(numberConstruct).toHaveBeenCalledTimes(1);

    view.rerender(
      <DateGrid
        columns={columns}
        gridRows={[
          ...rows,
          { ...rows[0]!, id: "extra", settlementDate: "2024-12-31" },
        ]}
      />,
    );
    expect(dateConstruct).toHaveBeenCalledTimes(2);
    expect(numberConstruct).toHaveBeenCalledTimes(1);

    const nextColumns: PretableColumn<DateRow>[] = [
      { ...columns[0]!, dateFormat: { dateStyle: "long" } },
      columns[1]!,
      columns[2]!,
    ];
    view.rerender(<DateGrid columns={nextColumns} />);
    expect(dateConstruct).toHaveBeenCalledTimes(3);
    expect(numberConstruct).toHaveBeenCalledTimes(1);

    view.rerender(<DateGrid columns={nextColumns} locale="en-GB" />);
    expect(dateConstruct).toHaveBeenCalledTimes(5);
    expect(numberConstruct).toHaveBeenCalledTimes(2);
  });

  it("updates presentation without changing the row-model snapshot or rows", async () => {
    type SnapshotGrid = {
      rowModel: {
        getState(): { snapshot: { rowAt(index: number): unknown } };
      };
    };
    let grid: SnapshotGrid | null = null;
    const firstColumns: PretableColumn<DateRow>[] = [
      {
        id: "settlementDate",
        type: "date",
        dateFormat: { dateStyle: "medium" },
      },
    ];
    const view = render(
      <DateGrid
        columns={firstColumns}
        gridRows={[rows[0]!]}
        onGridReady={(ready) => {
          grid = ready as unknown as typeof grid;
        }}
      />,
    );
    const readyGrid = grid as unknown as SnapshotGrid;
    const beforeSnapshot = readyGrid.rowModel.getState().snapshot;
    const beforeRow = beforeSnapshot.rowAt(0);

    view.rerender(
      <DateGrid
        columns={[
          {
            ...firstColumns[0]!,
            dateFormat: { dateStyle: "long" },
          },
        ]}
        gridRows={[rows[0]!]}
      />,
    );

    await waitFor(() =>
      expect(cell(view.container, "later")).toHaveTextContent(
        "August 11, 2026",
      ),
    );
    const afterSnapshot = readyGrid.rowModel.getState().snapshot;
    expect(afterSnapshot).toBe(beforeSnapshot);
    expect(afterSnapshot.rowAt(0)).toBe(beforeRow);
  });

  it("reuses the mounted registry for surface-owned copy", () => {
    const construct = vi.fn(function DateTimeFormat(
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      return new NativeDateTimeFormat(locales, options);
    });
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      construct as unknown as Intl.DateTimeFormatConstructor,
    );
    const copyToClipboard = vi.fn();
    const columns: PretableColumn<DateRow>[] = [
      { id: "settlementDate", dateFormat: mediumDate },
    ];
    const view = render(
      <DateGrid
        columns={columns}
        copyToClipboard={copyToClipboard}
        gridRows={[rows[0]!]}
        state={{
          selection: {
            ranges: [
              {
                startRowId: "later",
                endRowId: "later",
                startColumnId: "settlementDate",
                endColumnId: "settlementDate",
              },
            ],
            anchor: { rowId: "later", columnId: "settlementDate" },
          },
        }}
      />,
    );
    expect(construct).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });

    expect(construct).toHaveBeenCalledTimes(1);
    expect(copyToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Aug 11, 2026" }),
    );
  });

  it("hydrates localized UTC presentation without a recoverable mismatch", async () => {
    const columns: PretableColumn<DateRow>[] = [
      { id: "settlementDate", dateFormat: mediumDate },
    ];
    const grid = (
      <DateGrid columns={columns} gridRows={[rows[0]!]} locale="en-US" />
    );
    // Server and client byte equality requires equivalent Intl/ICU locale
    // data. This test deliberately derives the expectation from the same
    // runtime instead of promising one locale string across different ICUs.
    const expected = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(dateValueToUtcMs("2026-08-11"));
    vi.stubGlobal("document", undefined);
    let markup: string;
    try {
      markup = renderToString(grid);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(markup).toContain('data-pretable-hydrated="false"');
    expect(markup).not.toContain("2026-08-11");

    const recoverableErrors: unknown[] = [];
    let container: HTMLDivElement | undefined;
    let root: Root | undefined;
    try {
      container = document.createElement("div");
      document.body.append(container);
      container.innerHTML = markup;
      await act(async () => {
        root = hydrateRoot(container!, grid, {
          onRecoverableError(error) {
            recoverableErrors.push(error);
          },
        });
      });
      await waitFor(() => expect(container).toHaveTextContent(expected));
      expect(recoverableErrors).toEqual([]);
    } finally {
      if (root) await act(async () => root!.unmount());
      container?.remove();
    }
  });
});

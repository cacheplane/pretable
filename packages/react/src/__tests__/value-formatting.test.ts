import * as calendarDate from "@pretable-internal/calendar-date";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PretableColumn } from "../types";
import {
  compileValueFormatters,
  createValueFormatterCache,
  formatAggregateValue,
  formatDataCellValue,
} from "../value-formatting";

vi.mock("@pretable-internal/calendar-date", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@pretable-internal/calendar-date")>();
  return {
    ...actual,
    dateValueToUtcMs: vi.fn(actual.dateValueToUtcMs),
  };
});

type Row = {
  id: string;
  amount: unknown;
  count?: unknown;
  settlementDate?: unknown;
};

const fallback = (value: unknown) =>
  value == null ? "" : `fallback:${String(value)}`;

function makeGroup(aggregates: Record<string, unknown>) {
  return {
    kind: "group",
    id: "group-1",
    groupId: "group-1",
    depth: 0,
    columnId: "category",
    value: "A",
    childCount: 2,
    aggregates,
    expanded: true,
  };
}

describe("native value formatting", () => {
  beforeEach(() => {
    vi.mocked(calendarDate.dateValueToUtcMs).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compiles one native formatter per configured column", () => {
    const constructor = vi.spyOn(Intl, "NumberFormat");

    try {
      const columns: PretableColumn<Row>[] = [
        { id: "label" },
        { id: "amount", numberFormat: { maximumFractionDigits: 2 } },
        { id: "count", numberFormat: { useGrouping: false } },
      ];

      const formatters = compileValueFormatters(columns, "en-US");

      expect(formatters.numbers.size).toBe(2);
      expect(formatters.numbers.get("amount")).toBeInstanceOf(
        Intl.NumberFormat,
      );
      expect(formatters.numbers.get("count")).toBeInstanceOf(Intl.NumberFormat);
      expect(constructor).toHaveBeenCalledTimes(2);
    } finally {
      constructor.mockRestore();
    }
  });

  it("reuses unaffected column formatters during configuration reconciliation", () => {
    const amountOptions: Intl.NumberFormatOptions = {
      maximumFractionDigits: 2,
    };
    const initialCountOptions: Intl.NumberFormatOptions = {
      useGrouping: false,
    };
    const nextCountOptions: Intl.NumberFormatOptions = { useGrouping: true };
    const cache = createValueFormatterCache();
    const constructor = vi.spyOn(Intl, "NumberFormat");

    try {
      const initial = cache.resolve(
        [
          { id: "amount", numberFormat: amountOptions },
          { id: "count", numberFormat: initialCountOptions },
        ],
        "en-US",
      );
      const amountFormatter = initial.numbers.get("amount");
      const countFormatter = initial.numbers.get("count");

      const reconciled = cache.resolve(
        [
          { id: "amount", numberFormat: amountOptions },
          { id: "count", numberFormat: nextCountOptions },
        ],
        "en-US",
      );

      expect(constructor).toHaveBeenCalledTimes(3);
      expect(reconciled.numbers.get("amount")).toBe(amountFormatter);
      expect(reconciled.numbers.get("count")).not.toBe(countFormatter);
    } finally {
      constructor.mockRestore();
    }
  });

  it("adds the column id and native cause to construction failures", () => {
    const invalidOptions = {
      style: "currency",
      currency: "US",
    } as Intl.NumberFormatOptions;

    expect(() =>
      compileValueFormatters(
        [{ id: "amount", numberFormat: invalidOptions }],
        "en-US",
      ),
    ).toThrowError(
      expect.objectContaining({
        message: '[pretable] invalid numberFormat for column "amount"',
        cause: expect.any(RangeError),
      }),
    );
  });

  it("lets a data-cell format callback outrank numberFormat", () => {
    const row: Row = { id: "row-1", amount: -12 };
    const column: PretableColumn<Row> = {
      id: "amount",
      numberFormat: {
        style: "currency",
        currency: "USD",
        currencySign: "accounting",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
      format: ({ value }) => `custom:${String(value)}`,
    };
    const formatters = compileValueFormatters([column], "en-US");

    expect(
      formatDataCellValue({
        value: -12,
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("custom:-12");
  });

  it("formats only number and bigint values without coercion", () => {
    const column: PretableColumn<Row> = {
      id: "amount",
      numberFormat: {
        style: "currency",
        currency: "USD",
        currencySign: "accounting",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    };
    const row: Row = { id: "row-1", amount: -12 };
    const formatters = compileValueFormatters([column], "en-US");

    expect(
      formatDataCellValue({
        value: -12,
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("($12.00)");
    expect(
      formatDataCellValue({
        value: BigInt(12),
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("$12.00");
    expect(
      formatDataCellValue({
        value: "-12",
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("fallback:-12");
  });

  it("leaves nullish values blank and non-numbers on supplied fallback", () => {
    const column: PretableColumn<Row> = {
      id: "amount",
      numberFormat: { maximumFractionDigits: 2 },
    };
    const row: Row = { id: "row-1", amount: null };
    const formatters = compileValueFormatters([column], "en-US");

    expect(
      formatDataCellValue({
        value: null,
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("");
    expect(
      formatDataCellValue({
        value: undefined,
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("");
    expect(
      formatDataCellValue({
        value: false,
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("fallback:false");
    expect(
      formatDataCellValue({
        value: { amount: 12 },
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("fallback:[object Object]");
  });

  it("passes NaN and infinities to native Intl", () => {
    const column: PretableColumn<Row> = {
      id: "amount",
      numberFormat: { signDisplay: "always" },
    };
    const row: Row = { id: "row-1", amount: Number.NaN };
    const formatters = compileValueFormatters([column], "en-US");

    expect(
      formatDataCellValue({
        value: Number.NaN,
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("+NaN");
    expect(
      formatDataCellValue({
        value: Number.POSITIVE_INFINITY,
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("+∞");
    expect(
      formatDataCellValue({
        value: Number.NEGATIVE_INFINITY,
        row,
        column,
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("-∞");
  });

  it("lets formatAggregate outrank inherited numberFormat", () => {
    const group = makeGroup({ amount: -12 });
    const column: PretableColumn<Row> = {
      id: "amount",
      numberFormat: {
        style: "currency",
        currency: "USD",
        currencySign: "accounting",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
      formatAggregate: ({ value, scope }) =>
        `aggregate:${String(value)}:${scope}`,
    };
    const formatters = compileValueFormatters([column], "en-US");

    expect(
      formatAggregateValue({
        column,
        group,
        scope: "loaded",
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("aggregate:-12:loaded");
  });

  it("never calls the data-row format callback for an aggregate", () => {
    const dataFormat = vi.fn(() => "data");
    const group = makeGroup({ amount: -12 });
    const column: PretableColumn<Row> = {
      id: "amount",
      numberFormat: {
        style: "currency",
        currency: "USD",
        currencySign: "accounting",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
      format: dataFormat,
    };
    const formatters = compileValueFormatters([column], "en-US");

    expect(
      formatAggregateValue({
        column,
        group,
        scope: "all",
        valueFormatters: formatters,
        fallback,
      }),
    ).toBe("($12.00)");
    expect(dataFormat).not.toHaveBeenCalled();
  });

  it("compiles number and date formatters into one registry", () => {
    const formatters = compileValueFormatters(
      [
        { id: "amount", numberFormat: { maximumFractionDigits: 1 } },
        { id: "settlementDate", dateFormat: { dateStyle: "medium" } },
      ],
      "en-US",
    );

    expect(formatters.numbers.get("amount")).toBeInstanceOf(Intl.NumberFormat);
    expect(formatters.dates.get("settlementDate")).toBeInstanceOf(
      Intl.DateTimeFormat,
    );
  });

  it("reconciles both formatter kinds as one coherent cache", () => {
    const numberConstructor = vi.spyOn(Intl, "NumberFormat");
    const dateConstructor = vi.spyOn(Intl, "DateTimeFormat");
    const amountOptions = { maximumFractionDigits: 2 } as const;
    const firstDateOptions = { dateStyle: "medium" } as const;
    const nextDateOptions = { dateStyle: "long" } as const;
    const cache = createValueFormatterCache();

    const first = cache.resolve(
      [
        { id: "amount", numberFormat: amountOptions },
        { id: "settlementDate", dateFormat: firstDateOptions },
      ],
      "en-US",
    );
    const changedDate = cache.resolve(
      [
        { id: "settlementDate", dateFormat: nextDateOptions },
        { id: "amount", numberFormat: amountOptions },
      ],
      "en-US",
    );
    const changedLocale = cache.resolve(
      [
        { id: "amount", numberFormat: amountOptions },
        { id: "settlementDate", dateFormat: nextDateOptions },
      ],
      "en-GB",
    );
    const removed = cache.resolve(
      [{ id: "settlementDate", dateFormat: nextDateOptions }],
      "en-GB",
    );

    expect(changedDate.numbers.get("amount")).toBe(first.numbers.get("amount"));
    expect(changedDate.dates.get("settlementDate")).not.toBe(
      first.dates.get("settlementDate"),
    );
    expect(changedLocale.numbers.get("amount")).not.toBe(
      changedDate.numbers.get("amount"),
    );
    expect(changedLocale.dates.get("settlementDate")).not.toBe(
      changedDate.dates.get("settlementDate"),
    );
    expect(removed.numbers.size).toBe(0);
    expect(removed.dates.get("settlementDate")).toBe(
      changedLocale.dates.get("settlementDate"),
    );
    expect(numberConstructor).toHaveBeenCalledTimes(2);
    expect(dateConstructor).toHaveBeenCalledTimes(3);
  });

  it("applies format, date, number, then fallback precedence to data cells", () => {
    const row: Row = {
      id: "row-1",
      amount: 12,
      settlementDate: "2026-08-11",
    };
    const column: PretableColumn<Row> = {
      id: "settlementDate",
      dateFormat: { dateStyle: "medium" },
      numberFormat: { minimumFractionDigits: 1 },
    };
    const valueFormatters = compileValueFormatters([column], "en-US");

    expect(
      formatDataCellValue({
        value: "2026-08-11",
        row,
        column,
        valueFormatters,
        fallback,
      }),
    ).toBe("Aug 11, 2026");
    expect(calendarDate.dateValueToUtcMs).toHaveBeenCalledTimes(1);

    expect(
      formatDataCellValue({
        value: 12,
        row,
        column,
        valueFormatters,
        fallback,
      }),
    ).toBe("12.0");
    expect(
      formatDataCellValue({
        value: "2026-02-30",
        row,
        column,
        valueFormatters,
        fallback,
      }),
    ).toBe("fallback:2026-02-30");
    const instant = new Date("2026-08-11T00:00:00Z");
    expect(
      formatDataCellValue({
        value: instant,
        row,
        column,
        valueFormatters,
        fallback,
      }),
    ).toBe(`fallback:${String(instant)}`);

    const callbackColumn: PretableColumn<Row> = {
      ...column,
      format: ({ value }) => `custom:${String(value)}`,
    };
    expect(
      formatDataCellValue({
        value: "2026-08-11",
        row,
        column: callbackColumn,
        valueFormatters,
        fallback,
      }),
    ).toBe("custom:2026-08-11");
    expect(calendarDate.dateValueToUtcMs).toHaveBeenCalledTimes(2);
  });

  it("date-formats canonical extrema and number-formats numeric counts", () => {
    const column: PretableColumn<Row> = {
      id: "settlementDate",
      dateFormat: { dateStyle: "medium" },
      numberFormat: { minimumIntegerDigits: 2 },
    };
    const valueFormatters = compileValueFormatters([column], "en-US");

    expect(
      formatAggregateValue({
        column,
        group: makeGroup({ settlementDate: "2026-08-11" }),
        scope: "all",
        valueFormatters,
        fallback,
      }),
    ).toBe("Aug 11, 2026");
    expect(
      formatAggregateValue({
        column,
        group: makeGroup({ settlementDate: 2 }),
        scope: "all",
        valueFormatters,
        fallback,
      }),
    ).toBe("02");
    expect(
      formatAggregateValue({
        column,
        group: makeGroup({ settlementDate: "not-a-date" }),
        scope: "all",
        valueFormatters,
        fallback,
      }),
    ).toBe("fallback:not-a-date");

    const callbackColumn: PretableColumn<Row> = {
      ...column,
      formatAggregate: ({ value }) => `aggregate:${String(value)}`,
    };
    expect(
      formatAggregateValue({
        column: callbackColumn,
        group: makeGroup({ settlementDate: "2026-08-11" }),
        scope: "loaded",
        valueFormatters,
        fallback,
      }),
    ).toBe("aggregate:2026-08-11");
  });
});

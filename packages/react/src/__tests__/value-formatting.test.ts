import { describe, expect, it, vi } from "vitest";

import type { PretableGroupRow } from "@pretable/core";
import type { PretableColumn } from "../types";
import {
  compileNumberFormatters,
  createNumberFormatterCache,
  formatAggregateValue,
  formatDataCellValue,
} from "../value-formatting";

type Row = { id: string; amount: unknown; count?: unknown };

const fallback = (value: unknown) =>
  value == null ? "" : `fallback:${String(value)}`;

function makeGroup(aggregates: Record<string, unknown>): PretableGroupRow {
  return {
    kind: "group",
    id: "group-1",
    depth: 0,
    columnId: "category",
    value: "A",
    childCount: 2,
    aggregates,
  };
}

describe("native value formatting", () => {
  it("compiles one native formatter per configured column", () => {
    const constructor = vi.spyOn(Intl, "NumberFormat");

    try {
      const columns: PretableColumn<Row>[] = [
        { id: "label" },
        { id: "amount", numberFormat: { maximumFractionDigits: 2 } },
        { id: "count", numberFormat: { useGrouping: false } },
      ];

      const formatters = compileNumberFormatters(columns, "en-US");

      expect(formatters.size).toBe(2);
      expect(formatters.get("amount")).toBeInstanceOf(Intl.NumberFormat);
      expect(formatters.get("count")).toBeInstanceOf(Intl.NumberFormat);
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
    const cache = createNumberFormatterCache();
    const constructor = vi.spyOn(Intl, "NumberFormat");

    try {
      const initial = cache.resolve(
        [
          { id: "amount", numberFormat: amountOptions },
          { id: "count", numberFormat: initialCountOptions },
        ],
        "en-US",
      );
      const amountFormatter = initial.get("amount");
      const countFormatter = initial.get("count");

      const reconciled = cache.resolve(
        [
          { id: "amount", numberFormat: amountOptions },
          { id: "count", numberFormat: nextCountOptions },
        ],
        "en-US",
      );

      expect(constructor).toHaveBeenCalledTimes(3);
      expect(reconciled.get("amount")).toBe(amountFormatter);
      expect(reconciled.get("count")).not.toBe(countFormatter);
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
      compileNumberFormatters(
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
    const formatters = compileNumberFormatters([column], "en-US");

    expect(formatDataCellValue(column, row, -12, formatters, fallback)).toBe(
      "custom:-12",
    );
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
    const formatters = compileNumberFormatters([column], "en-US");

    expect(formatDataCellValue(column, row, -12, formatters, fallback)).toBe(
      "($12.00)",
    );
    expect(
      formatDataCellValue(column, row, BigInt(12), formatters, fallback),
    ).toBe("$12.00");
    expect(formatDataCellValue(column, row, "-12", formatters, fallback)).toBe(
      "fallback:-12",
    );
  });

  it("leaves nullish values blank and non-numbers on supplied fallback", () => {
    const column: PretableColumn<Row> = {
      id: "amount",
      numberFormat: { maximumFractionDigits: 2 },
    };
    const row: Row = { id: "row-1", amount: null };
    const formatters = compileNumberFormatters([column], "en-US");

    expect(formatDataCellValue(column, row, null, formatters, fallback)).toBe(
      "",
    );
    expect(
      formatDataCellValue(column, row, undefined, formatters, fallback),
    ).toBe("");
    expect(formatDataCellValue(column, row, false, formatters, fallback)).toBe(
      "fallback:false",
    );
    expect(
      formatDataCellValue(column, row, { amount: 12 }, formatters, fallback),
    ).toBe("fallback:[object Object]");
  });

  it("passes NaN and infinities to native Intl", () => {
    const column: PretableColumn<Row> = {
      id: "amount",
      numberFormat: { signDisplay: "always" },
    };
    const row: Row = { id: "row-1", amount: Number.NaN };
    const formatters = compileNumberFormatters([column], "en-US");

    expect(
      formatDataCellValue(column, row, Number.NaN, formatters, fallback),
    ).toBe("+NaN");
    expect(
      formatDataCellValue(
        column,
        row,
        Number.POSITIVE_INFINITY,
        formatters,
        fallback,
      ),
    ).toBe("+∞");
    expect(
      formatDataCellValue(
        column,
        row,
        Number.NEGATIVE_INFINITY,
        formatters,
        fallback,
      ),
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
    const formatters = compileNumberFormatters([column], "en-US");

    expect(
      formatAggregateValue(column, group, "loaded", formatters, fallback),
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
    const formatters = compileNumberFormatters([column], "en-US");

    expect(
      formatAggregateValue(column, group, "all", formatters, fallback),
    ).toBe("($12.00)");
    expect(dataFormat).not.toHaveBeenCalled();
  });
});

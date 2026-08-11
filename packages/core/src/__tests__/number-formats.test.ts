import { describe, expect, it } from "vitest";

import {
  createGrid,
  numberFormats,
  type PretableColumn,
  type PretableCurrencyFormatOptions,
} from "../index";

describe("numberFormats", () => {
  it("creates a plain money format with standard currency presentation", () => {
    const format = numberFormats.money({
      currency: "JPY",
      currencyDisplay: "code",
    });

    expect(Object.getPrototypeOf(format)).toBe(Object.prototype);
    expect(format).toEqual({
      currencyDisplay: "code",
      style: "currency",
      currency: "JPY",
      currencySign: "standard",
    });
    expect(format).not.toHaveProperty("minimumFractionDigits");
    expect(format).not.toHaveProperty("maximumFractionDigits");
  });

  it("creates an accounting format while preserving caller options", () => {
    expect(
      numberFormats.accounting({
        currency: "USD",
        maximumFractionDigits: 2,
      }),
    ).toEqual({
      maximumFractionDigits: 2,
      style: "currency",
      currency: "USD",
      currencySign: "accounting",
    });
  });

  it("does not let unsafe input override money preset options", () => {
    const unsafeOptions = {
      currency: "EUR",
      style: "decimal",
      currencySign: "accounting",
    } as PretableCurrencyFormatOptions;

    expect(numberFormats.money(unsafeOptions)).toMatchObject({
      style: "currency",
      currency: "EUR",
      currencySign: "standard",
    });
  });

  it("is valid PretableColumn numberFormat configuration", () => {
    const column: PretableColumn = {
      id: "amount",
      numberFormat: numberFormats.money({ currency: "USD" }),
    };

    expect(column.numberFormat).toEqual({
      style: "currency",
      currency: "USD",
      currencySign: "standard",
    });
  });

  it("keeps transaction updates raw when a column has numberFormat", () => {
    const grid = createGrid({
      columns: [
        {
          id: "amount",
          numberFormat: numberFormats.money({ currency: "USD" }),
        },
      ],
      rows: [{ id: "row-1", amount: 1 }],
      getRowId: (row) => row.id,
    });

    grid.applyTransaction({ update: [{ id: "row-1", amount: 7.5 }] });

    const visibleRow = grid.getSnapshot().visibleRows[0];
    expect(visibleRow?.kind).toBe("data");
    if (visibleRow?.kind === "data") {
      expect(visibleRow.row.amount).toBe(7.5);
      expect(typeof visibleRow.row.amount).toBe("number");
    }
  });

  it("keeps preset-defining options out of the public option type", () => {
    numberFormats.money({
      currency: "USD",
      // @ts-expect-error money defines the Intl style.
      style: "decimal",
    });
    numberFormats.accounting({
      currency: "USD",
      // @ts-expect-error accounting defines the currency sign.
      currencySign: "standard",
    });
  });
});

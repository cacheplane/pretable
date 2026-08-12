import { describe, expect, it } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
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
    interface Row {
      readonly id: string;
      readonly amount: number;
    }
    const helper = createColumnHelper<Row>();
    const model = createLocalRowModel({
      columns: [helper.accessor("amount", { type: "number" })] as const,
      rows: [{ id: "row-1", amount: 1 }],
    });

    model.applyTransaction({
      update: [{ id: "row-1", changes: { amount: 7.5 } }],
    });

    const row = model.getState().snapshot.dataRowAt(0)?.row;
    expect(row?.amount).toBe(7.5);
    expect(typeof row?.amount).toBe("number");

    model.dispose();
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

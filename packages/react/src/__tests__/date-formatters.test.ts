import { dateValueToUtcMs } from "@pretable-internal/calendar-date";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  reconcileDateFormatters,
  type DateFormatterCacheState,
} from "../date-formatters";
import type { PretableColumn } from "../types";

type Row = { id: string; due: string | null };

function reconcile(
  previous: DateFormatterCacheState | undefined,
  columns: readonly PretableColumn<Row>[],
  locale?: Intl.LocalesArgument,
) {
  return reconcileDateFormatters(previous, columns, locale);
}

function expectInvalidOption(
  options: object,
  expectedOption: PropertyKey,
): void {
  expect(() =>
    reconcile(
      undefined,
      [
        {
          id: "due",
          dateFormat: options,
        } as PretableColumn<Row>,
      ],
      "en-US",
    ),
  ).toThrowError(
    expect.objectContaining({
      message: '[pretable] invalid dateFormat for column "due"',
      cause: expect.objectContaining({
        message: expect.stringContaining(String(expectedOption)),
      }),
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("native date formatter reconciliation", () => {
  it("formats dateStyle and granular fields for en-US and en-GB", () => {
    const dateStyle = { dateStyle: "long" } as const;
    const granular = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    } as const;
    const columns: PretableColumn<Row>[] = [
      { id: "due", dateFormat: dateStyle },
      { id: "settled", dateFormat: granular },
    ];
    const instant = dateValueToUtcMs("2026-01-02");

    const us = reconcile(undefined, columns, "en-US").formatters;
    const gb = reconcile(undefined, columns, "en-GB").formatters;

    expect(us.get("due")?.format(instant)).toBe("January 2, 2026");
    expect(gb.get("due")?.format(instant)).toBe("2 January 2026");
    expect(us.get("settled")?.format(instant)).toBe("01/02/2026");
    expect(gb.get("settled")?.format(instant)).toBe("02/01/2026");
  });

  it("forces UTC even when the process uses a non-UTC time zone", () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";

    try {
      const formatter = reconcile(
        undefined,
        [{ id: "due", dateFormat: { dateStyle: "full" } }],
        "en-US",
      ).formatters.get("due");

      expect(formatter?.resolvedOptions().timeZone).toBe("UTC");
      expect(formatter?.format(dateValueToUtcMs("2026-01-01"))).toBe(
        "Thursday, January 1, 2026",
      );
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });

  it("retains allowed calendar and numbering-system options", () => {
    const formatter = reconcile(
      undefined,
      [
        {
          id: "due",
          dateFormat: {
            calendar: "gregory",
            numberingSystem: "latn",
            year: "numeric",
            month: "long",
            day: "numeric",
          },
        },
      ],
      "en-US",
    ).formatters.get("due");

    expect(formatter?.resolvedOptions()).toMatchObject({
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "UTC",
    });
    expect(formatter?.format(dateValueToUtcMs("2026-01-02"))).toBe(
      "January 2, 2026",
    );
  });

  it("passes year 0000 to native locale presentation without literal assumptions", () => {
    const formatter = reconcile(
      undefined,
      [
        {
          id: "due",
          dateFormat: {
            era: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
          },
        },
      ],
      "en-US",
    ).formatters.get("due");
    const expected = new Intl.DateTimeFormat("en-US", {
      era: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(dateValueToUtcMs("0000-01-01"));

    expect(formatter?.format(dateValueToUtcMs("0000-01-01"))).toBe(expected);
    expect(expected).toMatch(/BC|BCE/);
  });

  it("wraps native-invalid combinations with column context and cause", () => {
    expect(() =>
      reconcile(
        undefined,
        [
          {
            id: "due",
            dateFormat: {
              dateStyle: "long",
              year: "numeric",
            },
          },
        ],
        "en-US",
      ),
    ).toThrowError(
      expect.objectContaining({
        message: '[pretable] invalid dateFormat for column "due"',
        cause: expect.any(Error),
      }),
    );
  });

  it("rejects enumerable and non-enumerable unknown own string keys", () => {
    expectInvalidOption({ unknown: undefined }, "unknown");

    const hidden = Object.defineProperty({}, "hidden", {
      configurable: true,
      value: undefined,
    });
    expectInvalidOption(hidden, "hidden");
  });

  it("rejects forbidden own keys even when their value is undefined", () => {
    expectInvalidOption({ timeZone: undefined }, "timeZone");
    expectInvalidOption({ hour: undefined }, "hour");
  });

  it("rejects every symbol own key", () => {
    const option = Symbol("calendar-option");
    expectInvalidOption({ [option]: undefined }, option);
  });

  it("reuses stable formatters and rebuilds only a changed options identity", () => {
    const constructor = vi.spyOn(Intl, "DateTimeFormat");
    const dueOptions = { dateStyle: "long" } as const;
    const settledOptions = { dateStyle: "short" } as const;
    const structurallyEqualSettledOptions = { dateStyle: "short" } as const;
    const first = reconcile(
      undefined,
      [
        { id: "due", dateFormat: dueOptions },
        { id: "settled", dateFormat: settledOptions },
      ],
      "en-US",
    );
    const second = reconcile(
      first,
      [
        { id: "due", dateFormat: dueOptions },
        { id: "settled", dateFormat: structurallyEqualSettledOptions },
      ],
      "en-US",
    );

    expect(constructor).toHaveBeenCalledTimes(3);
    expect(second.formatters.get("due")).toBe(first.formatters.get("due"));
    expect(second.formatters.get("settled")).not.toBe(
      first.formatters.get("settled"),
    );
  });

  it("uses locale identity and rebuilds every formatter when it changes", () => {
    const constructor = vi.spyOn(Intl, "DateTimeFormat");
    const locale = ["en-US"];
    const options = { dateStyle: "long" } as const;
    const first = reconcile(
      undefined,
      [
        { id: "due", dateFormat: options },
        { id: "settled", dateFormat: options },
      ],
      locale,
    );
    const sameLocale = reconcile(
      first,
      [
        { id: "due", dateFormat: options },
        { id: "settled", dateFormat: options },
      ],
      locale,
    );
    const equalButDistinctLocale = reconcile(
      sameLocale,
      [
        { id: "due", dateFormat: options },
        { id: "settled", dateFormat: options },
      ],
      ["en-US"],
    );

    expect(constructor).toHaveBeenCalledTimes(4);
    expect(sameLocale.formatters.get("due")).toBe(first.formatters.get("due"));
    expect(equalButDistinctLocale.formatters.get("due")).not.toBe(
      first.formatters.get("due"),
    );
  });

  it("keeps the registry coherent across reorder and removal", () => {
    const dueOptions = { dateStyle: "long" } as const;
    const settledOptions = { dateStyle: "short" } as const;
    const first = reconcile(
      undefined,
      [
        { id: "due", dateFormat: dueOptions },
        { id: "settled", dateFormat: settledOptions },
      ],
      "en-US",
    );
    const reordered = reconcile(
      first,
      [
        { id: "settled", dateFormat: settledOptions },
        { id: "due", dateFormat: dueOptions },
      ],
      "en-US",
    );
    const removed = reconcile(
      reordered,
      [{ id: "settled", dateFormat: settledOptions }],
      "en-US",
    );

    expect(reordered.formatters.get("due")).toBe(first.formatters.get("due"));
    expect(reordered.formatters.get("settled")).toBe(
      first.formatters.get("settled"),
    );
    expect(removed.formatters.size).toBe(1);
    expect(removed.formatters.has("due")).toBe(false);
    expect(removed.optionsByColumnId.has("due")).toBe(false);
    expect(removed.formatters.get("settled")).toBe(
      first.formatters.get("settled"),
    );
  });
});

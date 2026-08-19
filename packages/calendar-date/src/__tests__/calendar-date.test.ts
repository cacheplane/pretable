import { readFileSync } from "node:fs";

import * as fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  MAX_DATE_VALUE,
  MIN_DATE_VALUE,
  addDateValueDays,
  addDateValueMonths,
  compareDateValues,
  dateValueToUtcMs,
  isValidDateValue,
  parseDateValue,
} from "../calendar-date";

const MS_PER_DAY = 86_400_000;
const DAYS_PER_GREGORIAN_CYCLE = 146_097;

const isLeapYear = (year: number) =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysInMonth = (year: number, month: number) => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
};

const formatDateValue = (year: number, month: number, day: number) =>
  `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

const referenceUtcMs = (year: number, month: number, day: number) =>
  year < 100
    ? Date.UTC(year + 400, month - 1, day) -
      DAYS_PER_GREGORIAN_CYCLE * MS_PER_DAY
    : Date.UTC(year, month - 1, day);

const validDateValueArbitrary = fc
  .integer({ min: 0, max: 9_999 })
  .chain((year) =>
    fc
      .integer({ min: 1, max: 12 })
      .chain((month) =>
        fc
          .integer({ min: 1, max: daysInMonth(year, month) })
          .map((day) => formatDateValue(year, month, day)),
      ),
  );

const revokedProxy = (() => {
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();
  return revocable.proxy;
})();

describe("calendar-date constants and validation", () => {
  test("defines the complete supported range", () => {
    expect(MIN_DATE_VALUE).toBe("0000-01-01");
    expect(MAX_DATE_VALUE).toBe("9999-12-31");
  });

  test.each([
    ["0000-02-29", { year: 0, month: 2, day: 29 }],
    ["0001-01-01", { year: 1, month: 1, day: 1 }],
    ["0050-06-15", { year: 50, month: 6, day: 15 }],
    ["0099-12-31", { year: 99, month: 12, day: 31 }],
    ["0100-03-01", { year: 100, month: 3, day: 1 }],
    ["2000-02-29", { year: 2000, month: 2, day: 29 }],
    ["2024-02-29", { year: 2024, month: 2, day: 29 }],
    ["9999-12-31", { year: 9999, month: 12, day: 31 }],
  ] as const)("accepts and parses %s", (value, expected) => {
    expect(isValidDateValue(value)).toBe(true);
    expect(parseDateValue(value)).toEqual(expected);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["leading whitespace", " 2024-02-29"],
    ["trailing whitespace", "2024-02-29 "],
    ["loose month", "2024-2-29"],
    ["loose day", "2024-02-9"],
    ["five-digit year", "02024-02-29"],
    ["month zero", "2024-00-01"],
    ["month overflow", "2024-13-01"],
    ["day zero", "2024-01-00"],
    ["day overflow", "2024-01-32"],
    ["common-year leap day", "2026-02-29"],
    ["century non-leap day", "0100-02-29"],
    ["April overflow", "2024-04-31"],
    ["date-time", "2024-02-29T00:00:00"],
    ["UTC date-time", "2024-02-29T00:00:00Z"],
    ["offset date-time", "2024-02-29T00:00:00-08:00"],
    ["Date instance", new Date("2024-02-29T00:00:00Z")],
    ["finite number", 20240229],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["array", ["2024-02-29"]],
    ["object", { value: "2024-02-29" }],
    ["boxed string", new String("2024-02-29")],
    [
      "hostile proxy",
      new Proxy(
        {},
        {
          get() {
            throw new Error("must not inspect objects");
          },
          getPrototypeOf() {
            throw new Error("must not inspect prototypes");
          },
          ownKeys() {
            throw new Error("must not inspect keys");
          },
        },
      ),
    ],
    ["revoked proxy", revokedProxy],
  ] as const)("rejects %s without coercion", (_label, value) => {
    expect(() => isValidDateValue(value)).not.toThrow();
    expect(isValidDateValue(value)).toBe(false);
    expect(parseDateValue(value)).toBeNull();
  });

  test("uses explicit parsing rather than Date.parse", () => {
    const source = readFileSync(
      new URL("../calendar-date.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("Date.parse");
  });

  test("round-trips parsed dates across the supported domain", () => {
    fc.assert(
      fc.property(validDateValueArbitrary, (value) => {
        const parsed = parseDateValue(value);
        expect(parsed).not.toBeNull();
        expect(formatDateValue(parsed!.year, parsed!.month, parsed!.day)).toBe(
          value,
        );
      }),
      { numRuns: 500 },
    );
  });

  test("applies Gregorian validity to every four-digit year", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9_999 }),
        fc.integer({ min: 0, max: 13 }),
        fc.integer({ min: 0, max: 32 }),
        (year, month, day) => {
          const value = formatDateValue(year, month, day);
          const expected =
            month >= 1 &&
            month <= 12 &&
            day >= 1 &&
            day <= daysInMonth(year, month);

          expect(isValidDateValue(value)).toBe(expected);
        },
      ),
      { numRuns: 1_000 },
    );
  });
});

describe("calendar-date conversion and comparison", () => {
  test.each([
    ["0000-01-01", "0000-01-01T00:00:00.000Z"],
    ["0001-01-01", "0001-01-01T00:00:00.000Z"],
    ["0050-01-01", "0050-01-01T00:00:00.000Z"],
    ["0099-12-31", "0099-12-31T00:00:00.000Z"],
    ["0100-01-01", "0100-01-01T00:00:00.000Z"],
    ["9999-12-31", "9999-12-31T00:00:00.000Z"],
  ] as const)("converts %s to UTC midnight", (value, expected) => {
    expect(new Date(dateValueToUtcMs(value)).toISOString()).toBe(expected);
  });

  test("returns NaN instead of coercing invalid runtime input", () => {
    for (const value of [
      "2026-02-30",
      "2026-01-01T00:00:00Z",
      new Date("2026-01-01T00:00:00Z"),
      0,
      null,
    ]) {
      expect(dateValueToUtcMs(value as unknown as string)).toBe(Number.NaN);
    }
  });

  test.each([
    ["2026-01-02", "2026-02-01", -1],
    ["2026-02-01", "2026-01-02", 1],
    ["0050-01-01", "0050-01-01", 0],
  ] as const)("compares %s with %s", (left, right, expectedSign) => {
    expect(Math.sign(compareDateValues(left, right))).toBe(expectedSign);
  });

  test("keeps comparison antisymmetric and transitive", () => {
    fc.assert(
      fc.property(
        validDateValueArbitrary,
        validDateValueArbitrary,
        validDateValueArbitrary,
        (a, b, c) => {
          expect(Math.sign(compareDateValues(a, b))).toBe(
            -Math.sign(compareDateValues(b, a)),
          );
          if (compareDateValues(a, b) <= 0 && compareDateValues(b, c) <= 0) {
            expect(compareDateValues(a, c)).toBeLessThanOrEqual(0);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("calendar-date arithmetic", () => {
  test.each([
    ["0000-01-01", -1, "0000-01-01"],
    ["0000-01-01", 0, "0000-01-01"],
    ["0000-02-28", 1, "0000-02-29"],
    ["0000-02-29", 1, "0000-03-01"],
    ["0099-12-31", 1, "0100-01-01"],
    ["2024-02-28", 1, "2024-02-29"],
    ["2024-02-29", 1, "2024-03-01"],
    ["9999-12-31", 1, "9999-12-31"],
  ] as const)("adds %i days to %s", (value, days, expected) => {
    expect(addDateValueDays(value, days)).toBe(expected);
  });

  test.each([
    ["0000-01-01", -1, "0000-01-01"],
    ["0000-02-15", -2, "0000-01-01"],
    ["0000-02-29", 12, "0001-02-28"],
    ["0099-12-31", 1, "0100-01-31"],
    ["2024-01-31", 1, "2024-02-29"],
    ["2024-03-31", -1, "2024-02-29"],
    ["2024-12-31", 2, "2025-02-28"],
    ["9999-11-15", 2, "9999-12-31"],
    ["9999-12-31", 1, "9999-12-31"],
  ] as const)("adds %i months to %s", (value, months, expected) => {
    expect(addDateValueMonths(value, months)).toBe(expected);
  });

  test("matches bounded UTC day arithmetic without leaving the domain", () => {
    const minimumMs = referenceUtcMs(0, 1, 1);
    const maximumMs = referenceUtcMs(9_999, 12, 31);

    fc.assert(
      fc.property(
        validDateValueArbitrary,
        fc.integer({ min: -5_000_000, max: 5_000_000 }),
        (value, days) => {
          const result = addDateValueDays(value, days);
          const expectedMs = Math.min(
            maximumMs,
            Math.max(minimumMs, dateValueToUtcMs(value) + days * MS_PER_DAY),
          );

          expect(isValidDateValue(result)).toBe(true);
          expect(dateValueToUtcMs(result)).toBe(expectedMs);
        },
      ),
      { numRuns: 500 },
    );
  });

  test("matches bounded calendar-month arithmetic and clamps the day", () => {
    fc.assert(
      fc.property(
        validDateValueArbitrary,
        fc.integer({ min: -200_000, max: 200_000 }),
        (value, months) => {
          const parsed = parseDateValue(value)!;
          const sourceMonthIndex = parsed.year * 12 + parsed.month - 1;
          const unboundedMonthIndex = sourceMonthIndex + months;
          const expected =
            unboundedMonthIndex < 0
              ? MIN_DATE_VALUE
              : unboundedMonthIndex > 9_999 * 12 + 11
                ? MAX_DATE_VALUE
                : (() => {
                    const year = Math.floor(unboundedMonthIndex / 12);
                    const month = (unboundedMonthIndex % 12) + 1;
                    const day = Math.min(parsed.day, daysInMonth(year, month));
                    return formatDateValue(year, month, day);
                  })();
          const result = addDateValueMonths(value, months);

          expect(isValidDateValue(result)).toBe(true);
          expect(result).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });
});

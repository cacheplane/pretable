import { describe, expect, it } from "vitest";

import {
  addDaysIso,
  addMonthsIso,
  isValidIsoDate,
  monthLabel,
  monthMatrix,
  toIsoDate,
} from "../editors/date-utils";

describe("date-utils", () => {
  it("validates strict yyyy-mm-dd only", () => {
    expect(isValidIsoDate("2026-08-06")).toBe(true);
    expect(isValidIsoDate("2026-8-6")).toBe(false); // not zero-padded
    expect(isValidIsoDate("08/06/2026")).toBe(false); // locale format
    expect(isValidIsoDate("nope")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });

  it("rejects calendar overflow instead of rolling forward", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
    expect(isValidIsoDate("2026-02-29")).toBe(false);
  });

  it("normalises cell values of every shape to ISO", () => {
    expect(toIsoDate("2026-08-06")).toBe("2026-08-06");
    expect(toIsoDate(new Date(Date.UTC(2026, 7, 6)))).toBe("2026-08-06");
    expect(toIsoDate(Date.UTC(2026, 7, 6))).toBe("2026-08-06");
    expect(toIsoDate("2026-08-06T12:34:56Z")).toBe("2026-08-06");
    expect(toIsoDate(null)).toBe("");
    expect(toIsoDate("")).toBe("");
    expect(toIsoDate("not a date")).toBe("");
  });

  it("normalises datetime strings that carry an explicit zone", () => {
    expect(toIsoDate("2026-08-06T12:00:00Z")).toBe("2026-08-06");
    expect(toIsoDate("2026-08-06T12:00Z")).toBe("2026-08-06");
    expect(toIsoDate("2026-08-06T12:00:00.500Z")).toBe("2026-08-06");
    // The zone is honoured, so the UTC day can differ from the literal date —
    // this matches the engine's `toDayMs`, which also reads UTC getters.
    expect(toIsoDate("2026-08-06T00:00:00+02:00")).toBe("2026-08-05");
    expect(toIsoDate("2026-08-06T00:00:00+0200")).toBe("2026-08-05");
    expect(toIsoDate("2026-08-06T23:00:00-11:00")).toBe("2026-08-07");
  });

  it("reads a zone-less datetime as its literal date portion", () => {
    // No zone → interpreted as UTC, so the day is viewer-independent.
    expect(toIsoDate("2026-08-06T00:00:00")).toBe("2026-08-06");
    expect(toIsoDate("2026-08-06T23:59:59")).toBe("2026-08-06");
    expect(toIsoDate("2026-08-06T13:45")).toBe("2026-08-06");
    expect(toIsoDate("2026-08-06T13:45:00.500")).toBe("2026-08-06");
  });

  it("rejects ambiguous strings rather than resolving them in local time", () => {
    // Each of these would resolve differently for viewers in different zones.
    expect(toIsoDate("2026-8-6")).toBe("");
    expect(toIsoDate("08/06/2026")).toBe("");
    expect(toIsoDate("August 6, 2026")).toBe("");
  });

  it("rejects calendar overflow rather than rolling it forward", () => {
    expect(toIsoDate("2026-02-30")).toBe("");
    expect(toIsoDate("2026-02-30T00:00:00Z")).toBe("");
    expect(toIsoDate("2026-13-01")).toBe("");
  });

  it("rejects timestamps outside the Date range instead of formatting NaN", () => {
    expect(toIsoDate(8.64e15 + 1)).toBe(""); // one ms past the max Date
    expect(toIsoDate(1.78e18)).toBe(""); // a nanosecond epoch
    expect(toIsoDate(Number.POSITIVE_INFINITY)).toBe("");
    expect(toIsoDate(new Date(Number.NaN))).toBe("");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDaysIso("2026-08-06", 1)).toBe("2026-08-07");
    expect(addDaysIso("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysIso("2026-08-06", 7)).toBe("2026-08-13");
  });

  it("adds months, clamping to the target month's length", () => {
    expect(addMonthsIso("2026-08-06", 1)).toBe("2026-09-06");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2024-01-31", 1)).toBe("2024-02-29"); // leap
    expect(addMonthsIso("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("builds six Monday-start weeks covering the month", () => {
    const weeks = monthMatrix("2026-08-06");
    expect(weeks).toHaveLength(6);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // 2026-08-01 is a Saturday, so the grid starts Monday 2026-07-27.
    expect(weeks[0][0].iso).toBe("2026-07-27");
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][5].iso).toBe("2026-08-01");
    expect(weeks[0][5].inMonth).toBe(true);
    // Every in-month day appears exactly once.
    const inMonth = weeks.flat().filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31);
  });

  it("labels the month of the given date", () => {
    expect(monthLabel("2026-08-06")).toBe("August 2026");
    expect(monthLabel("2025-12-01")).toBe("December 2025");
  });
});

/**
 * Shared date case table. The twin lives in
 * `packages/grid-core/src/__tests__/evaluate-filter-date.test.ts` and
 * exercises the engine's `toDayMs`; this one exercises the editor's
 * `toIsoDate`. The two helpers are deliberate duplicates of one rule
 * (grid-core must not depend on @pretable/react), so the tables must stay
 * identical — that is what stops the two halves from drifting apart.
 *
 * `day: null` means "not a date": the editor yields `""`, the engine matches
 * nothing.
 */
const DATE_CASES: { label: string; cell: unknown; day: string | null }[] = [
  { label: "strict ISO date", cell: "2026-08-06", day: "2026-08-06" },
  {
    label: "zone-less datetime → literal date portion (UTC)",
    cell: "2026-08-06T13:45:00",
    day: "2026-08-06",
  },
  {
    label: "zone-less datetime, no seconds",
    cell: "2026-08-06T13:45",
    day: "2026-08-06",
  },
  {
    label: "zone-less datetime at midnight",
    cell: "2026-08-06T00:00:00",
    day: "2026-08-06",
  },
  { label: "Z datetime", cell: "2026-08-06T23:00:00Z", day: "2026-08-06" },
  {
    label: "positive offset shifts the UTC day back",
    cell: "2026-08-06T00:00:00+02:00",
    day: "2026-08-05",
  },
  {
    label: "negative offset shifts the UTC day forward",
    cell: "2026-08-06T23:00:00-11:00",
    day: "2026-08-07",
  },
  {
    label: "offset without a colon",
    cell: "2026-08-06T00:00:00+0200",
    day: "2026-08-05",
  },
  {
    label: "Date instance",
    cell: new Date(Date.UTC(2026, 7, 6, 13, 45)),
    day: "2026-08-06",
  },
  { label: "epoch ms", cell: Date.UTC(2026, 7, 6, 23, 59), day: "2026-08-06" },
  { label: "US/EU-ambiguous locale string", cell: "08/06/2026", day: null },
  { label: "unpadded ISO", cell: "2026-8-6", day: null },
  { label: "prose date", cell: "August 6, 2026", day: null },
  { label: "nonsense", cell: "nope", day: null },
  { label: "calendar overflow", cell: "2026-02-30", day: null },
  {
    label: "calendar overflow, zone-less datetime",
    cell: "2026-02-30T00:00:00",
    day: null,
  },
  {
    label: "calendar overflow, zoned datetime",
    cell: "2026-02-30T00:00:00Z",
    day: null,
  },
  { label: "month overflow", cell: "2026-13-01", day: null },
  { label: "empty string", cell: "", day: null },
  { label: "null", cell: null, day: null },
  { label: "undefined", cell: undefined, day: null },
  { label: "invalid Date", cell: new Date(Number.NaN), day: null },
  { label: "out-of-range epoch ms", cell: 8.64e15 + 1, day: null },
  { label: "nanosecond epoch", cell: 1.78e18, day: null },
];

describe("toIsoDate — shared case table (twin of the engine's toDayMs)", () => {
  for (const { label, cell, day } of DATE_CASES) {
    it(`${label}: ${day ?? "not a date"}`, () => {
      expect(toIsoDate(cell)).toBe(day ?? "");
    });
  }
});

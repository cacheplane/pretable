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

  it("rejects ambiguous strings rather than resolving them in local time", () => {
    // Each of these would resolve differently for viewers in different zones.
    expect(toIsoDate("2026-8-6")).toBe("");
    expect(toIsoDate("08/06/2026")).toBe("");
    expect(toIsoDate("2026-08-06T00:00:00")).toBe("");
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

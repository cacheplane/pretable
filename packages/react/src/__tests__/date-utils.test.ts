import { describe, expect, it, vi } from "vitest";

import { monthLabel, monthMatrix, todayIso } from "../editors/date-utils";

describe("date editor calendar utilities", () => {
  it("formats an English month label across the supported domain", () => {
    expect(monthLabel("0000-01-01")).toBe("January 0");
    expect(monthLabel("2026-08-06")).toBe("August 2026");
    expect(monthLabel("9999-12-31")).toBe("December 9999");
    expect(monthLabel(" 2026-08-06")).toBe("");
  });

  it("builds six Monday-first weeks with selectable valid filler days", () => {
    const weeks = monthMatrix("2026-08-06");
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]![0]).toEqual({
      iso: "2026-07-27",
      day: 27,
      inMonth: false,
      disabled: false,
    });
    expect(weeks.flat().find((day) => day.iso === "2026-08-06")).toEqual({
      iso: "2026-08-06",
      day: 6,
      inMonth: true,
      disabled: false,
    });
  });

  it("uses disabled null placeholders before the minimum date", () => {
    const days = monthMatrix("0000-01-01").flat();
    expect(days.slice(0, 5)).toEqual(
      Array.from({ length: 5 }, () => ({
        iso: null,
        day: null,
        inMonth: false,
        disabled: true,
      })),
    );
    expect(days[5]).toEqual({
      iso: "0000-01-01",
      day: 1,
      inMonth: true,
      disabled: false,
    });
  });

  it("uses disabled null placeholders after the maximum date", () => {
    const days = monthMatrix("9999-12-31").flat();
    const maximum = days.findIndex((day) => day.iso === "9999-12-31");
    expect(maximum).toBeGreaterThanOrEqual(0);
    expect(days.slice(maximum + 1)).toEqual(
      Array.from({ length: days.length - maximum - 1 }, () => ({
        iso: null,
        day: null,
        inMonth: false,
        disabled: true,
      })),
    );
  });

  it("returns an empty matrix for noncanonical input", () => {
    for (const value of [
      "2026-8-6",
      "2026-02-30",
      "2026-08-06T00:00:00Z",
      " 2026-08-06",
      "",
    ]) {
      expect(monthMatrix(value), value).toEqual([]);
    }
  });

  it("spells viewer-local today without UTC-day coercion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 6, 23, 30));
    expect(todayIso()).toBe("2026-08-06");
    vi.useRealTimers();
  });
});

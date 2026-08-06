import { describe, expect, it } from "vitest";

import { evaluateFilter } from "../evaluate-filter";

/**
 * Shared date case table. The twin lives in
 * `packages/react/src/__tests__/date-utils.test.ts` and exercises the editor's
 * `toIsoDate`; this one exercises the engine's `toDayMs` (through
 * `evaluateFilter`). The two helpers are deliberate duplicates of one rule
 * (grid-core must not depend on @pretable/react), so the tables must stay
 * identical — that is what stops the two halves from drifting apart.
 *
 * `day: null` means "not a date": the engine matches nothing, the editor
 * yields `""`.
 */
/**
 * 0050-01-01T13:45Z. Built with an explicit `setUTCFullYear` because
 * `Date.UTC(50, …)` means *1950* — the two-digit mapping both twins have to
 * work around.
 */
const YEAR_50 = new Date(Date.UTC(2000, 0, 1, 13, 45));
YEAR_50.setUTCFullYear(50);

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
    label: "space-separated datetime → literal date portion (UTC)",
    cell: "2026-08-06 13:45:00",
    day: "2026-08-06",
  },
  {
    label: "space-separated datetime with a Z zone",
    cell: "2026-08-06 13:45:00Z",
    day: "2026-08-06",
  },
  {
    label: "space-separated datetime whose offset shifts the UTC day",
    cell: "2026-08-06 23:00:00-11:00",
    day: "2026-08-07",
  },
  {
    label: "Date instance",
    cell: new Date(Date.UTC(2026, 7, 6, 13, 45)),
    day: "2026-08-06",
  },
  { label: "epoch ms", cell: Date.UTC(2026, 7, 6, 23, 59), day: "2026-08-06" },
  { label: "year before 0100", cell: "0050-01-01", day: "0050-01-01" },
  {
    label: "zoned datetime in a year before 0100",
    cell: "0050-01-01T13:45:00Z",
    day: "0050-01-01",
  },
  {
    label: "Date instance in a year before 0100",
    cell: YEAR_50,
    day: "0050-01-01",
  },
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
  {
    label: "calendar overflow, space-separated datetime",
    cell: "2026-02-30 12:00:00",
    day: null,
  },
  { label: "month overflow", cell: "2026-13-01", day: null },
  { label: "empty string", cell: "", day: null },
  { label: "null", cell: null, day: null },
  { label: "undefined", cell: undefined, day: null },
  { label: "invalid Date", cell: new Date(Number.NaN), day: null },
  { label: "out-of-range epoch ms", cell: 8.64e15 + 1, day: null },
  {
    label: "max epoch ms — year 275760, past 4-digit ISO",
    cell: 8.64e15,
    day: null,
  },
  {
    label: "min epoch ms — year -271821, before 0000",
    cell: -8.64e15,
    day: null,
  },
  { label: "nanosecond epoch", cell: 1.78e18, day: null },
];

const DAY_MS = 86_400_000;
const shiftDay = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

const on = (cell: unknown, day: string) =>
  evaluateFilter(cell, "date", "on", day);

describe("evaluateFilter — date day resolution (shared case table)", () => {
  for (const { label, cell, day } of DATE_CASES) {
    it(`${label}: ${day ?? "not a date"}`, () => {
      if (day === null) {
        // Not a date → matches no day at all, and no range operator either.
        expect(on(cell, "2026-08-05")).toBe(false);
        expect(on(cell, "2026-08-06")).toBe(false);
        expect(on(cell, "2026-08-07")).toBe(false);
        expect(evaluateFilter(cell, "date", "before", "2026-08-06")).toBe(
          false,
        );
        expect(evaluateFilter(cell, "date", "after", "2026-08-06")).toBe(false);
        return;
      }
      expect(on(cell, day)).toBe(true);
      expect(on(cell, shiftDay(day, -1))).toBe(false);
      expect(on(cell, shiftDay(day, 1))).toBe(false);
      expect(evaluateFilter(cell, "date", "after", shiftDay(day, -1))).toBe(
        true,
      );
      expect(evaluateFilter(cell, "date", "before", shiftDay(day, 1))).toBe(
        true,
      );
      expect(
        evaluateFilter(cell, "date", "dateBetween", [
          shiftDay(day, -1),
          shiftDay(day, 1),
        ]),
      ).toBe(true);
    });
  }

  it("applies the same rule to the filter operand, not just the cell", () => {
    // A zone-less operand buckets to its literal date portion too.
    expect(on("2026-08-06", "2026-08-06T13:45:00")).toBe(true);
    // An unparseable operand matches nothing rather than everything.
    expect(on("2026-08-06", "08/06/2026")).toBe(false);
    expect(on("2026-08-06", "nope")).toBe(false);
  });
});

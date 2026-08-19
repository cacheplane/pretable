import {
  MAX_DATE_VALUE,
  MIN_DATE_VALUE,
  dateValueToUtcMs,
  isValidDateValue,
  parseDateValue,
} from "@pretable-internal/calendar-date";

const DAY_MS = 86_400_000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const formatParts = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;

/** The calendar's today marker follows the viewer's local civil day. */
export function todayIso(): string {
  const now = new Date();
  return formatParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function monthLabel(value: string): string {
  const parsed = parseDateValue(value);
  if (parsed === null) return "";
  return `${MONTHS[parsed.month - 1]} ${parsed.year}`;
}

export interface CalendarDay {
  readonly iso: string | null;
  readonly day: number | null;
  readonly inMonth: boolean;
  readonly disabled: boolean;
}

const disabledDay = (): CalendarDay => ({
  iso: null,
  day: null,
  inMonth: false,
  disabled: true,
});

/** Six Monday-first weeks covering the month containing a canonical date. */
export function monthMatrix(value: string): CalendarDay[][] {
  if (!isValidDateValue(value)) return [];
  const parsed = parseDateValue(value)!;
  const first = formatParts(parsed.year, parsed.month, 1);
  const firstMs = dateValueToUtcMs(first);
  const minimumMs = dateValueToUtcMs(MIN_DATE_VALUE);
  const maximumMs = dateValueToUtcMs(MAX_DATE_VALUE);
  const mondayOffset = (new Date(firstMs).getUTCDay() + 6) % 7;

  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const timestamp = firstMs + (week * 7 + weekday - mondayOffset) * DAY_MS;
      if (timestamp < minimumMs || timestamp > maximumMs) return disabledDay();

      const current = new Date(timestamp);
      const iso = formatParts(
        current.getUTCFullYear(),
        current.getUTCMonth() + 1,
        current.getUTCDate(),
      );
      return {
        iso,
        day: current.getUTCDate(),
        inMonth:
          current.getUTCFullYear() === parsed.year &&
          current.getUTCMonth() + 1 === parsed.month,
        disabled: false,
      };
    }),
  );
}

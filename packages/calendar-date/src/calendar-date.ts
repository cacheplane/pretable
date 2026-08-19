export interface CalendarDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export const MIN_DATE_VALUE = "0000-01-01";
export const MAX_DATE_VALUE = "9999-12-31";

const DATE_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_GREGORIAN_CYCLE = 146_097;
const MAX_YEAR = 9_999;
const MONTHS_PER_YEAR = 12;
const MAX_MONTH_INDEX = MAX_YEAR * MONTHS_PER_YEAR + 11;

const isLeapYear = (year: number) =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const getDaysInMonth = (year: number, month: number) => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
};

const formatDateValue = (year: number, month: number, day: number) =>
  `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;

export function parseDateValue(value: unknown): CalendarDateParts | null {
  if (typeof value !== "string") return null;

  const match = DATE_VALUE_PATTERN.exec(value);
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > getDaysInMonth(year, month)) return null;

  return { year, month, day };
}

/** @public */
export function isValidDateValue(value: unknown): value is string {
  return parseDateValue(value) !== null;
}

export function dateValueToUtcMs(value: string): number {
  const parsed = parseDateValue(value);
  if (parsed === null) return Number.NaN;

  const { year, month, day } = parsed;
  if (year < 100) {
    return (
      Date.UTC(year + 400, month - 1, day) -
      DAYS_PER_GREGORIAN_CYCLE * MS_PER_DAY
    );
  }

  return Date.UTC(year, month - 1, day);
}

export function compareDateValues(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function addDateValueDays(value: string, days: number): string {
  const timestamp = dateValueToUtcMs(value);
  if (Number.isNaN(timestamp) || Number.isNaN(days)) return value;

  const wholeDays = Math.trunc(days);
  const minimumTimestamp = dateValueToUtcMs(MIN_DATE_VALUE);
  const maximumTimestamp = dateValueToUtcMs(MAX_DATE_VALUE);
  const destinationTimestamp = timestamp + wholeDays * MS_PER_DAY;

  if (destinationTimestamp <= minimumTimestamp) return MIN_DATE_VALUE;
  if (destinationTimestamp >= maximumTimestamp) return MAX_DATE_VALUE;

  const destination = new Date(destinationTimestamp);
  return formatDateValue(
    destination.getUTCFullYear(),
    destination.getUTCMonth() + 1,
    destination.getUTCDate(),
  );
}

export function addDateValueMonths(value: string, months: number): string {
  const parsed = parseDateValue(value);
  if (parsed === null || Number.isNaN(months)) return value;

  const destinationMonthIndex =
    parsed.year * MONTHS_PER_YEAR + parsed.month - 1 + Math.trunc(months);

  if (destinationMonthIndex < 0) return MIN_DATE_VALUE;
  if (destinationMonthIndex > MAX_MONTH_INDEX) return MAX_DATE_VALUE;

  const year = Math.floor(destinationMonthIndex / MONTHS_PER_YEAR);
  const month = (destinationMonthIndex % MONTHS_PER_YEAR) + 1;
  const day = Math.min(parsed.day, getDaysInMonth(year, month));

  return formatDateValue(year, month, day);
}

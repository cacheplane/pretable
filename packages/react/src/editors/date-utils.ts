const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** An ISO datetime; group 1 is the date portion, group 2 the zone if spelled out. */
const ISO_DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
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
];

/** A UTC-midnight timestamp as `yyyy-mm-dd`. */
function formatUtc(ms: number): string {
  const d = new Date(ms);
  return [
    String(d.getUTCFullYear()).padStart(4, "0"),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Strict `yyyy-mm-dd` → UTC-midnight ms, or NaN. Deliberately refuses locale
 * formats: `03/04` is ambiguous, and the filter engine speaks ISO too.
 */
export function parseIsoDate(text: string): number {
  const trimmed = text.trim();
  if (!ISO_RE.test(trimmed)) return Number.NaN;
  const [y, m, d] = trimmed.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  // Date.UTC rolls 2026-02-30 forward to March; the round-trip catches that.
  return formatUtc(ms) === trimmed ? ms : Number.NaN;
}

export function isValidIsoDate(text: string): boolean {
  return !Number.isNaN(parseIsoDate(text));
}

/**
 * A cell value → `yyyy-mm-dd`, or `""`.
 *
 * Accepts a strict `yyyy-mm-dd` string, an ISO datetime (zoned or not), a
 * `Date`, or a finite epoch-ms number. A **zone-less** datetime
 * (`2026-08-06T00:00:00`, the shape most JSON and SQL backends emit) is
 * interpreted as UTC, i.e. its literal date portion is taken — deterministic,
 * so the cell reads the same day for every viewer. A zoned datetime yields the
 * *UTC* day of that instant. Everything else — `2026-8-6`, `08/06/2026`,
 * `August 6, 2026` — is refused rather than run through `Date.parse`, which
 * resolves them in the *viewer's* timezone (so the same cell would show a
 * different day for different users) and silently rolls calendar overflow
 * forward (`2026-02-30` → March 2).
 *
 * TWIN: `toDayMs` in `packages/grid-core/src/evaluate-filter.ts` implements
 * the same rule for the filter engine (grid-core must not depend on
 * @pretable/react). Change one and you must change the other; the shared case
 * table in `../__tests__/date-utils.test.ts` and its twin in
 * `packages/grid-core/src/__tests__/evaluate-filter-date.test.ts` pin them
 * together.
 */
export function toIsoDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  let ms: number;
  if (value instanceof Date) ms = value.getTime();
  else if (typeof value === "number") ms = value;
  else if (typeof value === "string") {
    const trimmed = value.trim();
    if (isValidIsoDate(trimmed)) return trimmed;
    const parts = ISO_DATETIME_RE.exec(trimmed);
    // Guard the date portion whether or not a zone follows: `Date.parse` rolls
    // `2026-02-30T00:00:00Z` forward to March, the very thing `parseIsoDate`
    // exists to reject.
    if (!parts || !isValidIsoDate(parts[1])) return "";
    // Zone-less → the literal date portion, UTC-interpreted. Zoned → the UTC
    // day of that instant, so `2026-08-06T00:00:00+02:00` is 2026-08-05.
    if (!parts[2]) return parts[1];
    ms = Date.parse(trimmed);
  } else return "";
  const d = new Date(ms);
  // NaN *and* out-of-range timestamps (|ms| > 8.64e15, e.g. a nanosecond
  // epoch) both yield an Invalid Date, whose UTC getters would format as
  // "0NaN-NaN-NaN" rather than failing.
  if (Number.isNaN(d.getTime())) return "";
  return formatUtc(d.getTime());
}

/**
 * The *viewer's* today. Deliberately local (unlike `toIsoDate`, which resolves
 * stored values to their UTC day): the "today" marker should be the day the
 * user is living in, not the one their stored values are bucketed into.
 */
export function todayIso(): string {
  const now = new Date();
  return formatUtc(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export function addDaysIso(iso: string, days: number): string {
  const ms = parseIsoDate(iso);
  if (Number.isNaN(ms)) return iso;
  return formatUtc(ms + days * DAY_MS);
}

/** Add months, clamping the day to the target month's length (Jan 31 + 1 → Feb 28). */
export function addMonthsIso(iso: string, months: number): string {
  const ms = parseIsoDate(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatUtc(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay)));
}

export function monthLabel(iso: string): string {
  const ms = parseIsoDate(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
}

/** Six Monday-start weeks covering the month containing `iso`. */
export function monthMatrix(iso: string): CalendarDay[][] {
  const ms = parseIsoDate(iso);
  if (Number.isNaN(ms)) return [];
  const d = new Date(ms);
  const month = d.getUTCMonth();
  const first = Date.UTC(d.getUTCFullYear(), month, 1);
  // getUTCDay is 0=Sunday; shift so Monday is column 0.
  const offset = (new Date(first).getUTCDay() + 6) % 7;
  const start = first - offset * DAY_MS;
  return Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const cur = new Date(start + (w * 7 + i) * DAY_MS);
      return {
        iso: formatUtc(cur.getTime()),
        day: cur.getUTCDate(),
        inMonth: cur.getUTCMonth() === month,
      };
    }),
  );
}

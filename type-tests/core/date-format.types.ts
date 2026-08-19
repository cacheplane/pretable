import {
  createColumnHelper,
  isValidDateValue,
  type PretableColumn,
  type PretableDateFormatOptions,
} from "@pretable/core";
// @ts-expect-error the strict key alias is intentionally private
import type { PretableDateFormatKey } from "@pretable/core";
import type { Equal, Expect } from "../shared/assert";

interface Schedule {
  id: string;
  due: string | null;
  label: string;
}

const granular = {
  year: "numeric",
  month: "short",
  day: "2-digit",
} satisfies PretableDateFormatOptions;

const styled = {
  dateStyle: "long",
  calendar: "gregory",
  numberingSystem: "latn",
} satisfies PretableDateFormatOptions;

const column = createColumnHelper<Schedule>();

export const scheduleColumns = [
  column.accessor("due", { type: "date", dateFormat: granular }),
  column.accessor("computedDue", (row) => row.due, {
    type: "date",
    dateFormat: styled,
  }),
  column.accessor("label", { type: "text", dateFormat: granular }),
] as const;

type _DirectDateFormat = Expect<
  Equal<
    (typeof scheduleColumns)[0]["dateFormat"],
    PretableDateFormatOptions | undefined
  >
>;
type _ComputedDateFormat = Expect<
  Equal<
    (typeof scheduleColumns)[1]["dateFormat"],
    PretableDateFormatOptions | undefined
  >
>;

const plainColumn: PretableColumn<Schedule> = {
  id: "due",
  type: "date",
  dateFormat: styled,
};
void plainColumn;

const broadOptions: Intl.DateTimeFormatOptions = { year: "numeric" };
// @ts-expect-error broadly typed native options may contain forbidden fields
const strictOptions: PretableDateFormatOptions = broadOptions;
void strictOptions;

const forbiddenOptions: PretableDateFormatOptions = {
  // @ts-expect-error time fields are forbidden
  hour: "numeric",
  // @ts-expect-error Pretable always forces UTC
  timeZone: "UTC",
  // @ts-expect-error time styles are forbidden
  timeStyle: "short",
  // @ts-expect-error fractional seconds are forbidden
  fractionalSecondDigits: 3,
};
void forbiddenOptions;

declare const candidate: unknown;
if (isValidDateValue(candidate)) {
  const canonical: string = candidate;
  void canonical;
}

void (null as unknown as _DirectDateFormat);
void (null as unknown as _ComputedDateFormat);
void (null as unknown as PretableDateFormatKey);

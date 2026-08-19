import { createColumnHelper, createLocalRowModel } from "@pretable/core";
import {
  isValidDateValue,
  usePretable,
  type PretableColumn,
  type PretableColumnTypeFor,
  type PretableDateFormatOptions,
  type PretableReactColumnTypeFor,
} from "@pretable/react";
// @ts-expect-error the strict key alias is intentionally private
import type { PretableDateFormatKey } from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";

interface Schedule {
  id: string;
  due: string | null;
  label: string;
  optionalDue: string | undefined;
  nativeDate: Date;
  payload: { readonly source: string };
  unsafe: any;
  amount: number;
  active: boolean;
}

const format = {
  year: "numeric",
  month: "short",
  day: "2-digit",
} satisfies PretableDateFormatOptions;

const column = createColumnHelper<Schedule>();
const columns = [
  column.accessor("due", {
    type: "date",
    dateFormat: format,
    wrap: true,
  }),
  column.accessor("computedDue", (row) => row.due, {
    type: "date",
    dateFormat: { dateStyle: "long" },
    wrap: true,
  }),
] as const;

type _ReactDateFormat = Expect<
  Equal<
    (typeof columns)[0]["dateFormat"],
    PretableDateFormatOptions | undefined
  >
>;

usePretable({
  rows: [
    {
      id: "s1",
      due: "2026-01-02",
      label: "Launch",
      optionalDue: undefined,
      nativeDate: new Date(0),
      payload: { source: "api" },
      unsafe: undefined,
      amount: 1,
      active: true,
    },
  ],
  columns,
  viewportHeight: 320,
});

const model = createLocalRowModel({
  rows: [
    {
      id: "s1",
      due: "2026-01-02",
      label: "Launch",
      optionalDue: undefined,
      nativeDate: new Date(0),
      payload: { source: "api" },
      unsafe: undefined,
      amount: 1,
      active: true,
    },
  ],
  columns,
});
usePretable({
  model,
  columns: [
    { id: "computedDue", header: "Computed" },
    { id: "due", header: "Due" },
  ],
  viewportHeight: 320,
});

const plainColumn: PretableColumn<Schedule> = {
  id: "due",
  type: "date",
  dateFormat: format,
};
void plainColumn;

column.accessor("nativeDate", {
  // @ts-expect-error Date instances are not built-in calendar dates
  type: "date",
  wrap: true,
});
column.accessor("computedNativeDate", (row) => row.nativeDate, {
  // @ts-expect-error computed Date values cannot escape the calendar-date domain
  type: "date",
  wrap: true,
});
column.accessor("optionalDue", {
  // @ts-expect-error undefined is outside the built-in calendar-date domain
  type: "date",
  wrap: true,
});
column.accessor("computedOptionalDue", (row) => row.optionalDue, {
  // @ts-expect-error computed values cannot admit undefined calendar dates
  type: "date",
  wrap: true,
});
column.accessor("payload", {
  // @ts-expect-error object values are not built-in calendar dates
  type: "date",
  wrap: true,
});
column.accessor("computedPayload", (row) => row.payload, {
  // @ts-expect-error computed objects are not built-in calendar dates
  type: "date",
  wrap: true,
});
column.accessor("unsafe", {
  // @ts-expect-error any-valued fields cannot opt into built-in calendar dates
  type: "date",
  wrap: true,
});
column.accessor("computedUnsafe", (row) => row.unsafe, {
  // @ts-expect-error computed any values cannot opt into calendar dates
  type: "date",
  wrap: true,
});

column.accessor("due", {
  type: "date",
  wrap: true,
});
column.accessor("computedCanonicalDue", (row) => row.due, {
  type: "date",
  wrap: true,
});
column.accessor("amount", {
  type: "number",
  wrap: true,
});
column.accessor("active", {
  type: "boolean",
  wrap: true,
});
column.accessor("label", {
  type: "text",
  wrap: true,
});
column.accessor("label", {
  type: "enum",
  wrap: true,
});

type _DateParity = Expect<
  Equal<PretableReactColumnTypeFor<Date>, PretableColumnTypeFor<Date>>
>;
type _OptionalStringParity = Expect<
  Equal<
    PretableReactColumnTypeFor<string | undefined>,
    PretableColumnTypeFor<string | undefined>
  >
>;
type _ObjectParity = Expect<
  Equal<
    PretableReactColumnTypeFor<{ readonly source: string }>,
    PretableColumnTypeFor<{ readonly source: string }>
  >
>;
type _AnyParity = Expect<
  Equal<PretableReactColumnTypeFor<any>, PretableColumnTypeFor<any>>
>;
type _CanonicalDateParity = Expect<
  Equal<
    PretableReactColumnTypeFor<string | null>,
    PretableColumnTypeFor<string | null>
  >
>;
type _NumberParity = Expect<
  Equal<PretableReactColumnTypeFor<number>, PretableColumnTypeFor<number>>
>;
type _BooleanParity = Expect<
  Equal<PretableReactColumnTypeFor<boolean>, PretableColumnTypeFor<boolean>>
>;
type _StringParity = Expect<
  Equal<PretableReactColumnTypeFor<string>, PretableColumnTypeFor<string>>
>;

declare const candidate: unknown;
if (isValidDateValue(candidate)) {
  const canonical: string = candidate;
  void canonical;
}

void (null as unknown as _ReactDateFormat);
void (null as unknown as _DateParity);
void (null as unknown as _OptionalStringParity);
void (null as unknown as _ObjectParity);
void (null as unknown as _AnyParity);
void (null as unknown as _CanonicalDateParity);
void (null as unknown as _NumberParity);
void (null as unknown as _BooleanParity);
void (null as unknown as _StringParity);
void (null as unknown as PretableDateFormatKey);

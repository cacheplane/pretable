import { createColumnHelper, createLocalRowModel } from "@pretable/core";
import {
  isValidDateValue,
  usePretable,
  type PretableColumn,
  type PretableDateFormatOptions,
} from "@pretable/react";
// @ts-expect-error the strict key alias is intentionally private
import type { PretableDateFormatKey } from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";

interface Schedule {
  id: string;
  due: string | null;
  label: string;
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
    render: ({ formattedValue }) => formattedValue,
  }),
  column.accessor("computedDue", (row) => row.due, {
    type: "date",
    dateFormat: { dateStyle: "long" },
    render: ({ formattedValue }) => formattedValue,
  }),
] as const;

type _ReactDateFormat = Expect<
  Equal<
    (typeof columns)[0]["dateFormat"],
    PretableDateFormatOptions | undefined
  >
>;

usePretable({
  rows: [{ id: "s1", due: "2026-01-02", label: "Launch" }],
  columns,
  viewportHeight: 320,
});

const model = createLocalRowModel({
  rows: [{ id: "s1", due: "2026-01-02", label: "Launch" }],
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

declare const candidate: unknown;
if (isValidDateValue(candidate)) {
  const canonical: string = candidate;
  void canonical;
}

void (null as unknown as _ReactDateFormat);
void (null as unknown as PretableDateFormatKey);

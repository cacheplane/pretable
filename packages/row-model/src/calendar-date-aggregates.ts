import { isValidDateValue } from "@pretable-internal/calendar-date";

import type { PretableAggregator } from "./column-types";

type CalendarDateAggregator = PretableAggregator<
  object,
  unknown,
  string | null,
  string | null
>;

function calendarDateExtremum(kind: "min" | "max"): CalendarDateAggregator {
  return Object.freeze({
    init: () => null,
    accumulate: (accumulator: string | null, value: unknown) => {
      if (!isValidDateValue(value)) return accumulator;
      if (accumulator === null) return value;
      return kind === "min"
        ? value < accumulator
          ? value
          : accumulator
        : value > accumulator
          ? value
          : accumulator;
    },
    merge: (left: string | null, right: string | null) => {
      if (left === null) return right;
      if (right === null) return left;
      return kind === "min"
        ? left < right
          ? left
          : right
        : left > right
          ? left
          : right;
    },
    finalize: (accumulator: string | null) => accumulator,
  });
}

const calendarDateMin = calendarDateExtremum("min");
const calendarDateMax = calendarDateExtremum("max");

export function lowerCalendarDateAggregate(
  columnType: string,
  aggregate: string | PretableAggregator<object, unknown, unknown, unknown>,
): string | PretableAggregator<object, unknown, unknown, unknown> {
  if (columnType !== "date") return aggregate;
  if (aggregate === "min") {
    return calendarDateMin as PretableAggregator<
      object,
      unknown,
      unknown,
      unknown
    >;
  }
  if (aggregate === "max") {
    return calendarDateMax as PretableAggregator<
      object,
      unknown,
      unknown,
      unknown
    >;
  }
  return aggregate;
}

export function isCalendarDateAggregate(aggregate: unknown): boolean {
  return aggregate === calendarDateMin || aggregate === calendarDateMax;
}

import type { PretableRow } from "@pretable/core";
import { dateValueToUtcMs } from "@pretable-internal/calendar-date";

import type { PretableLocale } from "./locale";
import {
  reconcileDateFormatters,
  type DateFormatterCacheState,
} from "./date-formatters";
import type { PretableColumn } from "./types";

export interface ValueFormatterRegistry {
  readonly numbers: ReadonlyMap<string, Intl.NumberFormat>;
  readonly dates: ReadonlyMap<string, Intl.DateTimeFormat>;
}

interface NumberFormatterCacheState {
  readonly locale: Intl.LocalesArgument | undefined;
  readonly optionsByColumnId: ReadonlyMap<string, Intl.NumberFormatOptions>;
  readonly formatters: ReadonlyMap<string, Intl.NumberFormat>;
}

export interface ValueFormatterCache {
  resolve<TRow extends PretableRow>(
    columns: readonly PretableColumn<TRow>[],
    locale?: PretableLocale,
  ): ValueFormatterRegistry;
}

function createNumberFormatter(
  columnId: string,
  locale: PretableLocale | undefined,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch (cause) {
    throw new Error(
      `[pretable] invalid numberFormat for column "${columnId}"`,
      { cause },
    );
  }
}

function reconcileNumberFormatters<TRow extends PretableRow>(
  previous: NumberFormatterCacheState | undefined,
  columns: readonly PretableColumn<TRow>[],
  locale?: PretableLocale,
): NumberFormatterCacheState {
  const optionsByColumnId = new Map<string, Intl.NumberFormatOptions>();
  const formatters = new Map<string, Intl.NumberFormat>();
  const canReuseLocale =
    previous !== undefined && Object.is(previous.locale, locale);

  for (const column of columns) {
    const options = column.numberFormat;
    if (options === undefined) continue;

    optionsByColumnId.set(column.id, options);
    const previousFormatter = previous?.formatters.get(column.id);
    if (
      canReuseLocale &&
      previous?.optionsByColumnId.get(column.id) === options &&
      previousFormatter !== undefined
    ) {
      formatters.set(column.id, previousFormatter);
    } else {
      formatters.set(
        column.id,
        createNumberFormatter(column.id, locale, options),
      );
    }
  }

  return { locale, optionsByColumnId, formatters };
}

export function createValueFormatterCache(): ValueFormatterCache {
  let numberState: NumberFormatterCacheState | undefined;
  let dateState: DateFormatterCacheState | undefined;

  return {
    resolve(columns, locale) {
      numberState = reconcileNumberFormatters(numberState, columns, locale);
      dateState = reconcileDateFormatters(dateState, columns, locale);
      return {
        numbers: numberState.formatters,
        dates: dateState.formatters,
      };
    },
  };
}

export function compileValueFormatters<TRow extends PretableRow>(
  columns: readonly PretableColumn<TRow>[],
  locale?: PretableLocale,
): ValueFormatterRegistry {
  return {
    numbers: reconcileNumberFormatters(undefined, columns, locale).formatters,
    dates: reconcileDateFormatters(undefined, columns, locale).formatters,
  };
}

function formatWithNative(
  value: unknown,
  dateFormatter: Intl.DateTimeFormat | undefined,
  numberFormatter: Intl.NumberFormat | undefined,
  fallback: (value: unknown) => string,
): string {
  if (dateFormatter !== undefined && typeof value === "string") {
    const timestamp = dateValueToUtcMs(value);
    if (Number.isFinite(timestamp)) return dateFormatter.format(timestamp);
  }

  if (
    numberFormatter !== undefined &&
    (typeof value === "number" || typeof value === "bigint")
  ) {
    return numberFormatter.format(value);
  }

  return fallback(value);
}

export function formatDataCellValue<TRow extends PretableRow>({
  value,
  row,
  column,
  valueFormatters,
  fallback,
}: {
  value: unknown;
  row: TRow;
  column: PretableColumn<TRow>;
  valueFormatters: ValueFormatterRegistry;
  fallback: (value: unknown) => string;
}): string {
  if (column.format !== undefined) {
    return column.format({ value, row, column });
  }

  return formatWithNative(
    value,
    valueFormatters.dates.get(column.id),
    valueFormatters.numbers.get(column.id),
    fallback,
  );
}

export function formatAggregateValue<TRow extends PretableRow>({
  column,
  group,
  scope,
  valueFormatters,
  fallback,
}: {
  column: PretableColumn<TRow>;
  group: {
    readonly id: string;
    readonly groupId: string;
    readonly depth: number;
    readonly columnId: string;
    readonly value: unknown;
    readonly childCount: number;
    readonly aggregates: Readonly<Record<string, unknown>>;
    readonly expanded: boolean;
  };
  scope: "all" | "loaded";
  valueFormatters: ValueFormatterRegistry;
  fallback: (value: unknown) => string;
}): string {
  // ENGINE-AWARE in its VALUE, prop-driven in its FORMATTING, and both are
  // correct. `group.aggregates` is the computed map, so an override changes
  // what is shown here; `formatAggregate`/`numberFormat` come off the column
  // prop, so a column that declared how to render its total keeps rendering
  // the new total that way. The one seam an override cannot move is a column
  // whose `type` was INFERRED from its declared aggregate (see
  // `authoritativeColumns` in `pretable-surface.tsx`) — the inference reads
  // the prop, so an override onto a numeric aggregate does not retro-type a
  // text column.
  const value = group.aggregates[column.id];
  if (column.formatAggregate !== undefined) {
    return column.formatAggregate({ value, column, group, scope });
  }

  return formatWithNative(
    value,
    valueFormatters.dates.get(column.id),
    valueFormatters.numbers.get(column.id),
    fallback,
  );
}

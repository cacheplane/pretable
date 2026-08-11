import type { PretableGroupRow, PretableRow } from "@pretable/core";

import type { PretableColumn } from "./types";

export type NumberFormatterRegistry = ReadonlyMap<string, Intl.NumberFormat>;

export interface NumberFormatterCacheState {
  readonly locale: Intl.LocalesArgument | undefined;
  readonly optionsByColumnId: ReadonlyMap<string, Intl.NumberFormatOptions>;
  readonly formatters: NumberFormatterRegistry;
}

export interface NumberFormatterCache {
  resolve<TRow extends PretableRow>(
    columns: readonly PretableColumn<TRow>[],
    locale?: Intl.LocalesArgument,
  ): NumberFormatterRegistry;
}

function createNumberFormatter(
  columnId: string,
  locale: Intl.LocalesArgument | undefined,
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

export function reconcileNumberFormatters<TRow extends PretableRow>(
  previous: NumberFormatterCacheState | undefined,
  columns: readonly PretableColumn<TRow>[],
  locale?: Intl.LocalesArgument,
): NumberFormatterCacheState {
  const optionsByColumnId = new Map<string, Intl.NumberFormatOptions>();
  const formatters = new Map<string, Intl.NumberFormat>();
  const canReuseLocale =
    previous !== undefined && Object.is(previous.locale, locale);

  for (const column of columns) {
    const options = column.numberFormat;
    if (options === undefined) {
      continue;
    }

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

export function createNumberFormatterCache(): NumberFormatterCache {
  let state: NumberFormatterCacheState | undefined;

  return {
    resolve(columns, locale) {
      state = reconcileNumberFormatters(state, columns, locale);
      return state.formatters;
    },
  };
}

export function compileNumberFormatters<TRow extends PretableRow>(
  columns: readonly PretableColumn<TRow>[],
  locale?: Intl.LocalesArgument,
): NumberFormatterRegistry {
  return reconcileNumberFormatters(undefined, columns, locale).formatters;
}

function formatWithNativeNumber(
  value: unknown,
  formatter: Intl.NumberFormat | undefined,
  fallback: (value: unknown) => string,
): string {
  if (
    formatter !== undefined &&
    (typeof value === "number" || typeof value === "bigint")
  ) {
    return formatter.format(value);
  }

  return fallback(value);
}

export function formatDataCellValue<TRow extends PretableRow>({
  value,
  row,
  column,
  numberFormatters,
  fallback,
}: {
  value: unknown;
  row: TRow;
  column: PretableColumn<TRow>;
  numberFormatters: NumberFormatterRegistry;
  fallback: (value: unknown) => string;
}): string {
  if (column.format !== undefined) {
    return column.format({ value, row, column });
  }

  return formatWithNativeNumber(
    value,
    numberFormatters.get(column.id),
    fallback,
  );
}

export function formatAggregateValue<TRow extends PretableRow>({
  column,
  group,
  scope,
  numberFormatters,
  fallback,
}: {
  column: PretableColumn<TRow>;
  group: PretableGroupRow;
  scope: "all" | "loaded";
  numberFormatters: NumberFormatterRegistry;
  fallback: (value: unknown) => string;
}): string {
  const value = group.aggregates[column.id];
  if (column.formatAggregate !== undefined) {
    return column.formatAggregate({ value, column, group, scope });
  }

  return formatWithNativeNumber(
    value,
    numberFormatters.get(column.id),
    fallback,
  );
}

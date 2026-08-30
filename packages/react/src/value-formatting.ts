import type { PretableRow } from "@pretable/core";

import type { PretableLocale } from "./locale";
import type { PretableColumn } from "./types";

export type NumberFormatterRegistry = ReadonlyMap<string, Intl.NumberFormat>;

export interface NumberFormatterCacheState {
  readonly locale: PretableLocale | undefined;
  readonly optionsByColumnId: ReadonlyMap<string, Intl.NumberFormatOptions>;
  readonly formatters: NumberFormatterRegistry;
}

export interface NumberFormatterCache {
  resolve<TRow extends PretableRow>(
    columns: readonly PretableColumn<TRow>[],
    locale?: PretableLocale,
  ): NumberFormatterRegistry;
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

export function reconcileNumberFormatters<TRow extends PretableRow>(
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
  locale?: PretableLocale,
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
  numberFormatters: NumberFormatterRegistry;
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

  return formatWithNativeNumber(
    value,
    numberFormatters.get(column.id),
    fallback,
  );
}

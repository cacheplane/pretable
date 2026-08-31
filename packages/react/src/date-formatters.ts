import type { PretableRow } from "@pretable/core";
import type { PretableDateFormatOptions } from "@pretable/core";

import type { PretableColumn } from "./types";

export type DateFormatterRegistry = ReadonlyMap<string, Intl.DateTimeFormat>;

export interface DateFormatterCacheState {
  readonly locale: Intl.LocalesArgument | undefined;
  readonly optionsByColumnId: ReadonlyMap<string, PretableDateFormatOptions>;
  readonly formatters: DateFormatterRegistry;
}

type PretableDateFormatKey = keyof {
  [
    TKey in keyof PretableDateFormatOptions as NonNullable<
      PretableDateFormatOptions[TKey]
    > extends never
      ? never
      : TKey
  ]: true;
};

const DATE_FORMAT_KEY_RECORD = {
  localeMatcher: true,
  calendar: true,
  numberingSystem: true,
  dateStyle: true,
  weekday: true,
  era: true,
  year: true,
  month: true,
  day: true,
  formatMatcher: true,
} as const satisfies Record<PretableDateFormatKey, true>;

const DATE_FORMAT_KEYS: ReadonlySet<string> = new Set(
  Object.keys(DATE_FORMAT_KEY_RECORD),
);

function assertValidDateFormatKeys(options: PretableDateFormatOptions): void {
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== "string" || !DATE_FORMAT_KEYS.has(key)) {
      throw new TypeError(`invalid dateFormat option "${String(key)}"`);
    }
  }
}

function createDateFormatter(
  columnId: string,
  locale: Intl.LocalesArgument | undefined,
  options: PretableDateFormatOptions,
): Intl.DateTimeFormat {
  try {
    assertValidDateFormatKeys(options);
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
  } catch (cause) {
    throw new Error(`[pretable] invalid dateFormat for column "${columnId}"`, {
      cause,
    });
  }
}

export function reconcileDateFormatters<TRow extends PretableRow>(
  previous: DateFormatterCacheState | undefined,
  columns: readonly PretableColumn<TRow>[],
  locale?: Intl.LocalesArgument,
): DateFormatterCacheState {
  const optionsByColumnId = new Map<string, PretableDateFormatOptions>();
  const formatters = new Map<string, Intl.DateTimeFormat>();
  const canReuseLocale =
    previous !== undefined && Object.is(previous.locale, locale);

  for (const column of columns) {
    const options = column.dateFormat;
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
        createDateFormatter(column.id, locale, options),
      );
    }
  }

  return { locale, optionsByColumnId, formatters };
}

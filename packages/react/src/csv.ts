/**
 * CSV serialization — the file half of "get the data out", alongside the
 * clipboard half in `copy.ts`.
 *
 * Deliberately pure: this module builds a string and reports what it contains.
 * It touches no Blob, no anchor, and no `document`, which is what lets it be
 * tested by reading its output rather than by spying on a mock, and what lets
 * it be imported from a server graph without exploding.
 *
 * The value pipeline is `copy.ts`'s, verbatim — same `formatDataCellValue`,
 * same `formatAggregateValue`, same number-formatter registry. A CSV that
 * formats differently from the clipboard would be a second answer to the same
 * question.
 */
import { GROUP_COLUMN_ID } from "@pretable/core";
import type {
  ColumnType,
  PretableRow,
  PretableRowId,
  PretableRowModelSnapshot,
} from "@pretable/core";

import { ROW_SELECT_COLUMN_ID } from "./constants";
import { defaultCoerceForCopy } from "./copy";
import { groupLabel } from "./group-model";
import { formatCellValue } from "./rendering";
import type { PretableColumn } from "./types";
import {
  compileNumberFormatters,
  formatAggregateValue,
  formatDataCellValue,
  type NumberFormatterRegistry,
} from "./value-formatting";

/**
 * The characters a spreadsheet reads as the start of a formula.
 *
 * OWASP's list. TAB and CR are on it because Excel skips leading whitespace
 * when deciding whether a cell is a formula.
 */
const FORMULA_LEAD = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Column types whose values may be escaped against formula injection.
 *
 * **This gate is the entire design, not a refinement of it.** Every shipped
 * implementation that decides from the first character of a stringified value
 * has corrupted numbers: Atlassian shipped `-1000` → `'-1000` across Jira
 * 9.9.0–9.12.2 (JRASERVER-77480), MUI X carries the identical gap today, and
 * CsvHelper's `Strip` mode turns `-10` into `10` (#2126, open). Jackson's
 * maintainer predicted exactly that failure in 2022 while declining the
 * feature — "it would not make any sense to remove leading minus sign from
 * negative numbers" — and two libraries then shipped it anyway.
 *
 * A negative number is not a candidate here because a `number` column is not a
 * candidate. Microsoft's Power BI uses the same gate ("the column is defined as
 * type 'text' in the data model") and avoids the same bug. The USENIX WOOT'25
 * measurement study puts it formally: an attack is impossible where the user
 * controls only numeric values.
 *
 * Untyped columns are NOT escaped. That mirrors `copy.ts`'s cellStyleAttr,
 * which pins only `text`/`enum` to Excel's text format for the same reason:
 * `column.type` is the documented lever, and guessing past it is what breaks
 * data.
 */
const ESCAPABLE_TYPES = new Set<ColumnType>(["text", "enum"]);

/**
 * Decides whether one already-formatted cell is escaped.
 *
 * @public
 */
export type PretableFormulaEscapePredicate = (
  value: string,
  type: ColumnType | undefined,
) => boolean;

const defaultShouldEscapeFormula: PretableFormulaEscapePredicate = (
  value,
  type,
) =>
  value.length > 0 &&
  type !== undefined &&
  ESCAPABLE_TYPES.has(type) &&
  FORMULA_LEAD.has(value[0] as string);

/**
 * Escape one already-stringified field for CSV.
 *
 * RFC 4180 rule 6/7: quote when the field contains the delimiter, a quote, CR
 * or LF; escape an inner quote by doubling it.
 *
 * Minimal rather than quote-everything, and that is load-bearing twice over.
 * Quoting every field would destroy the one in-band convention CSV has for
 * distinguishing NULL from an empty string — Postgres writes NULL as a bare
 * empty field and an empty string as `""` — and it buys nothing against
 * formula injection, which quoting does not prevent in any spreadsheet.
 *
 * The delimiter is a parameter because it is configurable; a hard-coded comma
 * here would quote correctly only for the default and silently emit a broken
 * file for `;`.
 *
 * @internal
 */
export function escapeCsvField(text: string, delimiter: string): string {
  const needsQuotes =
    text.includes(delimiter) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r");

  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * How much of the data the grid could prove it held.
 *
 * @public
 */
export type PretableExportScope = "all" | "loaded";

/**
 * Options for {@link serializeCsv}.
 *
 * @public
 */
export interface PretableCsvOptions {
  /** Field separator. Excel follows the OS list separator, `;` in much of Europe. */
  delimiter?: string;
  /** Prepend a UTF-8 BOM. Excel does not detect UTF-8 without one. */
  bom?: boolean;
  /** Emit the header row. */
  includeHeaders?: boolean;
  /**
   * Escape values a spreadsheet would evaluate as a formula. `true` uses the
   * type-gated default; a predicate replaces it entirely.
   */
  escapeFormulas?: boolean | PretableFormulaEscapePredicate;
  /** Emit group header rows. */
  includeGroupRows?: boolean;
  /** Emit group aggregate values. */
  includeAggregateRows?: boolean;
  /** Column subset AND order. Defaults to every drawn data column. */
  columnIds?: readonly string[];
}

/**
 * Input for {@link serializeCsv}.
 *
 * @public
 */
export interface SerializeCsvArgs<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns,
> {
  rowModelSnapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  /**
   * Columns in the order they are DRAWN, from `grid.getColumns()` — never the
   * `columns` prop. Reordering and pinning both change this order, and a file
   * whose columns disagree with the screen is a bug seven consumers in this
   * repo have already shipped. MUI's export has it wrong today: it reads a
   * selector that ignores pinning, so a right-pinned column exports in its
   * unpinned position.
   */
  columns: readonly PretableColumn<TRow>[];
  locale?: Intl.LocalesArgument;
  /**
   * What the grid can prove it holds. `"loaded"` means rows exist that this
   * file cannot contain — see {@link PretableCsvFile.complete}.
   */
  scope?: PretableExportScope;
  options?: PretableCsvOptions;
}

/**
 * A serialized CSV, and an honest account of what is in it.
 *
 * @public
 */
export interface PretableCsvFile {
  text: string;
  /** Data rows written, excluding the header. */
  rowCount: number;
  scope: PretableExportScope;
  /**
   * `false` when the grid could only prove a partial view, so rows exist that
   * this file does not contain.
   *
   * Every mainstream grid ships the partial file silently. AG Grid drops
   * server-side stub rows on a branch whose own comment says so, with no
   * counter and no log; MUI's lazy-loading path emits one blank row per
   * skeleton, so the row count looks right while the data is gone. Neither
   * tells the person who clicked the button.
   *
   * **The warning does not go in the file, and that is a decision.** Power BI
   * embeds "some data might have been omitted" in the artifact, which is right
   * for XLSX and impossible for CSV: RFC 4180 has no comment syntax, so any
   * marker row is a DATA row. A trailing `EXPORT INCOMPLETE` line lands in
   * pandas as a real record with one populated column and NaN across the rest
   * — corrupting the file for precisely the machine consumers most likely to
   * care that it is short. Trading silent incompleteness for silent corruption
   * is not an improvement.
   *
   * So the signal travels two ways that cost the bytes nothing: this flag, for
   * the UI to announce, and a marker in the FILENAME (slice 2), which stays
   * attached to the artifact when it is emailed onward and is legible to a
   * human without being parsed by anything.
   */
  complete: boolean;
}

const BOM = "﻿";

export const DEFAULT_CSV_OPTIONS = {
  delimiter: ",",
  bom: true,
  includeHeaders: true,
  escapeFormulas: true,
  includeGroupRows: true,
  includeAggregateRows: true,
} as const satisfies PretableCsvOptions;

/**
 * Serialize a row-model snapshot to CSV.
 *
 * Returns `null` when there is nothing to write, matching
 * `serializeRangesWithNumberFormatters`.
 *
 * Line endings are CRLF per RFC 4180. Values come from the column's configured
 * formatter — the same one the grid displays — because a file that disagrees
 * with the screen is the single largest source of "export is broken" reports.
 * Note the consequence: a grouped number like `1,234.57` contains the delimiter,
 * so it is quoted, so Excel imports it as text and the column will not sum.
 * That is the cost of honouring a format the consumer explicitly configured.
 *
 * @public
 */
export function serializeCsv<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns,
>(args: SerializeCsvArgs<TRow, TRowId, TColumns>): PretableCsvFile | null {
  return serializeCsvWithNumberFormatters(
    args,
    compileNumberFormatters(args.columns, args.locale),
  );
}

/** @internal */
export function serializeCsvWithNumberFormatters<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns,
>(
  args: SerializeCsvArgs<TRow, TRowId, TColumns>,
  numberFormatters: NumberFormatterRegistry,
): PretableCsvFile | null {
  const options = { ...DEFAULT_CSV_OPTIONS, ...args.options };
  const { delimiter } = options;
  const scope = args.scope ?? "all";

  const shouldEscape: PretableFormulaEscapePredicate | null =
    options.escapeFormulas === false
      ? null
      : options.escapeFormulas === true
        ? defaultShouldEscapeFormula
        : options.escapeFormulas;

  const drawn = args.columns.filter((c) => c.id !== ROW_SELECT_COLUMN_ID);
  // `columnIds` selects AND orders. Reading it in the caller's order rather
  // than filtering the drawn list is the difference between "these columns"
  // and "these columns, like this" — both grids treat it as the latter.
  const dataColumns = options.columnIds
    ? options.columnIds
        .map((id) => drawn.find((c) => c.id === id))
        .filter((c): c is PretableColumn<TRow> => c !== undefined)
    : drawn;

  if (dataColumns.length === 0) return null;

  const write = (text: string, type: ColumnType | undefined): string => {
    const escaped =
      shouldEscape && shouldEscape(text, type) ? `'${text}` : text;
    return escapeCsvField(escaped, delimiter);
  };

  // An array of lines joined once, never `+=`. AG Grid accumulates into one
  // string and throws `RangeError: Invalid string length` at a million rows
  // (#8070, closed as invalid), with #501 reporting it "fails silently" — no
  // error, no download. Measured here, an array is also faster and ~40% leaner.
  const lines: string[] = [];

  if (options.includeHeaders) {
    lines.push(
      dataColumns
        // A header is never escaped as a formula: it is the grid's own text,
        // not a value a user can control, and escaping it would corrupt a
        // column legitimately named "+/- change".
        .map((col) => escapeCsvField(col.header ?? col.id, delimiter))
        .join(delimiter),
    );
  }

  let rowCount = 0;

  for (const row of args.rowModelSnapshot.range(
    0,
    args.rowModelSnapshot.visibleRowCount,
  )) {
    if (row.kind === "group" && !options.includeGroupRows) continue;

    const cells: string[] = [];

    for (const col of dataColumns) {
      let text: string;

      if (row.kind === "group") {
        if (col.id === GROUP_COLUMN_ID) {
          text = groupLabel(row.value);
        } else if (
          options.includeAggregateRows &&
          Object.prototype.hasOwnProperty.call(row.aggregates, col.id)
        ) {
          text = formatAggregateValue({
            column: col,
            group: { ...row, id: row.groupId },
            scope,
            numberFormatters,
            fallback: formatCellValue,
          });
        } else {
          text = "";
        }
      } else {
        const raw = col.value
          ? col.value(row.row)
          : (row.row as Record<string, unknown>)[col.id];
        text = formatDataCellValue({
          value: raw,
          row: row.row,
          column: col,
          numberFormatters,
          fallback: defaultCoerceForCopy,
        });
      }

      cells.push(write(text, col.type));
    }

    // Matches copy.ts: a group row that produced nothing is noise, not data.
    if (row.kind === "group" && cells.every((cell) => cell === "")) continue;

    lines.push(cells.join(delimiter));
    rowCount += 1;
  }

  const body = lines.join("\r\n");

  return {
    text: `${options.bom ? BOM : ""}${body}`,
    rowCount,
    scope,
    complete: scope === "all",
  };
}

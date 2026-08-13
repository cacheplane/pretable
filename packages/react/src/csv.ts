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
 * Values the library can prove are not formulas, whatever a column claims.
 *
 * **This vouches on the RUNTIME VALUE, not on `column.type`, and the difference
 * is a security bug.** An earlier version gated on the declared type — escape
 * `text`/`enum`, exempt `number`/`date`/`boolean` — which assumes a declaration
 * nothing enforces. `PretableRow` is `Record<string, unknown>`; a string from an
 * API lands in a `type: "number"` column unchallenged, and
 * `=HYPERLINK("http://evil","x")` shipped unescaped, RFC-quoted only. Quoting
 * does not stop a spreadsheet evaluating a cell.
 *
 * A genuine number, bigint, boolean or Date cannot begin a formula, so exempting
 * those by their JavaScript type keeps the property that mattered: a real
 * `-1000` is still never escaped, which is the case that corrupted data in Jira
 * 9.9.0-9.12.2 and still does in MUI X. Everything else — including a string in
 * a column that calls itself numeric — is escaped on the value alone.
 *
 * The USENIX WOOT'25 result this rests on says an attack is impossible where
 * the user controls only NUMERIC VALUES. It says nothing about declarations.
 */
function isProvablyNotAFormula(raw: unknown): boolean {
  const t = typeof raw;
  return (
    t === "number" || t === "bigint" || t === "boolean" || raw instanceof Date
  );
}

/** Context a formula-escape predicate is given about the cell it is judging. */
export interface PretableFormulaEscapeInput {
  /** The column's declared type, if it has one. */
  type: ColumnType | undefined;
  /**
   * The underlying value the formatted string came from, before formatting.
   *
   * `undefined` for a synthesized cell — a group label or an aggregate — where
   * there is no single source value to vouch for.
   */
  raw: unknown;
  columnId: string;
}

/**
 * Decides whether one already-formatted cell is escaped.
 *
 * @public
 */
export type PretableFormulaEscapePredicate = (
  value: string,
  input: PretableFormulaEscapeInput,
) => boolean;

const leadsWithFormula = (value: string): boolean =>
  value.length > 0 && FORMULA_LEAD.has(value[0] as string);

const defaultShouldEscapeFormula: PretableFormulaEscapePredicate = (
  value,
  { raw },
) => leadsWithFormula(value) && !isProvablyNotAFormula(raw);

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
   *
   * **On by default, and it does corrupt some legitimate text.** The type gate
   * keeps every `number` and `date` column out of range, but within a `text`
   * column the OWASP trigger set (`= + - @` TAB CR) catches ordinary data:
   * `+1 555 010 0100`, `@brianlove`, and `-5 to -3` all gain a leading
   * apostrophe. Excel hides that apostrophe; pandas, Postgres `COPY` and
   * `csv.reader` do not — they read a literal `'`.
   *
   * That is the trade this option is: a value that might execute in a
   * spreadsheet, against a value that is definitely wrong in a script. It
   * defaults to the security side because the file is aimed at a human with a
   * spreadsheet. Pass `false` for a machine-consumed export, or a predicate to
   * narrow the rule — e.g. `(v) => v.startsWith("=")`, which drops the two
   * triggers (`+`, `-`) that collide with phone numbers and ranges.
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
   *
   * **Required, and deliberately not defaulted.** Defaulting it to `"all"`
   * would make the honesty reporting opt-in: a caller on a server-side model
   * who simply forgot the argument would get a confidently-labelled complete
   * file over a partial window, which is precisely the AG Grid and MUI
   * behaviour this module exists to refuse. `resolveDataScope` in
   * `data-scope.ts` computes it from the grid's processing options and
   * matching total; it needs state a snapshot does not carry, so the caller
   * must pass it rather than have it guessed here.
   */
  scope: PretableExportScope;
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
 * Whether the snapshot is hiding data rows inside collapsed groups.
 *
 * `range()` walks VISIBLE rows, so a collapsed group's children are not merely
 * unexported — they are unreachable, and the export cannot count what it cannot
 * see. Reported rather than silently dropped: a grouped export that lost three
 * of five rows while claiming `complete: true` is the exact failure this module
 * faults AG Grid and MUI for.
 *
 * Deliberately conservative. An `overrideCount` above zero means *some* group
 * disagrees with the default, which may be an expansion rather than a collapse
 * — so a fully-expanded grid with one manual override reports incomplete. A
 * false "-PARTIAL" is a cost; a false "complete" is the bug.
 *
 * (Both AG Grid and MUI export collapsed children instead. Doing that needs a
 * traversal the snapshot does not expose today, so this reports honestly rather
 * than guessing — see the follow-up noted in the spec.)
 */
function hidesCollapsedRows(expansion: {
  readonly default: { readonly kind: string };
  readonly overrideCount: number;
}): boolean {
  return expansion.default.kind !== "expanded" || expansion.overrideCount > 0;
}

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
  const scope = args.scope;

  // A delimiter that is not exactly one safe character does not produce a
  // slightly-off file, it produces an unparseable one: `""` makes
  // `text.includes("")` always true, so every field is quoted and then
  // concatenated into a single column; `"` and CR/LF collide with the quoting
  // and record grammar. Fail loudly rather than emit something that looks like
  // a CSV and is not.
  if (
    delimiter.length !== 1 ||
    delimiter === '"' ||
    delimiter === "\r" ||
    delimiter === "\n"
  ) {
    throw new TypeError(
      `Invalid CSV delimiter ${JSON.stringify(delimiter)}: must be exactly one character, and not a quote or line break.`,
    );
  }

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
  let dataColumns = drawn;

  if (options.columnIds) {
    const resolved = options.columnIds.map((id) => ({
      id,
      column: drawn.find((c) => c.id === id),
    }));
    const missing = resolved.filter((r) => r.column === undefined);

    // Dropping a requested column silently is the same failure this whole
    // module exists to refuse, one level up: the caller asked for a shape and
    // got a narrower one with nothing said.
    if (missing.length > 0) {
      throw new RangeError(
        `serializeCsv: columnIds names ${missing.map((m) => JSON.stringify(m.id)).join(", ")}, which ${missing.length === 1 ? "is not a drawn column" : "are not drawn columns"}.`,
      );
    }

    dataColumns = resolved.map((r) => r.column as PretableColumn<TRow>);
  }

  if (dataColumns.length === 0) return null;

  const write = (text: string, input: PretableFormulaEscapeInput): string => {
    const escaped =
      shouldEscape && shouldEscape(text, input) ? `'${text}` : text;
    return escapeCsvField(escaped, delimiter);
  };

  // An array of lines joined once, never `+=`. AG Grid accumulates into one
  // string and throws `RangeError: Invalid string length` at a million rows
  // (#8070, closed as invalid), with #501 reporting it "fails silently" — no
  // error, no download.
  //
  // (An earlier version of this comment claimed the array was "measured here"
  // to be faster and leaner. There is no CSV benchmark in this repo; the
  // numbers came from the design research and describe a chunked-parts variant
  // that was not built. Removed rather than left to imply evidence that does
  // not exist.)
  const lines: string[] = [];

  if (options.includeHeaders) {
    lines.push(
      dataColumns
        // A header is never escaped as a formula: it is the grid's own text,
        // not a value a user can control, and escaping it would corrupt a
        // column legitimately named "+/- change".
        // `||`, not `??`: an EMPTY header is the one choice that fails in all
        // three major consumers — it collides with every other empty header in
        // pandas, and hard-errors in Excel and Postgres. Fall back to the id.
        .map((col) => escapeCsvField(col.header || col.id, delimiter))
        .join(delimiter),
    );
  }

  let rowCount = 0;
  let sawGroupRow = false;

  for (const row of args.rowModelSnapshot.range(
    0,
    args.rowModelSnapshot.visibleRowCount,
  )) {
    if (row.kind === "group") sawGroupRow = true;
    if (row.kind === "group" && !options.includeGroupRows) continue;

    const cells: string[] = [];

    for (const col of dataColumns) {
      let text: string;
      // The value the formatted string came from, when it can vouch for it.
      // `undefined` means "cannot vouch": a synthesized cell, or a column whose
      // `format` callback transformed the value, so the raw no longer describes
      // what was written. A `format` on a number column may return "=SUM(...)".
      let vouchRaw: unknown;

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
            // `defaultCoerceForCopy`, deliberately NOT `formatCellValue` as
            // `copy.ts` uses here. The two disagree only on an object-valued
            // aggregate, where the display fallback yields `[object Object]`
            // and this yields JSON. A CSV is a data file: the display string is
            // unrecoverable, the JSON is not.
            fallback: defaultCoerceForCopy,
          });
        } else {
          text = "";
        }
      } else {
        const raw = col.value
          ? col.value(row.row)
          : (row.row as Record<string, unknown>)[col.id];
        vouchRaw = col.format === undefined ? raw : undefined;
        text = formatDataCellValue({
          value: raw,
          row: row.row,
          column: col,
          numberFormatters,
          fallback: defaultCoerceForCopy,
        });
      }

      // `raw` is the value the formatted string came from, so the predicate can
      // vouch for it. A synthesized cell — a group label or an aggregate — has
      // no single source value, so it passes `undefined` and is judged on the
      // string alone. That matters: grouping HIDES the source column, so a
      // group label is the only copy of that value in the file.
      cells.push(
        write(text, { type: col.type, raw: vouchRaw, columnId: col.id }),
      );
    }

    // Matches copy.ts: a group row that produced nothing is noise, not data.
    if (row.kind === "group" && cells.every((cell) => cell === "")) continue;

    lines.push(cells.join(delimiter));
    rowCount += 1;
  }

  // Nothing at all to write — no header requested and no row survived. A
  // BOM-only three-byte file is not a CSV, and the doc comment promises null.
  if (lines.length === 0) return null;

  const body = lines.join("\r\n");

  // Two independent ways a file can be short: the grid only held a window
  // (`scope`), or grouping hid rows inside collapsed branches. Either one makes
  // the file partial, and the flag has to account for both or it is decorative.
  const collapsed =
    sawGroupRow && hidesCollapsedRows(args.rowModelSnapshot.expansion);

  return {
    text: `${options.bom ? BOM : ""}${body}`,
    rowCount,
    scope,
    complete: scope === "all" && !collapsed,
  };
}

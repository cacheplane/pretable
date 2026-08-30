import type {
  ColumnType,
  PretableRow,
  PretableRowId,
  PretableRowModelSnapshot,
} from "@pretable/core";

import { isSyntheticColumnId, ROW_SELECT_COLUMN_ID } from "./constants";
import type { PretableExportScope } from "./csv";
import type { PretableLocale } from "./locale";
import type { PretableColumn } from "./types";
import {
  compileNumberFormatters,
  formatAggregateValue,
  formatDataCellValue,
  type NumberFormatterRegistry,
} from "./value-formatting";
import { formatCellValue } from "./rendering";
import { groupLabel } from "./group-model";

// The Blob written by defaultCopyToClipboard carries `type: "text/html"` with
// no charset parameter, so state it in the payload itself.
const HTML_META = '<meta charset="utf-8">';

// `white-space` is an inherited property, so one declaration on the table
// covers every th/td. Without it HTML collapses runs of spaces and a cell
// holding "a  b" would paste as "a b" — a silent regression against the TSV
// flavor, since receiving apps prefer text/html when both are present.
//
// The constraint this imposes on the emitter: the markup must stay
// whitespace-free between tags. Under `pre-wrap` any newline or indentation
// between `<td>` and its text is content, so pretty-printing the table would
// inject stray whitespace into every pasted cell.
const HTML_TABLE_OPEN = '<table style="white-space:pre-wrap">';

// Excel's force-as-text number format. The backslash is Excel's own syntax —
// `\@` is the escaped text-format code — so dropping it silently disables the
// hint. Google Sheets ignores this property; its equivalent is the proprietary
// and version-fragile data-sheets-value, which we deliberately do not emit.
const HTML_TEXT_FORMAT_ATTR = ` style="mso-number-format:'\\@'"`;

/**
 * Attribute string for one body cell.
 *
 * Returns a whole attribute *including its leading space*, ready to splice
 * straight after the tag name (`<td${cellStyleAttr(type)}>`), or `""` for a
 * column with no hint.
 *
 * Only columns explicitly typed `text` or `enum` are pinned to text format.
 * Untyped columns are left bare on purpose: forcing text there would catch
 * more date-coercion cases but would also left-align genuine numbers as
 * strings. `column.type` is the documented lever.
 */
function cellStyleAttr(type: ColumnType | undefined): string {
  return type === "text" || type === "enum" ? HTML_TEXT_FORMAT_ATTR : "";
}

/**
 * Input for {@link serializeRanges}.
 *
 * @public
 */
export interface SerializeRangesArgs<
  TRow extends PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
  TColumns = readonly PretableColumn<TRow>[],
> {
  ranges: readonly {
    readonly start: { readonly rowId: TRowId; readonly columnId: string };
    readonly end: { readonly rowId: TRowId; readonly columnId: string };
  }[];
  rowModelSnapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  columns: readonly PretableColumn<TRow>[];
  copyWithHeaders?: boolean;
  locale?: PretableLocale;
  scope?: PretableExportScope;
}

/**
 * Plain-text + HTML pair returned by clipboard serializers and consumed by `onCopy` / `copyToClipboard` props.
 *
 * @public
 */
export interface CopyPayload {
  text: string;
  html?: string;
}

/**
 * Default coerce-value-to-string used during clipboard serialization. Useful as a fallback inside custom serializers.
 *
 * @public
 */
export function defaultCoerceForCopy(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === "bigint") {
    return String(value);
  }
  if (t === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Escape one already-stringified field for the TSV clipboard flavor.
 *
 * Follows the RFC 4180 quoting convention with TAB as the delimiter — the same
 * rule Excel and Google Sheets both emit and accept on their `text/plain`
 * clipboard flavor:
 *
 * - A field is quoted **iff** it contains a TAB, CR, LF, or a double quote.
 * - Quoting wraps the field in `"` and doubles every embedded `"`.
 * - Everything else is emitted bare, so ordinary values keep byte-for-byte
 *   the payload they had before escaping existed.
 *
 * Quoting on an embedded quote is what makes the encoding unambiguous to
 * decode: a parser treats a field that *starts* with `"` as quoted, so a bare
 * value beginning with a quote would be misread.
 *
 * Exported for the eventual paste path, which needs the exact inverse.
 *
 * @internal
 */
export function escapeTsvField(text: string): string {
  if (!/["\t\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Escape one already-stringified field for the HTML clipboard flavor.
 *
 * Two passes, in this order:
 *
 * 1. `&`, `<`, `>`, `"` become entities. `&` must go first or it
 *    double-escapes the entities the later replacements produce.
 * 2. Line breaks (CRLF, CR, LF) become a single `<br>` each. This runs after
 *    escaping so the emitted tag survives instead of becoming `&lt;br&gt;`.
 *
 * `"` is escaped even though cell text is only ever emitted into a text node,
 * so the helper stays safe if it is later reused for a *double-quoted*
 * attribute value. `'` is left alone, so it is not safe for a single-quoted
 * one.
 *
 * @internal
 */
export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r\n|\r|\n/g, "<br>");
}

interface RangeBounds {
  rowLo: number;
  rowHi: number;
  colLo: number;
  colHi: number;
}

/**
 * Resolve one range's id-based bounds to inclusive row/column indices, or
 * `null` when the range addresses nothing emittable.
 *
 * Both synthetic columns — the row-select checkbox and the derived group
 * column — are positioned BEFORE all data columns in `effectiveColumns` and are
 * absent from `colIndex`. When one appears as a range bound it logically means
 * "start of the visible row", so it translates to the first data column. A
 * range whose *both* ends are the checkbox has no data to emit.
 *
 * The ungrouped path is byte-identical to the pre-group-column arrangement:
 * with no group column drawn, `isSyntheticColumnId` reduces to the checkbox
 * test this always made.
 */
function resolveRangeBounds<
  TRow extends PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
  TColumns = readonly PretableColumn<TRow>[],
>(
  range: SerializeRangesArgs<TRow, TRowId, TColumns>["ranges"][number],
  rowModelSnapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  colIndex: ReadonlyMap<string, number>,
  dataColumnCount: number,
): RangeBounds | null {
  const startRow = rowModelSnapshot.indexOf({
    kind: "data",
    rowId: range.start.rowId,
  });
  const endRow = rowModelSnapshot.indexOf({
    kind: "data",
    rowId: range.end.rowId,
  });
  if (startRow < 0 || endRow < 0) return null;
  const rowLo = Math.min(startRow, endRow);
  const rowHi = Math.max(startRow, endRow);

  // A bound on either synthetic column means "start of the visible row":
  // neither is in `colIndex` and both are drawn before every data column.
  const startIsSynth = isSyntheticColumnId(range.start.columnId);
  const endIsSynth = isSyntheticColumnId(range.end.columnId);
  const startCol = colIndex.get(range.start.columnId);
  const endCol = colIndex.get(range.end.columnId);

  let colLo: number;
  let colHi: number;
  if (startIsSynth && endIsSynth) {
    // Two checkboxes address no data cell at all, and emit nothing. Anything
    // involving the group column does still cover a real column — dragging
    // across the tree cell selects the row's first data column — so it
    // collapses onto that one rather than dropping the range.
    if (
      range.start.columnId === ROW_SELECT_COLUMN_ID &&
      range.end.columnId === ROW_SELECT_COLUMN_ID
    ) {
      return null;
    }
    colLo = colHi = 0;
  } else if (startIsSynth && endCol !== undefined) {
    colLo = 0;
    colHi = endCol;
  } else if (endIsSynth && startCol !== undefined) {
    colLo = startCol;
    colHi = 0;
  } else if (startCol !== undefined && endCol !== undefined) {
    colLo = Math.min(startCol, endCol);
    colHi = Math.max(startCol, endCol);
  } else if (startCol !== undefined) {
    colLo = colHi = startCol;
  } else if (endCol !== undefined) {
    colLo = colHi = endCol;
  } else {
    return null;
  }

  if (colLo > colHi) {
    [colLo, colHi] = [colHi, colLo];
  }
  colLo = Math.max(colLo, 0);
  colHi = Math.min(colHi, dataColumnCount - 1);
  if (colLo > colHi) return null;

  return { rowLo, rowHi, colLo, colHi };
}

/**
 * Serialize one or more `PretableCellRange`s to a two-flavor clipboard payload.
 *
 * `text` is TSV: tab-separated cells, newline-separated rows, blocks joined by
 * a blank line, every field escaped with {@link escapeTsvField}.
 *
 * `html` is a real `<table>` per range, concatenated behind a single
 * `<meta charset="utf-8">`. Excel and Google Sheets both prefer `text/html`
 * when both flavors are on the clipboard, and the table form sidesteps
 * delimiter ambiguity structurally: line breaks become `<br>` rather than a
 * quoted newline, and separate ranges become separate tables rather than
 * relying on a `\n\n` separator that a cell could legally contain.
 *
 * Cell text is escaped, never interpreted — a `column.format` returning
 * `<b>x</b>` copies those literal characters. `column.render` is not consulted.
 *
 * @public
 */
export function serializeRanges<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns,
>(args: SerializeRangesArgs<TRow, TRowId, TColumns>): CopyPayload | null {
  return serializeRangesWithNumberFormatters(
    args,
    compileNumberFormatters(args.columns, args.locale),
  );
}

/** @internal */
export function serializeRangesWithNumberFormatters<
  TRow extends PretableRow,
  TRowId extends PretableRowId,
  TColumns,
>(
  args: SerializeRangesArgs<TRow, TRowId, TColumns>,
  numberFormatters: NumberFormatterRegistry,
): CopyPayload | null {
  // Real data columns only. The derived group column is presentation: emitting
  // a field for it makes every copied row one column wider than the grid the
  // user sees, which is a shape no spreadsheet can interpret. See
  // `isSyntheticColumnId` — paste filters the same predicate, and the two must
  // change together or values shift by one column on the way back in.
  const dataColumns = args.columns.filter((c) => !isSyntheticColumnId(c.id));
  if (dataColumns.length === 0) return null;

  const colIndex = new Map<string, number>();
  dataColumns.forEach((c, i) => colIndex.set(c.id, i));

  const textBlocks: string[] = [];
  const htmlTables: string[] = [];

  for (const range of args.ranges) {
    const bounds = resolveRangeBounds(
      range,
      args.rowModelSnapshot,
      colIndex,
      dataColumns.length,
    );
    if (!bounds) continue;
    const { rowLo, rowHi, colLo, colHi } = bounds;

    const lines: string[] = [];
    let headHtml = "";

    if (args.copyWithHeaders) {
      const headerCells: string[] = [];
      let headerRowHtml = "";
      for (let c = colLo; c <= colHi; c += 1) {
        const col = dataColumns[c]!;
        const header = col.header ?? col.id;
        headerCells.push(escapeTsvField(header));
        headerRowHtml += `<th>${escapeHtmlText(header)}</th>`;
      }
      lines.push(headerCells.join("\t"));
      lines.push("");
      headHtml = `<thead><tr>${headerRowHtml}</tr></thead>`;
    }

    let bodyHtml = "";
    const selectedRows = args.rowModelSnapshot.range(rowLo, rowHi + 1);
    for (const row of selectedRows) {
      const cells: string[] = [];
      let rowHtml = "";
      for (let c = colLo; c <= colHi; c += 1) {
        const col = dataColumns[c]!;
        let text: string;
        if (row.kind === "group") {
          // The label goes in the leftmost column OF THE RANGE, not of the
          // grid: a range starting at column C puts it in C. This is the shape
          // Excel's Subtotal and Sheets' pivot tables produce, so a pasted
          // block reads as native rather than as an extra column.
          //
          // It wins over an aggregate on that same column, deliberately: a
          // group row with no label is unreadable, and this is the one cell
          // whose position is fixed. Accepted cost — a text label lands in a
          // numeric column. It is a header row and spreadsheets tolerate that.
          if (c === colLo) {
            text = groupLabel(row.value);
          } else if (
            Object.prototype.hasOwnProperty.call(row.aggregates, col.id)
          ) {
            text = formatAggregateValue({
              column: col,
              group: { ...row, id: row.groupId },
              scope: args.scope ?? "all",
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
        cells.push(escapeTsvField(text));
        rowHtml += `<td${cellStyleAttr(col.type)}>${escapeHtmlText(text)}</td>`;
      }
      // A group row used to be dropped when every field came out empty — which
      // was every group row a range covered without its group column. It now
      // always carries its label in the leftmost field (`groupLabel` falls back
      // to "(Blanks)" and never returns ""), so the block is rectangular over
      // every row it spans and there is nothing left to drop.
      lines.push(cells.join("\t"));
      bodyHtml += `<tr>${rowHtml}</tr>`;
    }

    textBlocks.push(lines.join("\n"));
    htmlTables.push(
      `${HTML_TABLE_OPEN}${headHtml}<tbody>${bodyHtml}</tbody></table>`,
    );
  }

  if (textBlocks.length === 0) return null;

  return {
    text: textBlocks.join("\n\n"),
    html: `${HTML_META}${htmlTables.join("")}`,
  };
}

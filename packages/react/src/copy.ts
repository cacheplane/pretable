import type {
  PretableCellRange,
  PretableRow,
  PretableVisibleRow,
} from "@pretable/core";

import { ROW_SELECT_COLUMN_ID } from "./constants";
import type { PretableColumn } from "./types";

/**
 * Input for {@link serializeRanges}.
 *
 * @public
 */
export interface SerializeRangesArgs<TRow extends PretableRow> {
  ranges: readonly PretableCellRange[];
  visibleRows: readonly PretableVisibleRow<TRow>[];
  columns: readonly PretableColumn<TRow>[];
  copyWithHeaders?: boolean;
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
 * so the helper stays safe if it is later reused for an attribute value.
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
 * The synthetic row-select column is positioned BEFORE all data columns in
 * `effectiveColumns`. When it appears as a range bound it logically means
 * "start of the visible row", so it translates to the first data column. A
 * range whose *both* ends are the synthetic column has no data to emit.
 */
function resolveRangeBounds(
  range: PretableCellRange,
  rowIndex: ReadonlyMap<string, number>,
  colIndex: ReadonlyMap<string, number>,
  dataColumnCount: number,
): RangeBounds | null {
  const startRow = rowIndex.get(range.startRowId);
  const endRow = rowIndex.get(range.endRowId);
  if (startRow === undefined || endRow === undefined) return null;
  const rowLo = Math.min(startRow, endRow);
  const rowHi = Math.max(startRow, endRow);

  const startIsSynth = range.startColumnId === ROW_SELECT_COLUMN_ID;
  const endIsSynth = range.endColumnId === ROW_SELECT_COLUMN_ID;
  const startCol = colIndex.get(range.startColumnId);
  const endCol = colIndex.get(range.endColumnId);

  let colLo: number;
  let colHi: number;
  if (startIsSynth && endIsSynth) {
    return null;
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
 * Serialize one or more `PretableCellRange`s to a tab-separated text + HTML payload suitable for clipboard write.
 *
 * Cell and header text is escaped with {@link escapeTsvField}, so values
 * holding tabs, newlines (a wrapped/multi-line cell) or quotes survive a paste
 * into Excel or Sheets without breaking the row/column structure.
 *
 * @public
 */
export function serializeRanges<TRow extends PretableRow>(
  args: SerializeRangesArgs<TRow>,
): CopyPayload | null {
  const dataColumns = args.columns.filter((c) => c.id !== ROW_SELECT_COLUMN_ID);
  if (dataColumns.length === 0) return null;

  const colIndex = new Map<string, number>();
  dataColumns.forEach((c, i) => colIndex.set(c.id, i));
  const rowIndex = new Map<string, number>();
  args.visibleRows.forEach((r, i) => rowIndex.set(r.id, i));

  const blocks: string[] = [];

  for (const range of args.ranges) {
    const bounds = resolveRangeBounds(
      range,
      rowIndex,
      colIndex,
      dataColumns.length,
    );
    if (!bounds) continue;
    const { rowLo, rowHi, colLo, colHi } = bounds;

    const lines: string[] = [];
    if (args.copyWithHeaders) {
      const headerCells: string[] = [];
      for (let c = colLo; c <= colHi; c += 1) {
        const col = dataColumns[c]!;
        headerCells.push(escapeTsvField(col.header ?? col.id));
      }
      lines.push(headerCells.join("\t"));
      lines.push("");
    }

    for (let r = rowLo; r <= rowHi; r += 1) {
      const row = args.visibleRows[r]!;

      // TODO(sub-project 2): decide what a copied group header emits — its
      // label, its aggregates, or nothing. Until that shape is defined a group
      // row inside the range is simply omitted, which keeps the emitted block
      // rectangular over the data rows it spans.
      if (row.kind !== "data") {
        continue;
      }

      const cells: string[] = [];
      for (let c = colLo; c <= colHi; c += 1) {
        const col = dataColumns[c]!;
        const raw = col.value
          ? col.value(row.row)
          : (row.row as Record<string, unknown>)[col.id];
        const text = col.format
          ? col.format({ value: raw, row: row.row, column: col })
          : defaultCoerceForCopy(raw);
        cells.push(escapeTsvField(text));
      }
      lines.push(cells.join("\t"));
    }

    blocks.push(lines.join("\n"));
  }

  if (blocks.length === 0) return null;

  return { text: blocks.join("\n\n") };
}

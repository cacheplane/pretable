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
    const startRow = rowIndex.get(range.startRowId);
    const endRow = rowIndex.get(range.endRowId);
    const startIsSynth = range.startColumnId === ROW_SELECT_COLUMN_ID;
    const endIsSynth = range.endColumnId === ROW_SELECT_COLUMN_ID;
    const startCol = colIndex.get(range.startColumnId);
    const endCol = colIndex.get(range.endColumnId);

    const haveRows = startRow !== undefined && endRow !== undefined;
    const rowLo = haveRows ? Math.min(startRow, endRow) : -1;
    const rowHi = haveRows ? Math.max(startRow, endRow) : -1;

    // The synthetic row-select column is positioned BEFORE all data columns
    // in effectiveColumns. When it appears as a range bound it logically
    // means "start of the visible row" — translate to the first data column.
    // Ranges that span only the synthetic column have no data to emit.
    let colLo: number;
    let colHi: number;
    if (startIsSynth && endIsSynth) {
      continue;
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
      continue;
    }

    if (colLo > colHi) {
      [colLo, colHi] = [colHi, colLo];
    }
    colLo = Math.max(colLo, 0);
    colHi = Math.min(colHi, dataColumns.length - 1);
    if (colLo > colHi) continue;
    if (!haveRows || rowLo > rowHi) continue;

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

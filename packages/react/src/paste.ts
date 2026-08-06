/**
 * Pure, React-free clipboard-paste primitives: TSV parsing and paste geometry.
 * No DOM, no async, no validation — the surface layers those on top.
 */

import type {
  PretableCellAddress,
  PretableRow,
  PretableVisibleRow,
} from "@pretable/core";

import { ROW_SELECT_COLUMN_ID } from "./constants";
import type { PretableColumn } from "./types";

/**
 * Parse clipboard text (`text/plain`, TSV flavor) into a matrix of raw cell strings.
 *
 * The exact inverse of `escapeTsvField` (`./copy`), which quotes a field **iff** it
 * contains TAB/CR/LF/`"` and doubles embedded quotes. Accordingly:
 *
 * - A field whose **first** character is `"` is a quoted field: it is read up to the
 *   closing quote, `""` collapses to a single `"`, and it may contain TAB, CR and LF.
 * - A `"` anywhere else is an ordinary character (`a"b` parses as `a"b`), because
 *   an escaped field never emits one there.
 * - `\r\n`, `\n` and `\r` all terminate a row.
 * - Exactly **one** trailing blank line is trimmed — Excel-on-Windows appends one.
 *   A second trailing blank line survives as an empty row.
 *
 * Ragged input is preserved: rows keep whatever field count they had.
 *
 * Known ambiguity: an empty string decodes to `[]`, not `[[""]]`. A matrix holding a
 * single empty field encodes to the empty string, so the two are indistinguishable,
 * and "no content" is by far the more useful reading of an empty clipboard.
 *
 * @public
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldStart = true;
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
    fieldStart = true;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (fieldStart && ch === '"') {
      inQuotes = true;
      fieldStart = false;
      i += 1;
      continue;
    }

    if (ch === "\t") {
      endField();
      i += 1;
      continue;
    }

    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }

    if (ch === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }

    field += ch;
    fieldStart = false;
    i += 1;
  }

  endRow();

  // Trim exactly one trailing blank line: the row a final terminator leaves behind.
  const last = rows[rows.length - 1];
  if (last && last.length === 1 && last[0] === "") rows.pop();

  return rows;
}

/**
 * Input for {@link mapPasteToTargets}.
 *
 * @internal
 */
export interface MapPasteArgs<TRow extends PretableRow> {
  /** Clipboard block, as returned by {@link parseTsv}. May be ragged. */
  matrix: string[][];
  /** Top-left of the selection, or the focused cell when nothing is selected. */
  anchor: PretableCellAddress;
  /** Selection extent; `1 x 1` when a single cell is selected. */
  selectionSize: { rows: number; columns: number };
  visibleRows: readonly PretableVisibleRow<TRow>[];
  /** Effective columns; the synthetic row-select column may be present and is ignored. */
  columns: readonly PretableColumn<TRow>[];
}

/**
 * One cell the clipboard block lands on, before any coercion or validation.
 *
 * @internal
 */
export interface PasteTarget {
  rowId: string;
  columnId: string;
  raw: string;
}

/**
 * Result of {@link mapPasteToTargets}.
 *
 * @internal
 */
export interface PasteTargetMap {
  /** Targets in row-major order. */
  cells: PasteTarget[];
  /** Block rows/columns that fell past the grid's last row/column and were dropped. */
  clipped: { rows: number; columns: number };
}

/**
 * Map a parsed clipboard block onto grid cells with Excel's anchor/tile/clip geometry.
 *
 * - **Anchor.** The block is written down and to the right from `anchor`.
 * - **Tile.** When the selection is larger than the block *and* an exact integer
 *   multiple of it in a dimension, the block repeats to fill that dimension.
 *   Otherwise the block is written exactly once from the top-left, leaving the rest
 *   of the selection untouched. Each dimension decides independently.
 * - **Clip.** Rows or columns past the grid's last row/column are dropped and counted
 *   into `clipped`. No rows are invented — the data model is controlled.
 *
 * The synthetic row-select column is never a target; when it *is* the anchor (a row
 * selection) the block anchors on the first data column instead, mirroring how
 * `serializeRangesAsTsv` translates that bound on copy.
 *
 * Pure geometry: every target is emitted, including ones the surface will later
 * reject as non-editable or invalid. A rejected cell still **consumes** its position
 * so the block keeps its rectangular shape and neighbours never shift.
 *
 * A ragged block emits no target where the source row has no field — a short row
 * leaves those cells untouched rather than clearing them.
 *
 * @internal
 */
export function mapPasteToTargets<TRow extends PretableRow>(
  args: MapPasteArgs<TRow>,
): PasteTargetMap {
  const empty: PasteTargetMap = { cells: [], clipped: { rows: 0, columns: 0 } };

  const blockRows = args.matrix.length;
  if (blockRows === 0) return empty;
  let blockCols = 0;
  for (const row of args.matrix) blockCols = Math.max(blockCols, row.length);
  if (blockCols === 0) return empty;

  const dataColumns = args.columns.filter((c) => c.id !== ROW_SELECT_COLUMN_ID);
  if (dataColumns.length === 0) return empty;

  const anchorRow = args.visibleRows.findIndex(
    (r) => r.id === args.anchor.rowId,
  );
  if (anchorRow < 0) return empty;
  // A row-select anchor means "start of the row" — translate to the first data column.
  const anchorCol =
    args.anchor.columnId === ROW_SELECT_COLUMN_ID
      ? 0
      : dataColumns.findIndex((c) => c.id === args.anchor.columnId);
  if (anchorCol < 0) return empty;

  const extent = (selection: number, block: number): number =>
    selection > block && selection % block === 0 ? selection : block;
  const targetRows = extent(args.selectionSize.rows, blockRows);
  const targetCols = extent(args.selectionSize.columns, blockCols);

  const cells: PasteTarget[] = [];
  let clippedRows = 0;
  let clippedColumns = 0;

  for (let c = 0; c < targetCols; c += 1) {
    if (anchorCol + c >= dataColumns.length) clippedColumns += 1;
  }

  for (let r = 0; r < targetRows; r += 1) {
    const rowIdx = anchorRow + r;
    if (rowIdx >= args.visibleRows.length) {
      clippedRows += 1;
      continue;
    }
    const rowId = args.visibleRows[rowIdx]!.id;
    const sourceRow = args.matrix[r % blockRows]!;
    for (let c = 0; c < targetCols; c += 1) {
      const colIdx = anchorCol + c;
      if (colIdx >= dataColumns.length) continue; // already counted above
      const raw = sourceRow[c % blockCols];
      if (raw === undefined) continue; // ragged source row: leave the cell alone
      cells.push({ rowId, columnId: dataColumns[colIdx]!.id, raw });
    }
  }

  return { cells, clipped: { rows: clippedRows, columns: clippedColumns } };
}

/**
 * Pure, React-free clipboard-paste primitives: TSV parsing and paste geometry.
 * No DOM, no async, no validation — the surface layers those on top.
 */

import type {
  PretableRow,
  PretableRowId,
  PretableRowModelSnapshot,
  PretableVisibleRowRef,
} from "@pretable/core";

import { isSyntheticColumnId } from "./constants";
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
 * Known ambiguity: that one-blank-line trim is not round-trippable for any matrix
 * whose **last row is a single empty field** — `[["a"], [""]]` decodes back as
 * `[["a"]]`, and `[[""]]` as `[]`. Both encode to text ending in a row terminator
 * (`"a\n"`, `""`), which is genuinely ambiguous between "trailing terminator" and
 * "real empty last row"; no parser can tell them apart. Reading it as a terminator
 * is by far the more useful choice, since that is what Excel-on-Windows emits.
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
 * One clipboard cell that survived the paste gate (editable, and `validate`
 * said yes). `value` is post-coercion — the column's `parseEditValue`, or the
 * built-in per-type parse for `number`/`date`/`enum` columns, has already run.
 *
 * The grid never mutates rows: apply these to your own state, exactly as you
 * would a single row-change callback.
 *
 * @public
 */
export interface PastedCell<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
> {
  rowId: TRowId;
  columnId: string;
  /** Coerced value, ready to write. */
  value: unknown;
  /** The clipboard text this cell came from, before coercion. */
  raw: string;
  /** The row as it was when the paste was gated. */
  row: TRow;
}

/**
 * One clipboard cell the grid refused to apply. A rejected cell still
 * **consumed** its position in the block — nothing re-flows.
 *
 * @public
 */
export interface RejectedPasteCell<
  TRowId extends PretableRowId = PretableRowId,
> {
  rowId: TRowId;
  columnId: string;
  raw: string;
  /**
   * `"not-editable"` — the column's `editable` said no.
   * `"invalid"` — coercion threw/failed, or `validate` returned a message.
   */
  reason: "not-editable" | "invalid";
  /** The message `validate` (or the failed coercion) supplied, when there was one. */
  message?: string;
}

/**
 * Payload handed to `PretableSurface`'s `onPaste`, once per paste.
 *
 * @public
 */
export interface PastePayload<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
> {
  /** Cells to apply, in row-major order. */
  cells: PastedCell<TRow, TRowId>[];
  /** Cells that were skipped, with the reason. */
  rejected: RejectedPasteCell<TRowId>[];
  /** Shape of the parsed clipboard block (`columns` = the widest row). */
  source: { rows: number; columns: number };
  /**
   * How many rows/columns of the **target area** fell past the grid's last
   * row/column and were dropped — counts of rows/columns, not cells.
   *
   * The target area is the block after tiling, so when the block tiled into a
   * larger selection `clipped.rows` can exceed `source.rows` (a 2-row block
   * tiled 4× that runs 3 rows off the end reports `3`, not `2`). Only in the
   * anchored, non-tiled case does it match "block rows that fell off".
   *
   * The grid never invents rows; append them yourself from this count if you
   * want Excel's grow-on-overflow behavior.
   */
  clipped: { rows: number; columns: number };
}

/**
 * Input for {@link mapPasteToTargets}.
 *
 * @internal
 */
export interface MapPasteArgs<
  TRow extends PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
  TColumns = readonly PretableColumn<TRow>[],
> {
  /** Clipboard block, as returned by {@link parseTsv}. May be ragged. */
  matrix: string[][];
  /** Top-left of the selection, or the focused cell when nothing is selected. */
  anchor: {
    readonly ref: PretableVisibleRowRef<TRowId>;
    readonly columnId: string;
  };
  /**
   * Selection extent; `1 x 1` when a single cell is selected. `rows` counts
   * **data** rows, matching the target space below — a selection that spans a
   * group header is no wider for it, or tiling would multiply against a row
   * that can never be written.
   */
  selectionSize: { rows: number; columns: number };
  /** Group rows are excluded from the target space; see {@link mapPasteToTargets}. */
  rowModelSnapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  /** Effective columns; the synthetic row-select column may be present and is ignored. */
  columns: readonly PretableColumn<TRow>[];
}

/**
 * One cell the clipboard block lands on, before any coercion or validation.
 *
 * @internal
 */
export interface PasteTarget<TRowId extends PretableRowId = PretableRowId> {
  rowId: TRowId;
  columnId: string;
  raw: string;
}

/**
 * Result of {@link mapPasteToTargets}.
 *
 * @internal
 */
export interface PasteTargetMap<TRowId extends PretableRowId = PretableRowId> {
  /** Targets in row-major order. */
  cells: PasteTarget<TRowId>[];
  /**
   * Rows/columns of the target area (the block **after** tiling) that fell past
   * the grid's last row/column and were dropped. Under tiling this can exceed
   * the block's own row/column count.
   */
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
 * - **Clip.** Target rows or columns past the grid's last row/column are dropped and
 *   counted into `clipped` — target, so a tiled block can clip more rows than it has.
 *   No rows are invented — the data model is controlled.
 *
 * Neither synthetic column — the row-select checkbox, nor the derived group
 * column grouping adds — is ever a target, and neither occupies a slot in the
 * column space a block tiles across. The clipboard is a spreadsheet interchange
 * format: Excel hands over N values for the N data columns a user can see, and
 * a synthetic slot would put the first of them somewhere unwritable and shift
 * the rest. When one *is* the anchor (a row selection, or a click on a group
 * cell) the block anchors on the first data column instead, mirroring how
 * `serializeRanges` translates those bounds on copy. Copy and paste must span
 * the same column space or a round trip shifts by one column.
 *
 * Group rows are never targets either — they hold aggregates, not editable cells.
 * They are **removed from the row space** rather than skipped in place, so the
 * block stays rectangular over the data rows it covers: a 3-row block anchored two
 * data rows above a group header writes 3 data rows, stepping over the header,
 * instead of losing a row to it. Clipping therefore counts against the number of
 * *data* rows below the anchor. When the anchor is itself a group row it resolves
 * to the next data row — the header occupies no slot in the target space — and a
 * paste anchored below the last data row is a no-op.
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
export function mapPasteToTargets<
  TRow extends PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
  TColumns = readonly PretableColumn<TRow>[],
>(args: MapPasteArgs<TRow, TRowId, TColumns>): PasteTargetMap<TRowId> {
  const empty: PasteTargetMap<TRowId> = {
    cells: [],
    clipped: { rows: 0, columns: 0 },
  };

  const blockRows = args.matrix.length;
  if (blockRows === 0) return empty;
  let blockCols = 0;
  for (const row of args.matrix) blockCols = Math.max(blockCols, row.length);
  if (blockCols === 0) return empty;

  // Real data columns only. Excel hands us N values for the N columns a user
  // can see; a synthetic column occupying a slot would tile them across N+1
  // targets and shift every value one column right. `copy.ts` filters the same
  // predicate — see `isSyntheticColumnId` for why they must agree exactly.
  const dataColumns = args.columns.filter((c) => !isSyntheticColumnId(c.id));
  if (dataColumns.length === 0) return empty;

  const snapshot = args.rowModelSnapshot;
  let targetRowId: TRowId | undefined;
  if (args.anchor.ref.kind === "data") {
    if (snapshot.indexOf(args.anchor.ref) < 0) return empty;
    targetRowId = args.anchor.ref.rowId;
  } else {
    targetRowId = snapshot.nextDataRow(args.anchor.ref)?.rowId;
    if (targetRowId === undefined) return empty;
  }
  // An anchor on either synthetic column means "start of the row" — translate
  // to the first data column. Both are drawn before every data column and
  // neither is a target, so a block anchored on one starts at column 0.
  const anchorCol = isSyntheticColumnId(args.anchor.columnId)
    ? 0
    : dataColumns.findIndex((c) => c.id === args.anchor.columnId);
  if (anchorCol < 0) return empty;

  const extent = (selection: number, block: number): number =>
    selection > block && selection % block === 0 ? selection : block;
  const targetRows = extent(args.selectionSize.rows, blockRows);
  const targetCols = extent(args.selectionSize.columns, blockCols);

  const cells: PasteTarget<TRowId>[] = [];
  let clippedRows = 0;
  let clippedColumns = 0;

  for (let c = 0; c < targetCols; c += 1) {
    if (anchorCol + c >= dataColumns.length) clippedColumns += 1;
  }

  for (let r = 0; r < targetRows; r += 1) {
    if (targetRowId === undefined) {
      clippedRows += 1;
      continue;
    }
    const rowId: TRowId = targetRowId;
    const sourceRow = args.matrix[r % blockRows]!;
    for (let c = 0; c < targetCols; c += 1) {
      const colIdx = anchorCol + c;
      if (colIdx >= dataColumns.length) continue; // already counted above
      const raw = sourceRow[c % blockCols];
      if (raw === undefined) continue; // ragged source row: leave the cell alone
      cells.push({ rowId, columnId: dataColumns[colIdx]!.id, raw });
    }
    if (r + 1 < targetRows) {
      targetRowId = snapshot.nextDataRow({ kind: "data", rowId })?.rowId;
    }
  }

  return { cells, clipped: { rows: clippedRows, columns: clippedColumns } };
}

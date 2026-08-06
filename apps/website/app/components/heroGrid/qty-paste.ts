import type { PastePayload } from "@pretable/react";

import type { PositionRow } from "./types";

/** What the sidebar reports after a paste. */
export interface PasteSummary {
  /** Qty cells actually written into the book. */
  applied: number;
  /** Cells the block landed on (applied + rejected). */
  total: number;
  /** Cells the grid refused — non-editable columns, guardrail/sanity failures. */
  rejected: number;
  /** Block rows dropped past the last row (the hero never appends rows). */
  clippedRows: number;
}

export interface QtyPastePlan {
  /** New quantity per row id, ready to merge into the edited-qty override map. */
  qtyById: Map<string, number>;
  summary: PasteSummary;
}

/**
 * Turn an `onPaste` payload into the qty updates the hero applies plus the
 * one-line summary the sidebar shows.
 *
 * Only the `qty` column is editable in the hero, so every surviving cell is a
 * quantity; the `columnId` guard is belt-and-braces. `parseEditValue` on that
 * column is `parseQty`, which returns `NaN` for text the grid can't read — that
 * `NaN` is rejected by `validate` ("Enter a whole number of shares") and never
 * reaches here, but a non-finite value is dropped rather than written.
 */
export function planQtyPaste(payload: PastePayload<PositionRow>): QtyPastePlan {
  const qtyById = new Map<string, number>();
  for (const cell of payload.cells) {
    if (cell.columnId !== "qty") continue;
    const qty = cell.value;
    if (typeof qty !== "number" || !Number.isFinite(qty)) continue;
    qtyById.set(cell.rowId, qty);
  }
  return {
    qtyById,
    summary: {
      applied: qtyById.size,
      total: payload.cells.length + payload.rejected.length,
      rejected: payload.rejected.length,
      clippedRows: payload.clipped.rows,
    },
  };
}

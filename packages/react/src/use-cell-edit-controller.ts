import { useMemo } from "react";

import type {
  PretableCellAddress,
  PretableColumn,
  PretableEditInput,
  PretableFocusDirection,
  PretableGrid,
  PretableRow,
} from "@pretable/core";

export interface CellEditController {
  begin(addr: PretableCellAddress, initialDraft?: unknown): Promise<void>;
  commit(moveDirection?: PretableFocusDirection): Promise<void>;
  cancel(): void;
}

export interface CellEditControllerOptions<TRow extends PretableRow> {
  grid: PretableGrid<TRow>;
  getColumns: () => PretableColumn<TRow>[];
  getRowById: (rowId: string) => TRow | null;
  onCellEdit?: (payload: {
    rowId: string;
    columnId: string;
    value: unknown;
    row: TRow;
  }) => void | Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Stand-alone factory (tested directly). `useCellEditController` wraps it in useMemo.
export function createCellEditController<TRow extends PretableRow>(
  opts: CellEditControllerOptions<TRow>,
): CellEditController {
  const { grid, getColumns, getRowById, onCellEdit } = opts;
  // Monotonic token: every begin()/cancel() bumps it, so a stale async
  // resolution (editable/commit) can detect it is no longer the active edit.
  let token = 0;

  const inputFor = (
    addr: PretableCellAddress,
  ): PretableEditInput<TRow> | null => {
    const column = getColumns().find((c) => c.id === addr.columnId);
    const row = getRowById(addr.rowId);
    if (!column || !row) return null;
    const value = column.value ? column.value(row) : row[addr.columnId];
    return { rowId: addr.rowId, columnId: addr.columnId, row, column, value };
  };

  return {
    async begin(addr, initialDraft) {
      const input = inputFor(addr);
      if (!input) return;
      const editable = input.column.editable ?? false;
      const seed =
        initialDraft !== undefined
          ? initialDraft
          : input.column.formatEditValue
            ? input.column.formatEditValue(input.value, input)
            : input.value;

      if (editable === false) return;
      if (editable === true) {
        grid.beginEdit(addr, { draft: seed, status: "editing" });
        token += 1;
        return;
      }
      // async / function editable
      const myToken = (token += 1);
      grid.beginEdit(addr, { draft: seed, status: "checking" });
      const allowed = await editable(input);
      if (myToken !== token) return; // stale
      if (allowed) grid.markEditing();
      else grid.cancelEdit();
    },

    async commit(moveDirection) {
      const editing = grid.getSnapshot().editing;
      if (!editing) return;
      const addr = { rowId: editing.rowId, columnId: editing.columnId };
      const input = inputFor(addr);
      if (!input) return;
      const myToken = (token += 1);
      const draft = editing.draft;
      const value = input.column.parseEditValue
        ? input.column.parseEditValue(String(draft ?? ""), input)
        : draft;

      if (input.column.validate) {
        grid.markEditValidating();
        const result = await input.column.validate(value, input);
        if (myToken !== token) return; // stale
        if (result !== true) {
          grid.markEditInvalid(result);
          return;
        }
      }

      grid.markEditSaving();
      try {
        await onCellEdit?.({
          rowId: addr.rowId,
          columnId: addr.columnId,
          value,
          row: input.row,
        });
        if (myToken !== token) return; // stale
        grid.commitEditSucceeded();
        if (moveDirection) grid.moveFocus(moveDirection);
      } catch (err) {
        if (myToken !== token) return; // stale
        grid.markEditError(errorMessage(err));
      }
    },

    cancel() {
      token += 1;
      grid.cancelEdit();
    },
  };
}

export function useCellEditController<TRow extends PretableRow>(
  opts: CellEditControllerOptions<TRow>,
): CellEditController {
  // grid identity is stable for the life of the surface; other opts read via
  // closures that always see latest. Recreate only if grid changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createCellEditController(opts), [opts.grid]);
}

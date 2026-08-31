import { useMemo } from "react";

import type {
  PretableFocusDirection,
  PretableRow,
  PretableRowId,
} from "@pretable/core";

import type { PretableColumn, PretableEditInput } from "./types";

import { parseDraftForType } from "./editors/type-parsing";

declare const cellEditAuthorizationBrand: unique symbol;
interface CellEditAuthorization {
  readonly [cellEditAuthorizationBrand]: true;
}

export interface CellEditController<TRowId extends PretableRowId = string> {
  begin(
    addr: { readonly rowId: TRowId; readonly columnId: string },
    initialDraft?: unknown,
    provenance?: { readonly seededFromTyping?: boolean },
  ): Promise<CellEditAuthorization | null>;
  commit(
    moveDirection?: PretableFocusDirection,
    authorization?: CellEditAuthorization,
  ): Promise<void>;
  cancel(): void;
  invalidate(): void;
}

export interface CellEditControllerOptions<
  TRow extends PretableRow,
  TRowId extends PretableRowId = string,
> {
  grid: {
    beginEdit(
      addr: { readonly rowId: TRowId; readonly columnId: string },
      edit?: {
        readonly draft?: unknown;
        readonly status?: "checking" | "editing";
        readonly seededFromTyping?: boolean;
      },
    ): void;
    getSnapshot(): {
      readonly editing: {
        readonly rowId: TRowId;
        readonly columnId: string;
        readonly draft: unknown;
      } | null;
    };
    markEditing(): void;
    markEditValidating(): void;
    markEditSaving(): void;
    markEditInvalid(message: string): void;
    markEditError(message: string): void;
    commitEditSucceeded(): void;
    cancelEdit(): void;
    moveFocus(direction: PretableFocusDirection): void;
  };
  getColumns: () => PretableColumn<TRow>[];
  getRowById: (rowId: TRowId) => TRow | null;
  onCommit?: (payload: {
    rowId: TRowId;
    columnId: string;
    value: unknown;
    row: TRow;
  }) => void | "keep-open" | Promise<void | "keep-open">;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Stand-alone factory (tested directly). `useCellEditController` wraps it in useMemo.
export function createCellEditController<
  TRow extends PretableRow,
  TRowId extends PretableRowId = string,
>(opts: CellEditControllerOptions<TRow, TRowId>): CellEditController<TRowId> {
  const { grid, getColumns, getRowById, onCommit } = opts;
  // Monotonic token: every begin()/cancel() bumps it, so a stale async
  // resolution (editable/commit) can detect it is no longer the active edit.
  let token = 0;
  let activeAuthorization: CellEditAuthorization | null = null;

  const invalidate = () => {
    token += 1;
    activeAuthorization = null;
  };

  const inputFor = (addr: {
    readonly rowId: TRowId;
    readonly columnId: string;
  }): PretableEditInput<TRow> | null => {
    const column = getColumns().find((c) => c.id === addr.columnId);
    const row = getRowById(addr.rowId);
    if (!column || !row) return null;
    const value = column.value
      ? column.value(row)
      : Reflect.get(row, addr.columnId);
    return {
      rowId: addr.rowId as unknown as string,
      columnId: addr.columnId,
      row,
      column,
      value,
    };
  };

  return {
    async begin(addr, initialDraft, provenance) {
      const input = inputFor(addr);
      if (!input) return null;
      const editable = input.column.editable ?? false;
      const seed =
        initialDraft !== undefined
          ? initialDraft
          : input.column.formatEditValue
            ? input.column.formatEditValue(input.value, input)
            : input.value;

      if (editable === false) return null;
      const myToken = (token += 1);
      const authorization = {} as CellEditAuthorization;
      activeAuthorization = authorization;
      if (editable === true) {
        grid.beginEdit(addr, {
          draft: seed,
          status: "editing",
          seededFromTyping: provenance?.seededFromTyping ?? false,
        });
        return authorization;
      }
      // async / function editable
      grid.beginEdit(addr, {
        draft: seed,
        status: "checking",
        seededFromTyping: provenance?.seededFromTyping ?? false,
      });
      const allowed = await editable(input);
      if (myToken !== token || activeAuthorization !== authorization)
        return null;
      if (allowed) {
        grid.markEditing();
        return authorization;
      }
      activeAuthorization = null;
      grid.cancelEdit();
      return null;
    },

    async commit(moveDirection, authorization) {
      if (
        authorization !== undefined &&
        authorization !== activeAuthorization
      ) {
        return;
      }
      const editing = grid.getSnapshot().editing;
      if (!editing) return;
      const addr = { rowId: editing.rowId, columnId: editing.columnId };
      const input = inputFor(addr);
      if (!input) return;
      const myToken = (token += 1);
      activeAuthorization = null;
      const draft = editing.draft;
      let value: unknown;
      if (input.column.parseEditValue) {
        value = input.column.parseEditValue(String(draft ?? ""), input);
      } else if (
        input.column.type === "date" &&
        draft === null &&
        input.value === null
      ) {
        // Null is the canonical empty cell value, not a user-entered draft.
        // Retain an untouched null seed without weakening the strict parser.
        value = null;
      } else {
        const parsed = parseDraftForType(input.column, draft);
        if (!parsed.ok) {
          grid.markEditInvalid(parsed.message);
          return;
        }
        value = parsed.value;
      }

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
        const result = await onCommit?.({
          rowId: addr.rowId,
          columnId: addr.columnId,
          value,
          row: input.row,
        });
        if (myToken !== token) return; // stale
        if (result === "keep-open") return;
        grid.commitEditSucceeded();
        if (moveDirection) grid.moveFocus(moveDirection);
      } catch (err) {
        if (myToken !== token) return; // stale
        grid.markEditError(errorMessage(err));
      }
    },

    cancel() {
      invalidate();
      grid.cancelEdit();
    },

    invalidate,
  };
}

export function useCellEditController<
  TRow extends PretableRow,
  TRowId extends PretableRowId = string,
>(opts: CellEditControllerOptions<TRow, TRowId>): CellEditController<TRowId> {
  // grid identity is stable for the life of the surface; other opts read via
  // closures that always see latest. Recreate only if grid changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createCellEditController(opts), [opts.grid]);
}

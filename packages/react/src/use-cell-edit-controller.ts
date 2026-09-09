import { useMemo } from "react";

import type {
  PretableFocusDirection,
  PretableRow,
  PretableRowId,
} from "@pretable/core";

import type { PretableColumn, PretableEditInput } from "./types";

import { warnOnce } from "./dev-warn";

import { enumDraftText } from "./editors/enum-draft";
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
    getEditSessionToken(): unknown;
    markChecking(): void;
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
  type Session = {
    addr: { readonly rowId: TRowId; readonly columnId: string };
    generation: number;
    adapterToken: unknown;
    authorization: CellEditAuthorization;
    phase: "checking" | "editing" | "validating" | "saving" | "error";
    permitted: boolean;
  };
  let generation = 0;
  let session: Session | null = null;
  const invalidate = () => {
    generation += 1;
    session = null;
  };
  const current = (s: Session) => {
    const editing = grid.getSnapshot().editing;
    return (
      session === s &&
      generation === s.generation &&
      grid.getEditSessionToken() === s.adapterToken &&
      editing?.rowId === s.addr.rowId &&
      editing.columnId === s.addr.columnId
    );
  };
  // Consumer callbacks may synchronously cancel or replace this edit. Check
  // each lookup separately so no subsequent callback receives a stale input.
  const inputFor = (
    addr: Session["addr"],
    alive: () => boolean,
  ): PretableEditInput<TRow> | null => {
    if (!alive()) return null;
    const columns = getColumns();
    if (!alive()) return null;
    const column = columns.find((c) => c.id === addr.columnId);
    const row = getRowById(addr.rowId);
    if (!alive() || !column || !row) return null;
    const value = column.value
      ? column.value(row)
      : Reflect.get(row, addr.columnId);
    if (!alive()) return null;
    return {
      rowId: addr.rowId as unknown as string,
      columnId: addr.columnId,
      row,
      column,
      value,
    };
  };
  const fail = (s: Session, err: unknown) => {
    if (!current(s)) return;
    s.phase = "error";
    grid.markEditError(errorMessage(err));
  };
  const permit = async (s: Session, input: PretableEditInput<TRow>) => {
    if (!current(s)) return false;
    const editable = input.column.editable ?? false;
    const allowed =
      typeof editable === "function" ? await editable(input) : editable;
    if (!current(s)) return false;
    if (!allowed) {
      invalidate();
      grid.cancelEdit();
      return false;
    }
    s.permitted = true;
    return true;
  };

  return {
    async begin(addr, initialDraft, provenance) {
      invalidate();
      const myGeneration = generation;
      if (grid.getSnapshot().editing) grid.cancelEdit();
      const priorAdapterToken = grid.getEditSessionToken();
      const alive = () =>
        generation === myGeneration &&
        grid.getEditSessionToken() === priorAdapterToken;
      let started: Session | null = null;
      try {
        const input = inputFor(addr, alive);
        if (!input || !alive()) return null;
        const editable = input.column.editable ?? false;
        if (editable === false) return null;
        const seed =
          initialDraft !== undefined
            ? initialDraft
            : input.column.formatEditValue
              ? input.column.formatEditValue(input.value, input)
              : input.value;
        if (!alive()) return null;
        grid.beginEdit(addr, {
          draft: seed,
          status: editable === true ? "editing" : "checking",
          seededFromTyping: provenance?.seededFromTyping ?? false,
        });
        if (generation !== myGeneration) return null;
        const s: Session = {
          addr: { ...addr },
          generation: myGeneration,
          adapterToken: grid.getEditSessionToken(),
          authorization: {} as CellEditAuthorization,
          phase: editable === true ? "editing" : "checking",
          permitted: editable === true,
        };
        session = s;
        started = s;
        if (!current(s)) {
          session = null;
          return null;
        }
        if (!s.permitted && !(await permit(s, input))) return null;
        if (!current(s)) return null;
        s.phase = "editing";
        if (editable !== true) grid.markEditing();
        return current(s) ? s.authorization : null;
      } catch (err) {
        if (started) fail(started, err);
        else if (alive())
          warnOnce(
            "edit-begin-failed",
            `Unable to begin cell edit: ${errorMessage(err)}`,
          );
        return null;
      }
    },

    async commit(moveDirection, authorization) {
      const s = session;
      if (
        !s ||
        !current(s) ||
        (authorization !== undefined && authorization !== s.authorization)
      )
        return;
      if (s.phase !== "editing" && s.phase !== "error") return;
      // Close admission and protect the core draft before any consumer code.
      s.phase = s.permitted ? "validating" : "checking";
      try {
        if (s.permitted) grid.markEditValidating();
        else grid.markChecking();
        const editing = grid.getSnapshot().editing;
        if (!editing || !current(s)) return;
        const draft = editing.draft;
        const input = inputFor(s.addr, () => current(s));
        if (!current(s)) return;
        if (!input)
          throw new Error("The edited row or column is no longer available");
        if (!s.permitted) {
          if (!(await permit(s, input)) || !current(s)) return;
          s.phase = "validating";
          grid.markEditValidating();
        }
        if (!current(s)) return;
        let value: unknown;
        if (input.column.parseEditValue) {
          value = await input.column.parseEditValue(
            enumDraftText(draft),
            input,
          );
        } else if (
          input.column.type === "date" &&
          draft === null &&
          input.value === null
        ) {
          value = null;
        } else {
          const parsed = parseDraftForType(input.column, draft);
          if (!current(s)) return;
          if (!parsed.ok) {
            s.phase = "editing";
            grid.markEditInvalid(parsed.message);
            return;
          }
          value = parsed.value;
        }
        if (!current(s)) return;
        if (input.column.validate) {
          const result = await input.column.validate(value, input);
          if (!current(s)) return;
          if (result !== true) {
            s.phase = "editing";
            grid.markEditInvalid(result);
            return;
          }
        }
        if (!current(s)) return;
        s.phase = "saving";
        grid.markEditSaving();
        if (!current(s)) return;
        const result = await onCommit?.({ ...s.addr, value, row: input.row });
        if (!current(s) || result === "keep-open") return;
        invalidate();
        grid.commitEditSucceeded();
        if (moveDirection && generation === s.generation + 1)
          grid.moveFocus(moveDirection);
      } catch (err) {
        fail(s, err);
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

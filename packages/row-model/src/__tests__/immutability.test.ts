import { afterEach, describe, expect, test, vi } from "vitest";

import {
  PretableRowModelError,
  createColumnHelper,
  createLocalRowModel,
  type PretableRowIntegrityDiagnostic,
} from "../index";

interface Row {
  id: number;
  label: string;
}

const helper = createColumnHelper<Row>();
const columns = [helper.accessor("label", { type: "text" })] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("local row integrity", () => {
  test("shallow-freezes ordinary extensible rows before publication in development", () => {
    const nested = { mutable: true };
    const row: Row & { nested: typeof nested } = {
      id: 1,
      label: "one",
      nested,
    };
    const input = [row];
    const model = createLocalRowModel({
      rows: input,
      columns,
      getRowId: (value) => value.id,
    });

    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(nested)).toBe(false);
    expect(Object.isFrozen(input)).toBe(false);
    expect(model.getState().snapshot.rowAt(0)).toMatchObject({ row });
  });

  test("diagnoses same-reference mutation of a non-extensible row and reevaluates it", () => {
    const diagnostics: PretableRowIntegrityDiagnostic<number>[] = [];
    const accessor = vi.fn((row: Row) => row.label);
    const activeColumns = [
      helper.accessor("label", accessor, { type: "text" }),
    ] as const;
    const row = Object.preventExtensions({ id: 1, label: "before" });
    const model = createLocalRowModel({
      rows: [row],
      columns: activeColumns,
      getRowId: (value) => value.id,
      query: {
        filters: [{ columnId: "label", operator: "equals", value: "after" }],
        sort: [],
        rowGroups: [],
      },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(model.getState().snapshot.visibleRowCount).toBe(0);
    expect(accessor).toHaveBeenCalledTimes(1);

    row.label = "after";
    const result = model.setRows([row]);

    expect(result).toMatchObject({
      previousRevision: 0,
      revision: 1,
      updated: 1,
    });
    expect(model.getState().snapshot.visibleRowCount).toBe(1);
    expect(model.getState().snapshot.rowAt(0)).toMatchObject({ row });
    expect(accessor).toHaveBeenCalledTimes(2);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "same-reference-row-mutation",
        rowId: 1,
      }),
    ]);
  });

  test("wraps hostile row introspection and getters as structured model errors", () => {
    const hostileOwnKeys = new Proxy(
      Object.preventExtensions({ id: 1, label: "x" }),
      {
        ownKeys: () => {
          throw new Error("ownKeys trap");
        },
      },
    );
    expect(() =>
      createLocalRowModel({
        rows: [hostileOwnKeys],
        columns,
        getRowId: (row) => row.id,
      }),
    ).toThrowError(PretableRowModelError);

    const getterRow = Object.preventExtensions(
      Object.defineProperties(
        {},
        {
          id: { enumerable: true, value: 2 },
          label: {
            enumerable: true,
            get: () => {
              throw new Error("getter");
            },
          },
        },
      ),
    ) as Row;
    expect(() =>
      createLocalRowModel({
        rows: [getterRow],
        columns,
        getRowId: (row) => row.id,
        query: {
          filters: [{ columnId: "label", operator: "equals", value: "x" }],
          sort: [],
          rowGroups: [],
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "accessor-failed",
        rowId: 2,
        columnId: "label",
      }),
    );
  });

  test("does no row scan or freeze in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { createLocalRowModel: createProductionModel } =
      await import("../create-local-row-model");
    const row = { id: 1, label: "one" };
    const ownKeys = vi.fn(Reflect.ownKeys);
    const proxy = new Proxy<Row>(row, {
      ownKeys: (target) => ownKeys(target),
    });
    const model = createProductionModel({
      rows: [proxy],
      columns,
      getRowId: (value: Row) => value.id,
    });

    expect(Object.isFrozen(row)).toBe(false);
    expect(ownKeys).not.toHaveBeenCalled();
    expect(model.getState().snapshot.rowAt(0)).toMatchObject({ row: proxy });
  });
});

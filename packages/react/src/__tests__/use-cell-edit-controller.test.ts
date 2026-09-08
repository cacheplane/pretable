import { describe, expect, it, vi } from "vitest";

import type { PretableColumn } from "@pretable/core";

import { createGridUiCore } from "@pretable-internal/grid-core";
import {
  createColumnHelper,
  createLocalRowModel,
} from "@pretable-internal/row-model";
import { resetDevWarnings } from "../dev-warn";

import { createCellEditController } from "../use-cell-edit-controller";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}
const ROWS: Row[] = [{ id: "r1", name: "Ada" }];

function setup(
  columnOverrides: Partial<PretableColumn<Row>> = {},
  onCommit = vi.fn(),
  rows = ROWS,
) {
  const columns: PretableColumn<Row>[] = [
    { id: "name", editable: true, ...columnOverrides },
  ];
  let editing: {
    rowId: string;
    columnId: string;
    draft: unknown;
    status: string;
    error?: string;
  } | null = null;
  let sessionToken = 0;
  const grid = {
    getEditSessionToken: () => sessionToken,
    markChecking() {
      if (editing !== null) editing = { ...editing, status: "checking" };
    },
    beginEdit(
      addr: { readonly rowId: string; readonly columnId: string },
      edit?: {
        readonly draft?: unknown;
        readonly status?: "checking" | "editing";
        readonly seededFromTyping?: boolean;
      },
    ) {
      sessionToken += 1;
      editing = {
        ...addr,
        draft: edit?.draft,
        status: edit?.status ?? "editing",
      };
    },
    getSnapshot: () => ({ editing }),
    setEditDraft(draft: unknown) {
      if (editing !== null) editing = { ...editing, draft };
    },
    markEditing() {
      if (editing !== null) editing = { ...editing, status: "editing" };
    },
    markEditValidating() {
      if (editing !== null) editing = { ...editing, status: "validating" };
    },
    markEditSaving() {
      if (editing !== null) editing = { ...editing, status: "saving" };
    },
    markEditInvalid(error: string) {
      if (editing !== null) editing = { ...editing, status: "editing", error };
    },
    markEditError(error: string) {
      if (editing !== null) editing = { ...editing, status: "error", error };
    },
    commitEditSucceeded() {
      editing = null;
    },
    cancelEdit() {
      editing = null;
    },
    moveFocus: vi.fn(),
  };
  const controller = createCellEditController({
    grid,
    getColumns: () => columns,
    getRowById: (id) => rows.find((r) => r.id === id) ?? null,
    onCommit,
  });
  return { grid, controller, onCommit, columns };
}

describe("cell edit controller", () => {
  it("begins an edit immediately when editable === true", async () => {
    const { grid, controller } = setup();
    await controller.begin({ rowId: "r1", columnId: "name" });
    expect(grid.getSnapshot().editing).toMatchObject({
      rowId: "r1",
      status: "editing",
    });
  });

  it("forwards explicit typing provenance and defaults other begins to false", async () => {
    const { grid, controller } = setup();
    const beginEdit = vi.spyOn(grid, "beginEdit");

    await controller.begin({ rowId: "r1", columnId: "name" }, "x", {
      seededFromTyping: true,
    });
    expect(beginEdit).toHaveBeenLastCalledWith(
      { rowId: "r1", columnId: "name" },
      { draft: "x", status: "editing", seededFromTyping: true },
    );

    await controller.begin({ rowId: "r1", columnId: "name" });
    expect(beginEdit).toHaveBeenLastCalledWith(
      { rowId: "r1", columnId: "name" },
      { draft: "Ada", status: "editing", seededFromTyping: false },
    );
  });

  it("gates begin through 'checking' for async editable", async () => {
    let resolve!: (v: boolean) => void;
    const { grid, controller } = setup({
      editable: () => new Promise<boolean>((r) => (resolve = r)),
    });
    const p = controller.begin({ rowId: "r1", columnId: "name" });
    expect(grid.getSnapshot().editing?.status).toBe("checking");
    resolve(true);
    await p;
    expect(grid.getSnapshot().editing?.status).toBe("editing");
  });

  it("does not begin when async editable resolves false", async () => {
    const { grid, controller } = setup({
      editable: () => Promise.resolve(false),
    });
    await controller.begin({ rowId: "r1", columnId: "name" });
    expect(grid.getSnapshot().editing).toBeNull();
  });

  it("validate failure returns to editing with the message", async () => {
    const { grid, controller } = setup({ validate: () => "too short" });
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("x");
    await controller.commit("down");
    expect(grid.getSnapshot().editing).toMatchObject({
      status: "editing",
      error: "too short",
    });
  });

  it("successful async commit calls onCommit then clears the edit", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const { grid, controller } = setup({}, onCommit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("Ada L.");
    await controller.commit("down");
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "r1",
        columnId: "name",
        value: "Ada L.",
      }),
    );
    expect(grid.getSnapshot().editing).toBeNull();
  });

  it("commit rejection enters 'error'", async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error("boom"));
    const { grid, controller } = setup({}, onCommit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    await controller.commit("down");
    expect(grid.getSnapshot().editing).toMatchObject({
      status: "error",
      error: "boom",
    });
  });

  it("rejects a non-numeric draft for a number column via built-in parsing", async () => {
    const onCommit = vi.fn();
    const { grid, controller } = setup({ type: "number" }, onCommit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("abc");
    await controller.commit("down");
    expect(grid.getSnapshot().editing).toMatchObject({
      status: "editing",
      error: "Not a number",
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits a parsed number (and null for empty) for number columns", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const { grid, controller } = setup({ type: "number" }, onCommit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("42.5");
    await controller.commit("down");
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ value: 42.5 }),
    );
  });

  it("retains an untouched canonical null date without marking it invalid", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const nullRows = [{ id: "r1", name: null as unknown as string }];
    const { grid, controller } = setup({ type: "date" }, onCommit, nullRows);
    await controller.begin({ rowId: "r1", columnId: "name" });
    await controller.commit();

    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ value: null }),
    );
    expect(grid.getSnapshot().editing).toBeNull();
  });

  it("drops a stale async-editable resolution after cancel (staleness guard)", async () => {
    let resolve!: (v: boolean) => void;
    const { grid, controller } = setup({
      editable: () => new Promise<boolean>((r) => (resolve = r)),
    });
    const p = controller.begin({ rowId: "r1", columnId: "name" });
    controller.cancel();
    expect(grid.getSnapshot().editing).toBeNull();
    resolve(true);
    await p;
    expect(grid.getSnapshot().editing).toBeNull(); // stale true did not re-open
  });

  it("requires the authorization returned by the exact begin before committing", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const { grid, controller } = setup({}, onCommit);
    const first = await controller.begin({ rowId: "r1", columnId: "name" });
    const replacement = await controller.begin(
      { rowId: "r1", columnId: "name" },
      "replacement",
    );
    if (first === null || replacement === null) {
      throw new Error("editable begins must return authorizations");
    }

    await controller.commit(undefined, first);
    expect(onCommit).not.toHaveBeenCalled();
    expect(grid.getSnapshot().editing).toMatchObject({ draft: "replacement" });

    await controller.commit(undefined, replacement);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ value: "replacement" }),
    );
  });

  it("invalidates async editable without acting on the engine", async () => {
    let resolve!: (value: boolean) => void;
    const { grid, controller } = setup({
      editable: () => new Promise<boolean>((accept) => (resolve = accept)),
    });
    const markEditing = vi.spyOn(grid, "markEditing");
    const cancelEdit = vi.spyOn(grid, "cancelEdit");
    const pending = controller.begin({ rowId: "r1", columnId: "name" });

    controller.invalidate();
    expect(cancelEdit).not.toHaveBeenCalled();
    resolve(true);
    await pending;

    expect(markEditing).not.toHaveBeenCalled();
    expect(cancelEdit).not.toHaveBeenCalled();
  });

  it("invalidates validation before it can invoke onCommit", async () => {
    let resolveValidation!: (value: true) => void;
    const onCommit = vi.fn();
    const { grid, controller } = setup(
      {
        validate: () =>
          new Promise<true>((resolve) => (resolveValidation = resolve)),
      },
      onCommit,
    );
    const markEditSaving = vi.spyOn(grid, "markEditSaving");
    await controller.begin({ rowId: "r1", columnId: "name" });
    const pending = controller.commit();

    controller.invalidate();
    resolveValidation(true);
    await pending;

    expect(markEditSaving).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "invalidates an in-flight save before its %s can mutate edit state",
    async (outcome) => {
      let resolveSave!: () => void;
      let rejectSave!: (error: Error) => void;
      const save = new Promise<void>((resolve, reject) => {
        resolveSave = resolve;
        rejectSave = reject;
      });
      const onCommit = vi.fn(() => save);
      const { grid, controller } = setup({}, onCommit);
      const commitEditSucceeded = vi.spyOn(grid, "commitEditSucceeded");
      const markEditError = vi.spyOn(grid, "markEditError");
      await controller.begin({ rowId: "r1", columnId: "name" });
      const pending = controller.commit();
      expect(onCommit).toHaveBeenCalledOnce();

      controller.invalidate();
      if (outcome === "resolve") resolveSave();
      else rejectSave(new Error("stale save failed"));
      await pending;

      expect(commitEditSucceeded).not.toHaveBeenCalled();
      expect(markEditError).not.toHaveBeenCalled();
    },
  );
});

describe("controller lifecycle admission", () => {
  const addr = { rowId: "r1", columnId: "name" };
  it("rejects an early tokenless commit while permission is checking", async () => {
    let resolve!: (allowed: boolean) => void;
    const { controller, grid, onCommit } = setup({
      editable: () =>
        new Promise<boolean>((r) => {
          resolve = r;
        }),
    });
    const begin = controller.begin(addr);
    await controller.commit();
    expect(onCommit).not.toHaveBeenCalled();
    expect(grid.getSnapshot().editing?.status).toBe("checking");
    resolve(false);
    await begin;
    expect(grid.getSnapshot().editing).toBeNull();
  });
  it("blocks duplicate and parser-reentrant commits synchronously", async () => {
    let reentered = false;
    const parse = vi.fn(() => {
      expect(grid.getSnapshot().editing?.status).toBe("validating");
      if (!reentered) {
        reentered = true;
        void controller.commit();
      }
      return "parsed";
    });
    const { controller, grid, onCommit } = setup({ parseEditValue: parse });
    await controller.begin(addr);
    await Promise.all([controller.commit(), controller.commit()]);
    expect(parse).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledOnce();
  });
  it.each(["editable", "parseEditValue", "validate"] as const)(
    "contains %s exceptions and retains a recoverable draft",
    async (stage) => {
      const callback = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error(stage);
        })
        .mockReturnValue(true);
      const { controller, grid, onCommit } = setup({ [stage]: callback });
      await expect(controller.begin(addr, "draft")).resolves.toBeDefined();
      if (stage !== "editable")
        await expect(controller.commit()).resolves.toBeUndefined();
      expect(grid.getSnapshot().editing).toMatchObject({
        status: "error",
        draft: "draft",
        error: stage,
      });
      await controller.commit();
      expect(grid.getSnapshot().editing).toBeNull();
      expect(onCommit).toHaveBeenCalledOnce();
    },
  );
  it("retries failed permission through checking before parsing", async () => {
    const editable = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(false);
    const { controller, grid, onCommit } = setup({ editable });
    await controller.begin(addr);
    const retry = controller.commit();
    expect(grid.getSnapshot().editing?.status).toBe("checking");
    await retry;
    expect(editable).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();
    expect(grid.getSnapshot().editing).toBeNull();
  });
  it("retires the old session before a failed replacement begin", async () => {
    const { controller, grid, onCommit } = setup();
    await controller.begin(addr);
    await controller.begin({ ...addr, columnId: "missing" });
    await controller.commit();
    expect(grid.getSnapshot().editing).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });
  it("rejects same-address adapter replacement during parsing", async () => {
    const { controller, grid, onCommit } = setup({
      parseEditValue: () => {
        grid.beginEdit(addr, { draft: "replacement" });
        return "old";
      },
    });
    await controller.begin(addr);
    await controller.commit();
    expect(onCommit).not.toHaveBeenCalled();
    expect(grid.getSnapshot().editing?.draft).toBe("replacement");
  });
  it("retains the saving barrier after keep-open", async () => {
    const { controller, grid, onCommit } = setup(
      {},
      vi.fn().mockResolvedValue("keep-open"),
    );
    await controller.begin(addr);
    await controller.commit();
    await controller.commit();
    expect(grid.getSnapshot().editing?.status).toBe("saving");
    expect(onCommit).toHaveBeenCalledOnce();
  });
});

describe("controller callback boundaries", () => {
  const addr = { rowId: "r1", columnId: "name" };
  it.each(["value", "formatEditValue"] as const)(
    "diagnoses pre-session %s failure once and retires the old edit",
    async (stage) => {
      resetDevWarnings();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { controller, grid, columns } = setup();
      await controller.begin(addr);
      columns[0]![stage] = () => {
        throw new Error("consumer failed");
      };
      await expect(controller.begin(addr)).resolves.toBeNull();
      await expect(controller.begin(addr)).resolves.toBeNull();
      expect(grid.getSnapshot().editing).toBeNull();
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("consumer failed"),
      );
      warn.mockRestore();
    },
  );
  it.each(["getColumns", "getRowById", "value"] as const)(
    "contains active %s failures",
    async (stage) => {
      const base = setup();
      let fail = false;
      const controller = createCellEditController({
        grid: base.grid,
        getColumns: () => {
          if (fail && stage === "getColumns") throw new Error(stage);
          return [
            {
              id: "name",
              editable: true,
              value: () => {
                if (fail && stage === "value") throw new Error(stage);
                return "Ada";
              },
            },
          ];
        },
        getRowById: () => {
          if (fail && stage === "getRowById") throw new Error(stage);
          return ROWS[0]!;
        },
      });
      await controller.begin(addr);
      fail = true;
      await expect(controller.commit()).resolves.toBeUndefined();
      expect(base.grid.getSnapshot().editing).toMatchObject({
        status: "error",
        error: stage,
        draft: "Ada",
      });
      fail = false;
      await controller.commit();
      expect(base.grid.getSnapshot().editing).toBeNull();
    },
  );
  for (const stage of [
    "editable",
    "parseEditValue",
    "validate",
    "save",
  ] as const) {
    for (const retire of [
      "cancel",
      "invalidate",
      "begin",
      "adapter",
    ] as const) {
      it.each(["resolve", "reject"] as const)(
        `ignores stale ${stage} %s after ${retire}`,
        async (outcome) => {
          let resolve!: (value: true) => void;
          let reject!: (error: Error) => void;
          const deferred = new Promise<true>((yes, no) => {
            resolve = yes;
            reject = no;
          });
          const callback = vi
            .fn()
            .mockReturnValueOnce(deferred)
            .mockReturnValue(true);
          const save = stage === "save" ? callback : vi.fn();
          const { controller, grid } = setup(
            stage === "save" ? {} : { [stage]: callback },
            save,
          );
          let pending: Promise<unknown>;
          if (stage === "editable") pending = controller.begin(addr);
          else {
            await controller.begin(addr);
            pending = controller.commit();
          }
          if (retire === "begin") await controller.begin(addr, "replacement");
          else if (retire === "adapter")
            grid.beginEdit(addr, { draft: "replacement" });
          else controller[retire]();
          const before = grid.getSnapshot().editing;
          if (outcome === "resolve") resolve(true);
          else reject(new Error("stale"));
          await pending;
          expect(grid.getSnapshot().editing).toEqual(before);
          if (stage !== "save") expect(save).not.toHaveBeenCalled();
        },
      );
    }
  }
  it("does not overwrite an adapter replacement made by the begin formatter", async () => {
    const { controller, grid } = setup({
      formatEditValue: () => {
        grid.beginEdit(addr, { draft: "replacement" });
        return "stale seed";
      },
    });
    expect(await controller.begin(addr)).toBeNull();
    expect(grid.getSnapshot().editing?.draft).toBe("replacement");
  });
  it.each(["editable", "validate", "save"] as const)(
    "blocks synchronous %s callback reentry",
    async (stage) => {
      const callback = vi.fn(() => {
        void controller.commit();
        return true;
      });
      const save =
        stage === "save"
          ? vi.fn(() => {
              void controller.commit();
            })
          : vi.fn();
      const { controller } = setup(
        stage === "save" ? {} : { [stage]: callback },
        save,
      );
      await controller.begin(addr);
      await controller.commit();
      if (stage !== "save") expect(callback).toHaveBeenCalledOnce();
      expect(save).toHaveBeenCalledOnce();
    },
  );
  it("retains granted permission across validation and save retries", async () => {
    const editable = vi.fn().mockResolvedValue(true);
    const validate = vi
      .fn()
      .mockReturnValueOnce("invalid")
      .mockReturnValue(true);
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("retry"))
      .mockResolvedValue(undefined);
    const { controller, grid } = setup({ editable, validate }, save);
    const authorization = await controller.begin(addr);
    if (!authorization) throw new Error("expected authorization");
    await controller.commit(undefined, authorization);
    expect(grid.getSnapshot().editing?.status).toBe("editing");
    await controller.commit(undefined, authorization);
    expect(grid.getSnapshot().editing?.status).toBe("error");
    await controller.commit(undefined, authorization);
    expect(grid.getSnapshot().editing).toBeNull();
    expect(editable).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("protects the real indexed-core draft against parser reentry", async () => {
    const helper = createColumnHelper<Row>();
    const core = createGridUiCore({
      rowModel: createLocalRowModel({
        rows: ROWS,
        columns: [helper.accessor("name", { type: "text" })],
      }),
      columns: [{ id: "name", widthPx: 180 }],
    });
    core.observeRowModelRevision(0);
    const base = setup();
    const controller = createCellEditController({
      grid: {
        ...base.grid,
        beginEdit: (address, edit) =>
          core.beginEdit({
            ...address,
            columnId: "name",
            value: edit?.draft as never,
            status: edit?.status,
          }),
        getSnapshot: () => ({
          editing: core.getState().editing
            ? {
                ...core.getState().editing!,
                draft: core.getState().editing!.value,
              }
            : null,
        }),
        markEditValidating: () => core.setEditStatus("validating"),
        markEditSaving: () => core.setEditStatus("saving"),
      },
      getColumns: () => [
        {
          id: "name",
          editable: true,
          parseEditValue: (draft) => {
            core.setEditDraft("corrupted" as never);
            expect(core.getState().editing?.value).toBe("original");
            return draft;
          },
        },
      ],
      getRowById: () => ROWS[0]!,
      onCommit: () => "keep-open",
    });
    await controller.begin(addr, "original");
    await controller.commit();
    expect(core.getState().editing).toMatchObject({
      status: "saving",
      value: "original",
    });
  });
});

describe("async parser recovery", () => {
  const addr = { rowId: "r1", columnId: "name" };
  it("contains rejected parser results and retries with the resolved parsed value", async () => {
    let reject!: (error: Error) => void;
    const parse = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((_, no) => {
            reject = no;
          }),
      )
      .mockResolvedValue("parsed retry");
    const validate = vi.fn().mockReturnValue(true);
    const { controller, grid, onCommit } = setup({
      parseEditValue: parse,
      validate,
    });
    await controller.begin(addr, "draft");
    const pending = controller.commit();
    const status = grid.getSnapshot().editing?.status;
    const validationCalls = validate.mock.calls.length;
    reject(new Error("parse failed"));
    await pending;
    expect(status).toBe("validating");
    expect(validationCalls).toBe(0);
    expect(grid.getSnapshot().editing).toMatchObject({
      status: "error",
      error: "parse failed",
      draft: "draft",
    });
    expect(onCommit).not.toHaveBeenCalled();
    await controller.commit();
    expect(validate).toHaveBeenCalledWith("parsed retry", expect.anything());
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ value: "parsed retry" }),
    );
    expect(grid.getSnapshot().editing).toBeNull();
  });
  it("retires saving before a failed replacement and permits a later successful begin", async () => {
    let finish!: () => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { controller, grid } = setup({}, save);
    await controller.begin(addr, "old");
    const pending = controller.commit();
    expect(grid.getSnapshot().editing?.status).toBe("saving");
    expect(await controller.begin({ ...addr, columnId: "missing" })).toBeNull();
    expect(grid.getSnapshot().editing).toBeNull();
    const authorization = await controller.begin(addr, "new");
    expect(authorization).not.toBeNull();
    finish();
    await pending;
    expect(grid.getSnapshot().editing).toMatchObject({
      draft: "new",
      status: "editing",
    });
    await controller.commit();
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: "new" }),
    );
    expect(grid.getSnapshot().editing).toBeNull();
  });
});

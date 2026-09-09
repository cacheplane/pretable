import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createColumnHelper, createLocalRowModel } from "@pretable/core";
import { PretableSurface } from "../pretable-surface";
import type { PretableEditorInput } from "../types";

afterEach(cleanup);
const rows = [{ id: "r1", value: "queued" }];
const getRowId = (row: (typeof rows)[number]) => row.id;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((r, fail) => {
    resolve = r;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function begin() {
  const cell = screen.getAllByRole("gridcell")[0];
  fireEvent.click(cell);
  fireEvent.keyDown(cell, { key: "Enter" });
}
it.each([true, false])(
  "enum waits for deferred permission %s before saving",
  async (allowed) => {
    const permission = deferred<boolean>();
    const save = vi.fn();
    render(
      <PretableSurface
        ariaLabel="Lifecycle"
        columns={[
          {
            id: "value",
            type: "enum",
            options: [
              { value: "queued", label: "Queued" },
              { value: "done", label: "Done" },
            ],
            editable: () => permission.promise,
          },
        ]}
        rows={rows}
        getRowId={getRowId}
        viewportHeight={300}
        onRowChange={save}
      />,
    );
    begin();
    const box = screen.getByRole("combobox");
    expect(box).toHaveValue("Queued");
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Done" }));
    expect(box).toHaveValue("Queued");
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      permission.resolve(allowed);
      await permission.promise;
    });
    if (!allowed) {
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
      return;
    }
    expect(screen.getByRole("combobox")).toBe(box);
    expect(box).toHaveValue("Queued");
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ value: "queued" }),
    );
  },
);

function EagerEditor({
  input,
}: {
  input: Pick<PretableEditorInput, "setDraft" | "commit" | "status">;
}) {
  useLayoutEffect(() => {
    input.setDraft("early");
    input.commit();
    // Deliberately act only at mount, including when permission is pending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button type="button" onClick={() => input.commit()}>
      Save {input.status}
    </button>
  );
}
it("contains direct custom-editor early commits and repeated controlled-row saves", async () => {
  const permission = deferred<boolean>();
  const saving = deferred<void>();
  const save = vi.fn(() => saving.promise);
  const columns = [
    {
      id: "value",
      editable: () => permission.promise,
      renderEditor: (input: PretableEditorInput) => (
        <EagerEditor input={input} />
      ),
    },
  ];
  const { rerender } = render(
    <PretableSurface
      ariaLabel="Lifecycle"
      columns={columns}
      rows={rows}
      getRowId={getRowId}
      viewportHeight={300}
      onRowChange={save}
    />,
  );
  begin();
  fireEvent.click(screen.getByRole("button", { name: "Save checking" }));
  expect(save).not.toHaveBeenCalled();
  await act(async () => {
    permission.resolve(true);
    await permission.promise;
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save editing" }));
  });
  expect(save).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ value: "queued" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save saving" }));
  await act(async () => {
    saving.resolve();
    await saving.promise;
  });
  fireEvent.click(screen.getByRole("button", { name: "Save saving" }));
  expect(save).toHaveBeenCalledTimes(1);
  rerender(
    <PretableSurface
      ariaLabel="Lifecycle"
      columns={columns}
      rows={[{ id: "r1", value: "queued" }]}
      getRowId={getRowId}
      viewportHeight={300}
      onRowChange={save}
    />,
  );
  expect(
    screen.queryByRole("button", { name: /Save/ }),
  ).not.toBeInTheDocument();
});
it("drops permission completion after an eager editor is unmounted", async () => {
  const permission = deferred<boolean>();
  const save = vi.fn();
  const { unmount } = render(
    <PretableSurface
      ariaLabel="Lifecycle"
      columns={[
        {
          id: "value",
          editable: () => permission.promise,
          renderEditor: (input) => <EagerEditor input={input} />,
        },
      ]}
      rows={rows}
      getRowId={getRowId}
      viewportHeight={300}
      onRowChange={save}
    />,
  );
  begin();
  unmount();
  await act(async () => {
    permission.resolve(true);
    await permission.promise;
  });
  expect(save).not.toHaveBeenCalled();
});
it.each([true, false])(
  "boolean toggle waits for permission %s",
  async (allowed) => {
    const permission = deferred<boolean>();
    const save = vi.fn();
    render(
      <PretableSurface
        ariaLabel="Lifecycle"
        columns={[
          { id: "value", type: "boolean", editable: () => permission.promise },
        ]}
        rows={[{ id: "r1", value: false }]}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={save}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      permission.resolve(allowed);
      await permission.promise;
    });
    if (allowed)
      expect(save).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ value: true }),
      );
    else expect(save).not.toHaveBeenCalled();
  },
);
it("model replacement retires pending permission without touching its new editor", async () => {
  const permission = deferred<boolean>();
  const editable = vi
    .fn()
    .mockReturnValueOnce(permission.promise)
    .mockReturnValue(true);
  const schema = [
    createColumnHelper<(typeof rows)[number]>().accessor("value", {
      type: "text",
    }),
  ] as const;
  const first = createLocalRowModel({ rows, columns: schema, getRowId });
  const second = createLocalRowModel({ rows, columns: schema, getRowId });
  const columns = [{ ...schema[0], editable }] as const;
  const save = vi.fn();
  const { rerender, unmount } = render(
    <PretableSurface
      ariaLabel="Lifecycle"
      model={first}
      columns={columns}
      viewportHeight={300}
      beforeRowChange={save}
    />,
  );
  begin();
  expect(screen.getByRole("textbox")).toHaveAttribute("aria-busy", "true");
  rerender(
    <PretableSurface
      ariaLabel="Lifecycle"
      model={second}
      columns={columns}
      viewportHeight={300}
      beforeRowChange={save}
    />,
  );
  await act(async () => {});
  begin();
  await act(async () => {});
  expect(editable).toHaveBeenCalledTimes(2);
  const box = screen.getByRole("textbox");
  fireEvent.change(box, { target: { value: "replacement draft" } });
  await act(async () => {
    permission.resolve(false);
    await permission.promise;
  });
  expect(screen.getByRole("textbox")).toBe(box);
  expect(box).toHaveValue("replacement draft");
  expect(save).not.toHaveBeenCalled();
  unmount();
  first.dispose();
  second.dispose();
});
it("preserves an enum correction when typing clears a permission error", async () => {
  const permission = deferred<boolean>();
  const save = vi.fn();
  render(
    <PretableSurface
      ariaLabel="Lifecycle"
      columns={[
        {
          id: "value",
          type: "enum",
          options: [
            { value: "queued", label: "Queued" },
            { value: "done", label: "Done" },
          ],
          editable: () => permission.promise,
        },
      ]}
      rows={rows}
      getRowId={getRowId}
      viewportHeight={300}
      onRowChange={save}
    />,
  );
  begin();
  await act(async () => {
    permission.reject(new Error("permission unavailable"));
    await permission.promise.catch(() => {});
  });
  const box = screen.getByRole("combobox");
  fireEvent.change(box, { target: { value: "done" } });
  expect(box).toHaveValue("done");
  expect(save).not.toHaveBeenCalled();
});

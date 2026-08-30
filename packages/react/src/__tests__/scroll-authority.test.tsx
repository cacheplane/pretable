// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createColumnHelper, createLocalRowModel } from "@pretable/core";
import type { RowLayoutController } from "@pretable-internal/renderer-dom";

type Row = { id: number; label: string };

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("label", { type: "text", wrap: true, widthPx: 180 }),
] as const;

type Controller = RowLayoutController<Row, number, typeof columns>;

const controllerRecords: Array<{
  readonly controller: Controller;
  readonly setViewport: ReturnType<typeof vi.fn<Controller["setViewport"]>>;
}> = [];

vi.mock("@pretable-internal/renderer-dom", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@pretable-internal/renderer-dom")>();
  const createRowLayoutController: typeof actual.createRowLayoutController = (
    options,
  ) => {
    const controller = actual.createRowLayoutController(options);
    const setViewport = vi.fn(controller.setViewport);
    const wrapped = { ...controller, setViewport };
    controllerRecords.push({
      controller: wrapped as unknown as Controller,
      setViewport: setViewport as unknown as ReturnType<
        typeof vi.fn<Controller["setViewport"]>
      >,
    });
    return wrapped;
  };
  return { ...actual, createRowLayoutController };
});

const { usePretable } = await import("../use-pretable");

afterEach(() => {
  cleanup();
  controllerRecords.length = 0;
  vi.clearAllMocks();
});

describe("scroll authority", () => {
  test("a controller rebuild does not re-feed an unchanged grid viewport", async () => {
    const rows = Array.from({ length: 2_000 }, (_, id): Row => ({
      id,
      label: `row ${id}`,
    }));
    const model = createLocalRowModel({ rows, columns });
    const view = renderHook(() =>
      usePretable({ model, overscan: 0, viewportHeight: 120 }),
    );

    expect(controllerRecords).toHaveLength(1);
    const { controller, setViewport } = controllerRecords[0]!;
    await expect.poll(() => controller.getState().status.kind).toBe("ready");

    act(() => {
      view.result.current.grid.setViewport({
        scrollTop: 800,
        scrollLeft: 0,
        height: 120,
        width: 600,
      });
    });
    await expect.poll(() => controller.getState().scrollTop).toBe(800);
    setViewport.mockClear();

    await act(async () => {
      model.setRows(
        rows.map((_, offset): Row => ({
          id: rows.length + offset,
          label: `replacement ${offset}`,
        })),
      );
      expect(controller.getState().status.kind).toBe("rebuilding");
      await expect.poll(() => controller.getState().status.kind).toBe("ready");
    });

    expect(setViewport).not.toHaveBeenCalled();

    view.unmount();
    model.dispose();
  });
});

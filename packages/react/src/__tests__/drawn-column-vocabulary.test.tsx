// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "@pretable/core";

import { ROW_SELECT_COLUMN_ID } from "../constants";
import { usePretableModelInternal } from "../pretable-model";

/**
 * The engine is instantiated with the SCHEMA column tuple but fed the DRAWN
 * columns, which include presentation-only synthetics the schema never
 * declares. Those two vocabularies used to share one type parameter, and five
 * `as never` casts in `pretable-model.ts` were what let the drawn set through:
 * the initial `columns`, `setColumns`, `setColumnOrder`, `setColumnWidth` and
 * `setColumnPinned`. Splitting the vocabularies (`TColumnId`) removed all five.
 *
 * A cast removal that silently stopped one of those five writes reaching the
 * engine would pass every type test, so each is asserted here against the
 * engine's own published `columnLayout` — the array the renderer, copy, paste
 * and selection all resolve column spans against.
 */
interface Row {
  id: number;
  label: string;
  score: number;
}

const column = createColumnHelper<Row>();
const schemaColumns = [
  column.accessor("label", { type: "text" }),
  column.accessor("score", { type: "number" }),
] as const;
const rows: readonly Row[] = [
  { id: 1, label: "one", score: 1 },
  { id: 2, label: "two", score: 2 },
];

/** A drawn column as the surface builds them: `{id}` plus visual fields only. */
type Drawn = {
  readonly id: string;
  readonly widthPx?: number;
  readonly pinned?: "left" | "right";
  readonly value?: (row: Row) => unknown;
};

const SELECT: Drawn = {
  id: ROW_SELECT_COLUMN_ID,
  widthPx: 36,
  value: () => "",
};
const LABEL: Drawn = { id: "label", widthPx: 100 };
const SCORE: Drawn = { id: "score", widthPx: 120 };

function renderModel(initial: readonly Drawn[]) {
  // Built once and captured: the hook keys its engine stores on row-model
  // identity, so a model rebuilt per render would rebuild the engine per
  // render and none of these assertions would be about reconciliation.
  const rowModel = createLocalRowModel({ rows, columns: schemaColumns });
  return renderHook(
    (drawn: readonly Drawn[]) =>
      usePretableModelInternal({
        rowModel,
        columns: drawn,
        viewportHeight: 200,
        // The escape hatch the surface uses to draw beyond the schema. Without
        // it the hook throws rather than letting an unschema'd id through.
        allowVisualExtras: true,
      }),
    { initialProps: initial },
  );
}

/** Ids in the engine's own published order, which IS the drawn order. */
const layoutIds = (result: { current: { gridSnapshot: unknown } }) =>
  (
    result.current.gridSnapshot as {
      columnLayout: readonly { id: string }[];
    }
  ).columnLayout.map((entry) => entry.id);

const layoutEntry = (
  result: { current: { gridSnapshot: unknown } },
  id: string,
) =>
  (
    result.current.gridSnapshot as {
      columnLayout: readonly {
        id: string;
        widthPx: number;
        pinned?: "left" | "right";
      }[];
    }
  ).columnLayout.find((entry) => entry.id === id);

afterEach(cleanup);

describe("drawn columns reach the engine", () => {
  test("the INITIAL drawn set keeps a synthetic column the schema never declared", () => {
    const { result } = renderModel([SELECT, LABEL, SCORE]);
    expect(layoutIds(result)).toEqual([ROW_SELECT_COLUMN_ID, "label", "score"]);
    // Not merely present — carrying the width it was drawn with, so the
    // assertion cannot pass on a defaulted placeholder column.
    expect(layoutEntry(result, ROW_SELECT_COLUMN_ID)?.widthPx).toBe(36);
  });

  test("setColumns applies when the drawn SET changes to include a synthetic", () => {
    const { result, rerender } = renderModel([LABEL, SCORE]);
    expect(layoutIds(result)).toEqual(["label", "score"]);
    rerender([SELECT, LABEL, SCORE]);
    expect(layoutIds(result)).toEqual([ROW_SELECT_COLUMN_ID, "label", "score"]);
    // …and back out again, so the assertion above cannot pass by the layout
    // simply accumulating every id it has ever seen.
    rerender([LABEL, SCORE]);
    expect(layoutIds(result)).toEqual(["label", "score"]);
  });

  test("setColumnOrder applies a reorder that names a synthetic id", () => {
    const { result, rerender } = renderModel([SELECT, LABEL, SCORE]);
    rerender([LABEL, SCORE, SELECT]);
    expect(layoutIds(result)).toEqual(["label", "score", ROW_SELECT_COLUMN_ID]);
  });

  test("setColumnWidth applies to a synthetic id", () => {
    const { result, rerender } = renderModel([SELECT, LABEL, SCORE]);
    rerender([{ ...SELECT, widthPx: 72 }, LABEL, SCORE]);
    expect(layoutEntry(result, ROW_SELECT_COLUMN_ID)?.widthPx).toBe(72);
    // The untouched columns keep their own widths, so this cannot pass by
    // every column having become 72.
    expect(layoutEntry(result, "label")?.widthPx).toBe(100);
  });

  test("setColumnPinned applies to a synthetic id", () => {
    const { result, rerender } = renderModel([SELECT, LABEL, SCORE]);
    expect(layoutEntry(result, ROW_SELECT_COLUMN_ID)?.pinned).toBeUndefined();
    rerender([{ ...SELECT, pinned: "left" }, LABEL, SCORE]);
    expect(layoutEntry(result, ROW_SELECT_COLUMN_ID)?.pinned).toBe("left");
    expect(layoutEntry(result, "label")?.pinned).toBeUndefined();
  });
});

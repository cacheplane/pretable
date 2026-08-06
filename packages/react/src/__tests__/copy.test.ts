import { describe, expect, it } from "vitest";

import {
  defaultCoerceForCopy,
  escapeTsvField,
  serializeRangesAsTsv,
  type SerializeRangesArgs,
} from "../copy";
import { ROW_SELECT_COLUMN_ID } from "../pretable-surface";
import type { PretableCellRange, PretableVisibleRow } from "@pretable/core";
import type { PretableColumn } from "../types";

type Row = { id: string; a: string; b: string; c: string };

function makeVisibleRows(rows: Row[]): PretableVisibleRow<Row>[] {
  return rows.map((row, i) => ({ id: row.id, row, sourceIndex: i }));
}

const baseColumns: PretableColumn<Row>[] = [
  { id: "a", header: "A" },
  { id: "b", header: "B" },
  { id: "c", header: "C" },
];

const rows: Row[] = [
  { id: "r1", a: "a1", b: "b1", c: "c1" },
  { id: "r2", a: "a2", b: "b2", c: "c2" },
  { id: "r3", a: "a3", b: "b3", c: "c3" },
];

function range(
  startRowId: string,
  endRowId: string,
  startColumnId: string,
  endColumnId: string,
): PretableCellRange {
  return { startRowId, endRowId, startColumnId, endColumnId };
}

describe("defaultCoerceForCopy", () => {
  it("handles primitives", () => {
    expect(defaultCoerceForCopy("hello")).toBe("hello");
    expect(defaultCoerceForCopy(42)).toBe("42");
    expect(defaultCoerceForCopy(true)).toBe("true");
    expect(defaultCoerceForCopy(false)).toBe("false");
    expect(defaultCoerceForCopy(BigInt(10))).toBe("10");
  });

  it("handles null/undefined as empty string", () => {
    expect(defaultCoerceForCopy(null)).toBe("");
    expect(defaultCoerceForCopy(undefined)).toBe("");
  });

  it("handles Date as ISO", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(defaultCoerceForCopy(d)).toBe("2026-01-02T03:04:05.000Z");
  });

  it("handles plain objects via JSON", () => {
    expect(defaultCoerceForCopy({ x: 1, y: "z" })).toBe('{"x":1,"y":"z"}');
    expect(defaultCoerceForCopy([1, 2, 3])).toBe("[1,2,3]");
  });
});

describe("serializeRangesAsTsv", () => {
  it("returns null for empty ranges", () => {
    const out = serializeRangesAsTsv<Row>({
      ranges: [],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out).toBeNull();
  });

  it("single cell, single column", () => {
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out).toEqual({ text: "a1" });
  });

  it("multi-row range joined with \\n", () => {
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r3", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out).toEqual({ text: "a1\na2\na3" });
  });

  it("multi-column range joined with \\t", () => {
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r1", "a", "c")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out).toEqual({ text: "a1\tb1\tc1" });
  });

  it("multi-range blocks joined with \\n\\n", () => {
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r1", "a", "a"), range("r3", "r3", "c", "c")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out).toEqual({ text: "a1\n\nc3" });
  });

  it("copyWithHeaders=true emits header row + blank line + body", () => {
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r2", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
      copyWithHeaders: true,
    });
    expect(out).toEqual({ text: "A\tB\n\na1\tb1\na2\tb2" });
  });

  it("format on a column overrides default coercion", () => {
    const cols: PretableColumn<Row>[] = [
      {
        id: "a",
        header: "A",
        format: ({ value }) => `[${String(value)}]`,
      },
      { id: "b", header: "B" },
    ];
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r1", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
    });
    expect(out).toEqual({ text: "[a1]\tb1" });
  });

  it("range referencing only the synthetic row-select column returns null", () => {
    const cols: PretableColumn<Row>[] = [
      { id: ROW_SELECT_COLUMN_ID, header: "" },
      ...baseColumns,
    ];
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r1", ROW_SELECT_COLUMN_ID, ROW_SELECT_COLUMN_ID)],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
    });
    expect(out).toBeNull();
  });

  it("synthetic-column start bound expands to all data columns up to the endpoint", () => {
    const cols: PretableColumn<Row>[] = [
      { id: ROW_SELECT_COLUMN_ID, header: "" },
      ...baseColumns,
    ];
    // toggleRowSelection / setSelectAllVisible / selectAll all produce ranges
    // whose startColumnId === ROW_SELECT_COLUMN_ID. The synthetic column is
    // positioned before all data columns; treat it as "start of data" so
    // copy emits every cell in the row.
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r1", ROW_SELECT_COLUMN_ID, "c")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
    });
    expect(out).toEqual({ text: "a1\tb1\tc1" });
  });

  it("synthetic-column end bound expands to start at the data endpoint", () => {
    const cols: PretableColumn<Row>[] = [
      { id: ROW_SELECT_COLUMN_ID, header: "" },
      ...baseColumns,
    ];
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r1", "b", ROW_SELECT_COLUMN_ID)],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
    });
    expect(out).toEqual({ text: "a1\tb1" });
  });

  it("range with row id not in visibleRows returns null", () => {
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("missing", "missing", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out).toBeNull();
  });

  it("returns null when there are no data columns", () => {
    const args: SerializeRangesArgs<Row> = {
      ranges: [range("r1", "r1", ROW_SELECT_COLUMN_ID, ROW_SELECT_COLUMN_ID)],
      visibleRows: makeVisibleRows(rows),
      columns: [{ id: ROW_SELECT_COLUMN_ID, header: "" }],
    };
    expect(serializeRangesAsTsv(args)).toBeNull();
  });
});

describe("escapeTsvField", () => {
  it("emits plain values bare — no quoting", () => {
    // Regression guard: quoting unconditionally would change every existing
    // copy payload and surface literal quotes in consumers that don't parse.
    expect(escapeTsvField("")).toBe("");
    expect(escapeTsvField("plain")).toBe("plain");
    expect(escapeTsvField("has spaces")).toBe("has spaces");
    expect(escapeTsvField("a,b;c'd")).toBe("a,b;c'd");
    expect(escapeTsvField("1234.56")).toBe("1234.56");
  });

  it("quotes fields containing a tab", () => {
    expect(escapeTsvField("a\tb")).toBe('"a\tb"');
  });

  it("quotes fields containing LF or CR", () => {
    expect(escapeTsvField("a\nb")).toBe('"a\nb"');
    expect(escapeTsvField("a\rb")).toBe('"a\rb"');
    expect(escapeTsvField("a\r\nb")).toBe('"a\r\nb"');
  });

  it("quotes fields containing a double quote and doubles it", () => {
    expect(escapeTsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeTsvField('"')).toBe('""""');
  });
});

describe("serializeRangesAsTsv escaping", () => {
  function oneCell(
    value: string,
    columnOverrides?: Partial<PretableColumn<Row>>,
  ) {
    const row: Row = { id: "r1", a: value, b: "b1", c: "c1" };
    return serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r1", "a", "b")],
      visibleRows: makeVisibleRows([row]),
      columns: [
        { id: "a", header: "A", ...columnOverrides },
        { id: "b", header: "B" },
      ],
    });
  }

  it("quotes a cell value containing a tab", () => {
    expect(oneCell("left\tright")).toEqual({ text: '"left\tright"\tb1' });
  });

  it("quotes a cell value containing a newline (multi-line editor case)", () => {
    expect(oneCell("line one\nline two")).toEqual({
      text: '"line one\nline two"\tb1',
    });
  });

  it("quotes a cell value containing a double quote and doubles it", () => {
    expect(oneCell('he said "no"')).toEqual({ text: '"he said ""no"""\tb1' });
  });

  it("quotes a cell value containing both a quote and a newline", () => {
    expect(oneCell('he said "no"\nthen left')).toEqual({
      text: '"he said ""no""\nthen left"\tb1',
    });
  });

  it("quotes a cell value containing CRLF", () => {
    expect(oneCell("first\r\nsecond")).toEqual({
      text: '"first\r\nsecond"\tb1',
    });
  });

  it("escapes values produced by a per-column format", () => {
    expect(oneCell("x", { format: () => 'a\tb"c' })).toEqual({
      text: '"a\tb""c"\tb1',
    });
  });

  it("leaves ordinary cell values bare", () => {
    expect(oneCell("ordinary value")).toEqual({ text: "ordinary value\tb1" });
  });

  it("quotes headers containing a tab or newline", () => {
    const cols: PretableColumn<Row>[] = [
      { id: "a", header: "Col\tA" },
      { id: "b", header: "Col\nB" },
      { id: "c", header: 'Col "C"' },
    ];
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r1", "a", "c")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
      copyWithHeaders: true,
    });
    expect(out).toEqual({
      text: '"Col\tA"\t"Col\nB"\t"Col ""C"""\n\na1\tb1\tc1',
    });
  });

  it("leaves ordinary headers bare", () => {
    const out = serializeRangesAsTsv<Row>({
      ranges: [range("r1", "r1", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
      copyWithHeaders: true,
    });
    expect(out).toEqual({ text: "A\tB\n\na1\tb1" });
  });
});

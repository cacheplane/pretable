import { describe, expect, it } from "vitest";

import {
  defaultCoerceForCopy,
  escapeHtmlText,
  escapeTsvField,
  serializeRanges,
  type SerializeRangesArgs,
} from "../copy";
import { ROW_SELECT_COLUMN_ID } from "../pretable-surface";
import {
  GROUP_COLUMN_ID,
  createGrid,
  type PretableCellRange,
  type PretableGroupRow,
  type PretableVisibleRow,
} from "@pretable/core";
import type { PretableColumn } from "../types";

type Row = { id: string; a: string; b: string; c: string };

function makeVisibleRows(rows: Row[]): PretableVisibleRow<Row>[] {
  return rows.map((row, i) => ({
    kind: "data" as const,
    id: row.id,
    row,
    sourceIndex: i,
    depth: 0,
  }));
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

describe("serializeRanges", () => {
  it("returns null for empty ranges", () => {
    const out = serializeRanges<Row>({
      ranges: [],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out).toBeNull();
  });

  it("single cell, single column", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.text).toBe("a1");
  });

  it("multi-row range joined with \\n", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r3", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.text).toBe("a1\na2\na3");
  });

  it("multi-column range joined with \\t", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "c")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.text).toBe("a1\tb1\tc1");
  });

  it("multi-range blocks joined with \\n\\n", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a"), range("r3", "r3", "c", "c")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.text).toBe("a1\n\nc3");
  });

  it("copyWithHeaders=true emits header row + blank line + body", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r2", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
      copyWithHeaders: true,
    });
    expect(out?.text).toBe("A\tB\n\na1\tb1\na2\tb2");
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
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
    });
    expect(out?.text).toBe("[a1]\tb1");
  });

  it("range referencing only the synthetic row-select column returns null", () => {
    const cols: PretableColumn<Row>[] = [
      { id: ROW_SELECT_COLUMN_ID, header: "" },
      ...baseColumns,
    ];
    const out = serializeRanges<Row>({
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
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", ROW_SELECT_COLUMN_ID, "c")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
    });
    expect(out?.text).toBe("a1\tb1\tc1");
  });

  it("synthetic-column end bound expands to start at the data endpoint", () => {
    const cols: PretableColumn<Row>[] = [
      { id: ROW_SELECT_COLUMN_ID, header: "" },
      ...baseColumns,
    ];
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "b", ROW_SELECT_COLUMN_ID)],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
    });
    expect(out?.text).toBe("a1\tb1");
  });

  it("range with row id not in visibleRows returns null", () => {
    const out = serializeRanges<Row>({
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
    expect(serializeRanges(args)).toBeNull();
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

describe("serializeRanges escaping", () => {
  function oneCell(
    value: string,
    columnOverrides?: Partial<PretableColumn<Row>>,
  ) {
    const row: Row = { id: "r1", a: value, b: "b1", c: "c1" };
    return serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "b")],
      visibleRows: makeVisibleRows([row]),
      columns: [
        { id: "a", header: "A", ...columnOverrides },
        { id: "b", header: "B" },
      ],
    });
  }

  it("quotes a cell value containing a tab", () => {
    expect(oneCell("left\tright")?.text).toBe('"left\tright"\tb1');
  });

  it("quotes a cell value containing a newline (multi-line editor case)", () => {
    expect(oneCell("line one\nline two")?.text).toBe(
      '"line one\nline two"\tb1',
    );
  });

  it("quotes a cell value containing a double quote and doubles it", () => {
    expect(oneCell('he said "no"')?.text).toBe('"he said ""no"""\tb1');
  });

  it("quotes a cell value containing both a quote and a newline", () => {
    expect(oneCell('he said "no"\nthen left')?.text).toBe(
      '"he said ""no""\nthen left"\tb1',
    );
  });

  it("quotes a cell value containing CRLF", () => {
    expect(oneCell("first\r\nsecond")?.text).toBe('"first\r\nsecond"\tb1');
  });

  it("escapes values produced by a per-column format", () => {
    expect(oneCell("x", { format: () => 'a\tb"c' })?.text).toBe(
      '"a\tb""c"\tb1',
    );
  });

  it("leaves ordinary cell values bare", () => {
    expect(oneCell("ordinary value")?.text).toBe("ordinary value\tb1");
  });

  it("quotes headers containing a tab or newline", () => {
    const cols: PretableColumn<Row>[] = [
      { id: "a", header: "Col\tA" },
      { id: "b", header: "Col\nB" },
      { id: "c", header: 'Col "C"' },
    ];
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "c")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
      copyWithHeaders: true,
    });
    expect(out?.text).toBe('"Col\tA"\t"Col\nB"\t"Col ""C"""\n\na1\tb1\tc1');
  });

  it("leaves ordinary headers bare", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
      copyWithHeaders: true,
    });
    expect(out?.text).toBe("A\tB\n\na1\tb1");
  });

  describe("group rows", () => {
    type GroupCopyRow = {
      id: string;
      name: string;
      qty: number;
    };

    const columns: PretableColumn<GroupCopyRow>[] = [
      { id: GROUP_COLUMN_ID, header: "Group" },
      { id: "name", header: "Name" },
      {
        id: "qty",
        header: "Qty",
        formatAggregate: ({ value }) => `Σ ${String(value)}`,
      },
    ];
    const techGroup: PretableGroupRow = {
      kind: "group",
      id: "__group__:sector=Tech",
      depth: 0,
      columnId: "sector",
      value: "Tech",
      childCount: 2,
      aggregates: { qty: 3 },
    };
    const alpha: GroupCopyRow = { id: "r1", name: "Alpha", qty: 1 };
    const beta: GroupCopyRow = { id: "r2", name: "Beta", qty: 2 };
    const visibleRows: PretableVisibleRow<GroupCopyRow>[] = [
      techGroup,
      { kind: "data", id: alpha.id, row: alpha, sourceIndex: 0, depth: 0 },
      { kind: "data", id: beta.id, row: beta, sourceIndex: 1, depth: 0 },
    ];

    it("serializes a rectangular group header with its label and aggregates", () => {
      const out = serializeRanges<GroupCopyRow>({
        ranges: [range(techGroup.id, beta.id, GROUP_COLUMN_ID, "qty")],
        visibleRows,
        columns,
      });

      expect(out?.text).toBe("Tech\t\tΣ 3\n\tAlpha\t1\n\tBeta\t2");
      expect(out?.html?.match(/<tr>/g)).toHaveLength(3);
      expect(out?.html).toContain("<td>Tech</td><td></td><td>Σ 3</td>");
    });

    it("serializes a group-only range in the derived group column", () => {
      const out = serializeRanges<GroupCopyRow>({
        ranges: [
          range(techGroup.id, techGroup.id, GROUP_COLUMN_ID, GROUP_COLUMN_ID),
        ],
        visibleRows,
        columns,
      });

      expect(out?.text).toBe("Tech");
      expect(out?.html?.match(/<tr>/g)).toHaveLength(1);
      expect(out?.html).toContain("<tbody><tr><td>Tech</td></tr></tbody>");
    });

    it("uses the displayed blank-group label", () => {
      const blankGroup: PretableGroupRow = {
        ...techGroup,
        id: "__group__:sector=blank",
        value: "",
      };
      const out = serializeRanges<GroupCopyRow>({
        ranges: [
          range(blankGroup.id, blankGroup.id, GROUP_COLUMN_ID, GROUP_COLUMN_ID),
        ],
        visibleRows: [blankGroup],
        columns,
      });

      expect(out?.text).toBe("(Blanks)");
      expect(out?.html).toContain("<td>(Blanks)</td>");
    });

    it("escapes formatted aggregates in both clipboard flavors", () => {
      const escapingColumns: PretableColumn<GroupCopyRow>[] = [
        columns[0]!,
        columns[1]!,
        {
          ...columns[2]!,
          formatAggregate: () => 'sum\t<&"\n3',
        },
      ];
      const out = serializeRanges<GroupCopyRow>({
        ranges: [range(techGroup.id, techGroup.id, "qty", "qty")],
        visibleRows,
        columns: escapingColumns,
      });

      expect(out?.text).toBe('"sum\t<&""\n3"');
      expect(out?.html).toContain("<td>sum\t&lt;&amp;&quot;<br>3</td>");
    });

    it("omits the group label when the group column is outside the range", () => {
      const out = serializeRanges<GroupCopyRow>({
        ranges: [range(techGroup.id, beta.id, "name", "qty")],
        visibleRows,
        columns,
      });

      expect(out?.text).toBe("\tΣ 3\nAlpha\t1\nBeta\t2");
      expect(out?.html).toContain("<tbody><tr><td></td><td>Σ 3</td></tr>");
    });

    it("preserves the header blank line and thead contracts", () => {
      const out = serializeRanges<GroupCopyRow>({
        ranges: [range(techGroup.id, beta.id, GROUP_COLUMN_ID, "qty")],
        visibleRows,
        columns,
        copyWithHeaders: true,
      });

      expect(out?.text).toBe(
        "Group\tName\tQty\n\nTech\t\tΣ 3\n\tAlpha\t1\n\tBeta\t2",
      );
      expect(out?.html).toContain(
        "<thead><tr><th>Group</th><th>Name</th><th>Qty</th></tr></thead>",
      );
    });

    it("omits ranges with no body rows and returns null when all are empty", () => {
      const valid = range(techGroup.id, techGroup.id, "qty", "qty");
      const empty = range("missing", "missing", "qty", "qty");

      expect(
        serializeRanges<GroupCopyRow>({
          ranges: [empty, valid, empty],
          visibleRows,
          columns,
        })?.text,
      ).toBe("Σ 3");
      expect(
        serializeRanges<GroupCopyRow>({
          ranges: [empty],
          visibleRows,
          columns,
          copyWithHeaders: true,
        }),
      ).toBeNull();
    });
  });
});

describe("escapeHtmlText", () => {
  it("passes ordinary text through unchanged", () => {
    expect(escapeHtmlText("")).toBe("");
    expect(escapeHtmlText("plain")).toBe("plain");
    expect(escapeHtmlText("has spaces")).toBe("has spaces");
    expect(escapeHtmlText("a,b;c'd\te")).toBe("a,b;c'd\te");
  });

  it("escapes the four markup-significant characters", () => {
    expect(escapeHtmlText("&")).toBe("&amp;");
    expect(escapeHtmlText("<")).toBe("&lt;");
    expect(escapeHtmlText(">")).toBe("&gt;");
    expect(escapeHtmlText('"')).toBe("&quot;");
  });

  it("escapes a full tag", () => {
    expect(escapeHtmlText("<b>bold</b>")).toBe("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("escapes & first so following entities are not double-escaped", () => {
    // Regression guard: replacing < before & yields "&amp;lt;" here.
    expect(escapeHtmlText("&<")).toBe("&amp;&lt;");
    expect(escapeHtmlText("&amp;")).toBe("&amp;amp;");
  });

  it("converts each line-break form to exactly one <br>", () => {
    expect(escapeHtmlText("a\nb")).toBe("a<br>b");
    expect(escapeHtmlText("a\rb")).toBe("a<br>b");
    expect(escapeHtmlText("a\r\nb")).toBe("a<br>b");
  });

  it("does not escape the <br> it just emitted", () => {
    // Regression guard: converting newlines before escaping produces "&lt;br&gt;".
    expect(escapeHtmlText("<i>\n</i>")).toBe("&lt;i&gt;<br>&lt;/i&gt;");
  });
});

const META = '<meta charset="utf-8">';
const TABLE_OPEN = '<table style="white-space:pre-wrap">';

describe("serializeRanges HTML flavor", () => {
  it("wraps a single cell in a table with the whitespace rule", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.html).toBe(
      `${META}${TABLE_OPEN}<tbody><tr><td>a1</td></tr></tbody></table>`,
    );
  });

  it("emits one tr per row and one td per column", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r2", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.html).toBe(
      `${META}${TABLE_OPEN}<tbody>` +
        "<tr><td>a1</td><td>b1</td></tr>" +
        "<tr><td>a2</td><td>b2</td></tr>" +
        "</tbody></table>",
    );
  });

  it("omits thead when copyWithHeaders is false", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.html).not.toContain("<thead>");
  });

  it("emits thead when copyWithHeaders is true", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "b")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
      copyWithHeaders: true,
    });
    expect(out?.html).toBe(
      `${META}${TABLE_OPEN}` +
        "<thead><tr><th>A</th><th>B</th></tr></thead>" +
        "<tbody><tr><td>a1</td><td>b1</td></tr></tbody></table>",
    );
  });

  it("emits one table per range for a discontiguous selection", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a"), range("r3", "r3", "c", "c")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    // The separate tables are what resolve the \n\n block-separator ambiguity:
    // there is no separator token left to collide with cell content.
    expect(out?.html).toBe(
      `${META}` +
        `${TABLE_OPEN}<tbody><tr><td>a1</td></tr></tbody></table>` +
        `${TABLE_OPEN}<tbody><tr><td>c3</td></tr></tbody></table>`,
    );
    expect(out?.html?.match(/<table/g)).toHaveLength(2);
  });

  it("emits the meta charset exactly once", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a"), range("r3", "r3", "c", "c")],
      visibleRows: makeVisibleRows(rows),
      columns: baseColumns,
    });
    expect(out?.html?.match(/<meta/g)).toHaveLength(1);
  });

  it("escapes markup in cell values", () => {
    const row: Row = { id: "r1", a: "<b>x</b> & y", b: "b1", c: "c1" };
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows([row]),
      columns: baseColumns,
    });
    expect(out?.html).toContain("<td>&lt;b&gt;x&lt;/b&gt; &amp; y</td>");
  });

  it("escapes markup in header values", () => {
    const cols: PretableColumn<Row>[] = [{ id: "a", header: "<A>" }];
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
      copyWithHeaders: true,
    });
    expect(out?.html).toContain("<th>&lt;A&gt;</th>");
  });

  it("renders a multi-line cell as <br>, not a quoted newline", () => {
    const row: Row = { id: "r1", a: "line one\nline two", b: "b1", c: "c1" };
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows([row]),
      columns: baseColumns,
    });
    expect(out?.html).toContain("<td>line one<br>line two</td>");
    // The TSV flavor still quotes it — the two encodings are independent.
    expect(out?.text).toBe('"line one\nline two"');
  });

  it("passes a literal TAB through untouched — it is only a TSV delimiter", () => {
    const row: Row = { id: "r1", a: "left\tright", b: "b1", c: "c1" };
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows([row]),
      columns: baseColumns,
    });
    // No escaping, no entity: the table structure carries the cell boundary,
    // so a TAB is ordinary content. white-space:pre-wrap keeps it from
    // collapsing on paste.
    expect(out?.html).toContain("<td>left\tright</td>");
    // The TSV flavor has to quote it — there the TAB *is* the delimiter.
    expect(out?.text).toBe('"left\tright"');
  });

  it("treats format output as text, not markup", () => {
    const cols: PretableColumn<Row>[] = [
      { id: "a", header: "A", format: () => "<b>bold</b>" },
    ];
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
    });
    expect(out?.html).toContain("<td>&lt;b&gt;bold&lt;/b&gt;</td>");
  });

  it("excludes the synthetic row-select column, as the TSV does", () => {
    const cols: PretableColumn<Row>[] = [
      { id: ROW_SELECT_COLUMN_ID, header: "" },
      ...baseColumns,
    ];
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", ROW_SELECT_COLUMN_ID, "c")],
      visibleRows: makeVisibleRows(rows),
      columns: cols,
      copyWithHeaders: true,
    });
    expect(out?.html).toBe(
      `${META}${TABLE_OPEN}` +
        "<thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>" +
        "<tbody><tr><td>a1</td><td>b1</td><td>c1</td></tr></tbody></table>",
    );
  });
});

describe("serializeRanges HTML type hints", () => {
  // Excel's force-as-text format code. The backslash is part of Excel's
  // syntax (\@ is the escaped text-format code), so the JS literal doubles it.
  const TEXT_HINT = " style=\"mso-number-format:'\\@'\"";

  function oneTypedCell(
    value: string,
    type: PretableColumn<Row>["type"],
  ): string {
    const row: Row = { id: "r1", a: value, b: "b1", c: "c1" };
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows([row]),
      columns: [{ id: "a", header: "A", type }],
    });
    return out?.html ?? "";
  }

  it("hints a text column so Excel does not date-coerce 1-2", () => {
    expect(oneTypedCell("1-2", "text")).toContain(`<td${TEXT_HINT}>1-2</td>`);
  });

  it("hints an enum column — its labels are text too", () => {
    expect(oneTypedCell("1-2", "enum")).toContain(`<td${TEXT_HINT}>1-2</td>`);
  });

  it("leaves an untyped column bare rather than guessing", () => {
    expect(oneTypedCell("1-2", undefined)).toContain("<td>1-2</td>");
  });

  it("leaves number, date, and boolean columns bare", () => {
    expect(oneTypedCell("42", "number")).toContain("<td>42</td>");
    expect(oneTypedCell("2026-01-02", "date")).toContain("<td>2026-01-02</td>");
    expect(oneTypedCell("true", "boolean")).toContain("<td>true</td>");
  });

  it("never hints a header cell — headers are labels, not data", () => {
    const out = serializeRanges<Row>({
      ranges: [range("r1", "r1", "a", "a")],
      visibleRows: makeVisibleRows(rows),
      columns: [{ id: "a", header: "A", type: "text" }],
      copyWithHeaders: true,
    });
    expect(out?.html).toContain("<th>A</th>");
    expect(out?.html).not.toContain(`<th${TEXT_HINT}>`);
  });

  it("keeps the table-level whitespace rule alongside the cell hint", () => {
    const html = oneTypedCell("a  b", "text");
    expect(html).toContain('<table style="white-space:pre-wrap">');
    expect(html).toContain(`<td${TEXT_HINT}>a  b</td>`);
  });
});

/**
 * The engine encodes a full-row range as `getColumns()` first-id → last-id, so
 * a grouping change that rewrites those bounds is what the clipboard sees. When
 * `endColumnId` no longer resolves, `resolveRangeBounds` degrades the range to
 * a single column — Cmd+C after grouping would copy one cell of the row.
 */
describe("copy of an engine selection across a grouping change", () => {
  type Expense = { id: string; dept: string; name: string; amount: number };

  function makeGrid() {
    return createGrid<Expense>({
      columns: [
        { id: "dept", header: "Dept" },
        { id: "name", header: "Name" },
        { id: "amount", header: "Amount" },
      ],
      rows: [
        { id: "e1", dept: "Eng", name: "Ada", amount: 10 },
        { id: "e2", dept: "Ops", name: "Bob", amount: 20 },
      ],
      getRowId: (row) => row.id,
    });
  }

  function copySelection(grid: ReturnType<typeof makeGrid>) {
    const snapshot = grid.getSnapshot();
    return serializeRanges<Expense>({
      ranges: snapshot.selection.ranges,
      visibleRows: snapshot.visibleRows,
      columns: [...grid.getColumns()],
    });
  }

  it("copies every drawn column of a row selected before grouping", () => {
    const grid = makeGrid();
    grid.toggleRowSelection("e1");
    expect(copySelection(grid)?.text).toBe("Eng\tAda\t10");

    grid.setRowGroups(["amount"]);

    expect(grid.getColumns().map((column) => column.id)).toEqual([
      GROUP_COLUMN_ID,
      "dept",
      "name",
    ]);
    expect(copySelection(grid)?.text).toBe("\tEng\tAda");
  });

  it("copies every drawn column of a grouped select-all after ungrouping", () => {
    const grid = makeGrid();
    grid.setRowGroups(["amount"]);
    grid.selectAll();

    grid.setRowGroups([]);

    expect(copySelection(grid)?.text).toBe("Eng\tAda\t10\nOps\tBob\t20");
  });
});

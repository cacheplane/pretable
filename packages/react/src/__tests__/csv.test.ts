import { describe, expect, it } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  GROUP_COLUMN_ID,
  type PretableRowModelSnapshot,
} from "@pretable/core";

import { escapeCsvField, serializeCsv, type SerializeCsvArgs } from "../csv";
import { ROW_SELECT_COLUMN_ID } from "../constants";
import type { PretableColumn } from "../types";

type Row = { id: string; a: string; b: string; n: number };

const modelColumn = createColumnHelper<Row>();
const modelColumns = [
  modelColumn.accessor("a", { type: "text" }),
  modelColumn.accessor("b", { type: "text" }),
  modelColumn.accessor("n", { type: "number" }),
] as const;

function snapshot(
  sourceRows: readonly Row[],
): PretableRowModelSnapshot<Row, string, typeof modelColumns> {
  return createLocalRowModel({
    rows: sourceRows,
    columns: modelColumns,
  }).getState().snapshot;
}

const columns: PretableColumn<Row>[] = [
  { id: "a", header: "A", type: "text" },
  { id: "b", header: "B", type: "text" },
  { id: "n", header: "N", type: "number" },
];

const rows: Row[] = [
  { id: "r1", a: "a1", b: "b1", n: 1 },
  { id: "r2", a: "a2", b: "b2", n: 2 },
];

/** Serialize with the BOM off, so assertions read as the file's actual text. */
function csv(
  args: Partial<SerializeCsvArgs<Row, string, typeof modelColumns>> & {
    rows?: readonly Row[];
  } = {},
): string {
  const { rows: sourceRows = rows, ...rest } = args;
  const file = serializeCsv({
    rowModelSnapshot: snapshot(sourceRows),
    columns,
    scope: "all",
    ...rest,
    options: { bom: false, ...rest.options },
  });
  if (!file) throw new Error("expected a file");
  return file.text;
}

describe("escapeCsvField", () => {
  it("leaves an ordinary field bare", () => {
    expect(escapeCsvField("plain", ",")).toBe("plain");
  });

  it("quotes on the delimiter, a quote, CR, or LF", () => {
    expect(escapeCsvField("a,b", ",")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"', ",")).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2", ",")).toBe('"line1\nline2"');
    expect(escapeCsvField("line1\r\nline2", ",")).toBe('"line1\r\nline2"');
  });

  it("quotes against the CONFIGURED delimiter, not a hard-coded comma", () => {
    // A semicolon file is what Excel writes in much of Europe. Quoting only on
    // `,` would emit a field that silently splits into two columns.
    expect(escapeCsvField("a;b", ";")).toBe('"a;b"');
    expect(escapeCsvField("a,b", ";")).toBe("a,b");
  });

  it("does not quote an empty field", () => {
    // Load-bearing: a bare empty field vs a quoted `""` is the only in-band
    // convention CSV has for NULL vs empty string (Postgres COPY). Quoting
    // everything would destroy it.
    expect(escapeCsvField("", ",")).toBe("");
  });
});

describe("serializeCsv", () => {
  it("writes a header row and CRLF line endings", () => {
    expect(csv()).toBe("A,B,N\r\na1,b1,1\r\na2,b2,2");
  });

  it("omits the header when asked", () => {
    expect(csv({ options: { includeHeaders: false } })).toBe(
      "a1,b1,1\r\na2,b2,2",
    );
  });

  it("prepends a UTF-8 BOM by default", () => {
    const file = serializeCsv({
      rowModelSnapshot: snapshot(rows),
      columns,
      scope: "all",
    });
    // Excel does not detect UTF-8 without it — Microsoft's Power Query docs
    // say the character set "isn't inferred" absent a BOM.
    expect(file?.text.charCodeAt(0)).toBe(0xfeff);
  });

  it("honours a custom delimiter", () => {
    expect(csv({ options: { delimiter: ";" } })).toBe(
      "A;B;N\r\na1;b1;1\r\na2;b2;2",
    );
  });

  it("returns null when there are no data columns", () => {
    expect(
      serializeCsv({
        rowModelSnapshot: snapshot(rows),
        columns: [],
        scope: "all",
      }),
    ).toBeNull();
  });

  it("drops the row-select column", () => {
    const text = csv({
      columns: [{ id: ROW_SELECT_COLUMN_ID, header: "" }, ...columns],
    });
    expect(text.split("\r\n")[0]).toBe("A,B,N");
  });

  it("follows the DRAWN column order, not the declaration order", () => {
    // The invariant seven consumers in this repo have got wrong, and that MUI's
    // export has wrong today (its selector ignores pinning, so a right-pinned
    // column exports in its unpinned position).
    const reordered = [columns[2]!, columns[0]!, columns[1]!];
    expect(csv({ columns: reordered })).toBe("N,A,B\r\n1,a1,b1\r\n2,a2,b2");
  });

  it("treats columnIds as a subset AND an order", () => {
    expect(csv({ options: { columnIds: ["n", "a"] } })).toBe(
      "N,A\r\n1,a1\r\n2,a2",
    );
  });

  it("quotes a value containing the delimiter", () => {
    expect(csv({ rows: [{ id: "r1", a: "x,y", b: "b", n: 1 }] })).toBe(
      'A,B,N\r\n"x,y",b,1',
    );
  });
});

describe("serializeCsv formula escaping", () => {
  const dangerous = "=1+1";

  it("escapes a formula in a text column", () => {
    expect(csv({ rows: [{ id: "r1", a: dangerous, b: "b", n: 1 }] })).toBe(
      "A,B,N\r\n'=1+1,b,1",
    );
  });

  it("does NOT escape a negative number in a number column", () => {
    // The whole point of the type gate. Atlassian shipped the leading-character
    // version and exported `-1000` as `'-1000` across Jira 9.9.0-9.12.2
    // (JRASERVER-77480); MUI X carries the identical gap today; CsvHelper's
    // Strip mode turns -10 into 10 (#2126, open). A number column is never a
    // candidate here, so the bug is structurally absent rather than avoided.
    const text = csv({ rows: [{ id: "r1", a: "a", b: "b", n: -1000 }] });
    expect(text).toBe("A,B,N\r\na,b,-1000");
    expect(text).not.toContain("'-1000");
  });

  it("escapes a formula string in an UNTYPED column", () => {
    // A string is not provably-not-a-formula, whatever the column claims or
    // omits. The previous rule exempted untyped columns and shipped this
    // unescaped.
    const untyped: PretableColumn<Row>[] = [{ id: "a", header: "A" }];
    expect(
      csv({
        columns: untyped,
        rows: [{ id: "r1", a: dangerous, b: "", n: 0 }],
      }),
    ).toBe("A\r\n'=1+1");
  });

  it("never escapes a header, even one that starts with a trigger character", () => {
    // A column legitimately named "+/- change" is the grid's own text, not a
    // value any user controls.
    const named: PretableColumn<Row>[] = [
      { id: "a", header: "+/- change", type: "text" },
    ];
    // Bare, not `'+/- change`: unescaped, and unquoted too, since minimal
    // quoting only triggers on the delimiter, a quote, CR or LF.
    expect(csv({ columns: named }).split("\r\n")[0]).toBe("+/- change");
  });

  it("escapes a leading TAB and a leading CR, not just the visible triggers", () => {
    // Both are on OWASP's list because Excel skips leading whitespace when
    // deciding whether a cell is a formula, so `\t=1+1` still evaluates. They
    // are also the two entries the trigger set's comment specifically
    // justifies, and were the last unpinned part of it.
    expect(csv({ rows: [{ id: "r1", a: "\t=1+1", b: "b", n: 1 }] })).toContain(
      "'\t=1+1",
    );
    expect(csv({ rows: [{ id: "r1", a: "\r=1+1", b: "b", n: 1 }] })).toContain(
      '"\'\r=1+1"',
    );
  });

  it("can be turned off entirely", () => {
    expect(
      csv({
        rows: [{ id: "r1", a: dangerous, b: "b", n: 1 }],
        options: { escapeFormulas: false },
      }),
    ).toBe("A,B,N\r\n=1+1,b,1");
  });

  it("accepts a replacement predicate", () => {
    expect(
      csv({
        rows: [{ id: "r1", a: "safe", b: "b", n: 1 }],
        options: { escapeFormulas: (value) => value === "safe" },
      }),
    ).toBe("A,B,N\r\n'safe,b,1");
  });

  it("quotes an escaped value that also contains the delimiter", () => {
    expect(csv({ rows: [{ id: "r1", a: "=1,2", b: "b", n: 1 }] })).toBe(
      `A,B,N\r\n"'=1,2",b,1`,
    );
  });
});

describe("serializeCsv honesty reporting", () => {
  it("reports complete when the grid can prove it holds everything", () => {
    const file = serializeCsv({
      rowModelSnapshot: snapshot(rows),
      columns,
      scope: "all",
    });
    expect(file).toMatchObject({ rowCount: 2, scope: "all", complete: true });
  });

  it("reports INCOMPLETE when the grid only has a loaded window", () => {
    // No mainstream grid tells the person who clicked the button. AG Grid drops
    // stub rows with no counter or log; MUI's lazy path emits blank rows so the
    // count looks right while the data is gone.
    const file = serializeCsv({
      rowModelSnapshot: snapshot(rows),
      columns,
      scope: "loaded",
    });
    expect(file).toMatchObject({ scope: "loaded", complete: false });
  });

  it("does not put the incompleteness marker in the file", () => {
    // RFC 4180 has no comment syntax, so a marker row is a DATA row: pandas
    // would read it as a record with one populated column and NaN elsewhere.
    // Trading silent incompleteness for silent corruption is not an
    // improvement — the signal rides on the flag and the filename instead.
    const file = serializeCsv({
      rowModelSnapshot: snapshot(rows),
      columns,
      scope: "loaded",
      options: { bom: false },
    });
    expect(file?.text).toBe("A,B,N\r\na1,b1,1\r\na2,b2,2");
    expect(file?.rowCount).toBe(2);
  });
});

describe("serializeCsv escaping holes found in review", () => {
  it("escapes a group label, which carries user data and has no column type", async () => {
    // The derived group column is synthesized with no `type`, so a type gate
    // waves it through — and grouping HIDES the source column by default, so
    // the group label is the ONLY place that value appears in the file. There
    // is no escaped copy to fall back on.
    const grouped = createLocalRowModel({
      rows: [{ id: "r1", a: "=cmd|'/c calc'!A1", b: "b", n: 1 }],
      columns: modelColumns,
    });
    // `setQuery` settles asynchronously through the cooperative scheduler —
    // reading the snapshot straight after it returns gives the PRE-grouping
    // rows, which is how this test first "passed" against an ungrouped file.
    await grouped.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "a" }],
    }).finished;

    const file = serializeCsv({
      rowModelSnapshot: grouped.getState().snapshot,
      columns: [
        { id: GROUP_COLUMN_ID, header: "Group" },
        { id: "n", header: "N", type: "number" },
      ],
      scope: "all",
      options: { bom: false },
    });

    expect(file?.text).toContain("'=cmd");
    expect(file?.text).not.toMatch(/(^|[,\n])=cmd/);
  });

  it("escapes when a column callback produced the value, whatever the type says", () => {
    // `column.type` describes what a column HOLDS; `format` decides what it
    // WRITES. Reading the declared type while escaping the callback's output
    // compares two different things.
    const withFormat: PretableColumn<Row>[] = [
      { id: "n", header: "N", type: "number", format: () => "=1+1" },
    ];
    expect(csv({ columns: withFormat })).toBe("N\r\n'=1+1\r\n'=1+1");
  });

  it("still does not escape a plain number column with no callback", () => {
    // The anti-Jira property must survive the fix above: the fast path is only
    // given up when the library can no longer vouch for the value's shape.
    expect(csv({ rows: [{ id: "r1", a: "a", b: "b", n: -1000 }] })).toBe(
      "A,B,N\r\na,b,-1000",
    );
  });

  it("falls back to the column id when the header is an empty string", () => {
    // `??` treats "" as present; `||` does not. An empty header collides in
    // pandas and hard-errors in Excel and Postgres — the one choice that fails
    // in all three.
    const blank: PretableColumn<Row>[] = [{ id: "a", header: "" }];
    expect(csv({ columns: blank }).split("\r\n")[0]).toBe("a");
  });
});

describe("serializeCsv input validation", () => {
  it("rejects a delimiter that would produce an unparseable file", () => {
    // "" makes text.includes("") always true, so every field is quoted and then
    // concatenated into a single column — structure silently destroyed.
    for (const delimiter of ["", ",,", '"', "\r\n"]) {
      expect(() => csv({ options: { delimiter } })).toThrow(/Invalid CSV/);
    }
  });

  it("rejects columnIds naming a column that is not drawn", () => {
    // Dropping a requested column silently is this module's own thesis
    // inverted: the caller asked for a shape and got a narrower one in silence.
    expect(() => csv({ options: { columnIds: ["a", "nope"] } })).toThrow(
      /not a drawn column/,
    );
  });
});

describe("escapeCsvField, lone CR", () => {
  it("quotes a bare carriage return", () => {
    // The only previous CR test used \r\n, which the \n clause already caught,
    // so dropping the \r check survived. A lone CR reads as a record break in
    // Excel and strict parsers: a silently split row.
    expect(escapeCsvField("a\rb", ",")).toBe('"a\rb"');
  });
});

describe("serializeCsv group and aggregate rows", () => {
  async function groupedSnapshot() {
    const model = createLocalRowModel({ rows, columns: modelColumns });
    await model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "a" }],
    }).finished;
    return model.getState().snapshot;
  }

  const groupedColumns: PretableColumn<Row>[] = [
    { id: GROUP_COLUMN_ID, header: "Group" },
    { id: "n", header: "N", type: "number" },
  ];

  it("emits group rows by default", async () => {
    const file = serializeCsv({
      rowModelSnapshot: await groupedSnapshot(),
      columns: groupedColumns,
      scope: "all",
      options: { bom: false },
    });
    expect(file?.text).toContain("a1");
    expect(file!.rowCount).toBeGreaterThan(rows.length);
  });

  it("does not export the derived group column, and puts the label in the first", async () => {
    // The surface hands over the DRAWN columns, group column included. A file
    // one column wider than the grid is a file no spreadsheet can read back —
    // and it is the same off-by-one that loses column A on the way in.
    const file = serializeCsv({
      rowModelSnapshot: await groupedSnapshot(),
      columns: [
        { id: GROUP_COLUMN_ID, header: "Group" },
        { id: "b", header: "B", type: "text" },
        { id: "n", header: "N", type: "number" },
      ],
      scope: "all",
      options: { bom: false },
    });
    const lines = file!.text.split("\r\n");
    expect(lines[0]).toBe("B,N");
    expect(lines).toEqual(["B,N", "a1,", "b1,1", "a2,", "b2,2"]);
    // Rectangular: two fields on every line, group headers included.
    for (const line of lines) expect(line.split(",")).toHaveLength(2);
  });

  it("omits group rows when includeGroupRows is false", async () => {
    const file = serializeCsv({
      rowModelSnapshot: await groupedSnapshot(),
      columns: groupedColumns,
      scope: "all",
      options: { bom: false, includeGroupRows: false },
    });
    expect(file!.rowCount).toBe(rows.length);
  });
});

describe("serializeCsv, nothing to write", () => {
  it("returns null when there is no header and no row", () => {
    // A BOM-only three-byte file is not a CSV, and the doc comment promises
    // null. Previously this returned `{ text: "﻿", rowCount: 0 }`.
    expect(
      serializeCsv({
        rowModelSnapshot: snapshot([]),
        columns,
        scope: "all",
        options: { includeHeaders: false },
      }),
    ).toBeNull();
  });

  it("still returns a header-only file for an empty result set", () => {
    // An empty filtered result IS a valid CSV — the columns are the answer.
    const file = serializeCsv({
      rowModelSnapshot: snapshot([]),
      columns,
      scope: "all",
      options: { bom: false },
    });
    expect(file?.text).toBe("A,B,N");
    expect(file?.rowCount).toBe(0);
  });
});

describe("serializeCsv vouches on the value, not the declaration", () => {
  type Loose = { id: string; v: unknown };
  const lh = createColumnHelper<Loose>();
  const looseModel = [lh.accessor("v", { type: "number" })] as const;

  function looseCsv(
    value: unknown,
    type: "number" | "date" | "boolean" | undefined,
  ): string {
    const snap = createLocalRowModel({
      rows: [{ id: "r1", v: value }],
      columns: looseModel,
    }).getState().snapshot;
    const file = serializeCsv({
      rowModelSnapshot: snap,
      columns: [{ id: "v", header: "V", ...(type ? { type } : {}) }],
      scope: "all",
      options: { bom: false },
    });
    return file!.text;
  }

  // `PretableRow` is Record<string, unknown>: nothing stops a string from an
  // API landing in a column that calls itself numeric. The previous rule
  // trusted the declaration and shipped `=HYPERLINK(...)` RFC-quoted only —
  // which does nothing, since quoting never stopped a spreadsheet evaluating a
  // cell.
  for (const type of ["number", "date", "boolean", undefined] as const) {
    it(`escapes a formula string in a declared-${type ?? "untyped"} column`, () => {
      expect(looseCsv("=cmd|'/c calc'!A1", type)).toContain("'=cmd");
    });
  }

  it("still never escapes a genuine negative number", () => {
    // The anti-Jira property, now resting on the runtime type rather than on a
    // declaration: a real number cannot begin a formula.
    expect(looseCsv(-1000, "number")).toBe("V\r\n-1000");
    expect(looseCsv(-1000, undefined)).toBe("V\r\n-1000");
  });

  it("does not escape a genuine Date or boolean", () => {
    expect(looseCsv(false, "boolean")).toBe("V\r\nfalse");
    expect(looseCsv(new Date(Date.UTC(2026, 0, 1)), "date")).toContain(
      "2026-01-01",
    );
  });
});

describe("serializeCsv reports rows hidden by collapsed groups", () => {
  async function groupedModel() {
    const model = createLocalRowModel({ rows, columns: modelColumns });
    await model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "a" }],
    }).finished;
    return model;
  }

  async function grouped(collapse: boolean) {
    const model = await groupedModel();
    if (collapse) model.collapseAll();
    return serializeCsv({
      rowModelSnapshot: model.getState().snapshot,
      columns: [
        { id: GROUP_COLUMN_ID, header: "Group" },
        { id: "n", header: "N", type: "number" },
      ],
      scope: "all",
      options: { bom: false },
    });
  }

  it("is complete when every group is expanded", async () => {
    expect((await grouped(false))?.complete).toBe(true);
  });

  it("is INCOMPLETE when a collapsed group hides its rows", async () => {
    // range() walks visible rows, so collapsed children are unreachable. The
    // file previously lost them and still claimed complete: true — the exact
    // failure this module faults AG Grid and MUI for.
    const file = await grouped(true);
    expect(file?.complete).toBe(false);
    expect(file!.rowCount).toBeLessThan((await grouped(false))!.rowCount);
  });

  // The two clauses of `hidesCollapsedRows` are checked separately, because a
  // suite that only ever exercises expand-all vs collapse-all cannot tell
  // `default.kind !== "expanded"` from `overrideCount > 0` — either clause
  // alone would carry both cases above.
  async function withExpansion(
    mutate: (model: Awaited<ReturnType<typeof groupedModel>>) => void,
  ) {
    const model = await groupedModel();
    mutate(model);
    return serializeCsv({
      rowModelSnapshot: model.getState().snapshot,
      columns: [
        { id: GROUP_COLUMN_ID, header: "Group" },
        { id: "n", header: "N", type: "number" },
      ],
      scope: "all",
      options: { bom: false },
    });
  }

  it("is INCOMPLETE for a non-'expanded' default even with no overrides", async () => {
    const file = await withExpansion((model) => {
      model.setExpansionDefault({ kind: "through-depth", depth: 0 });
    });
    expect(file?.complete).toBe(false);
    expect(file?.omissions.map((o) => o.kind)).toEqual(["collapsed-groups"]);
  });

  it("is INCOMPLETE for an expanded default carrying an override", async () => {
    const file = await withExpansion((model) => {
      const snapshot = model.getState().snapshot;
      const group = snapshot.rowAt(0);
      if (group?.kind !== "group") throw new Error("expected a group row");
      model.setGroupExpanded(group.groupId, false);
    });
    expect(file?.complete).toBe(false);
    expect(file?.omissions).toEqual([
      { kind: "collapsed-groups", expansionOverrideCount: 1 },
    ]);
  });
});

describe("serializeCsv pins each formula trigger individually", () => {
  // Previously only `=`, TAB and CR were covered, so deleting `+`, `-` or `@`
  // from the trigger set survived the suite. Deleting `-` is exactly the change
  // a future contributor would make after reading the Jira negative-number
  // story, and nothing would have caught it.
  for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
    it(`escapes a text value beginning with ${JSON.stringify(lead)}`, () => {
      const text = csv({
        rows: [{ id: "r1", a: `${lead}danger`, b: "b", n: 1 }],
      });
      expect(text).toContain(`'${lead}danger`);
    });
  }
});

describe("serializeCsv rejects each bad delimiter individually", () => {
  // The previous loop used "\r\n", which the length check already rejects, so
  // removing the CR or LF clause survived. A single "\r" is the untested case.
  for (const delimiter of ["", ",,", '"', "\r", "\n"]) {
    it(`rejects ${JSON.stringify(delimiter)}`, () => {
      expect(() => csv({ options: { delimiter } })).toThrow(/Invalid CSV/);
    });
  }
});

describe("serializeCsv aggregate rows", () => {
  const aggColumn = createColumnHelper<Row>();
  const aggModel = [
    aggColumn.accessor("a", { type: "text" }),
    aggColumn.accessor("n", { type: "number", aggregate: "sum" }),
  ] as const;

  async function aggregated(include: boolean) {
    const model = createLocalRowModel({ rows, columns: aggModel });
    await model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "a" }],
    }).finished;
    return serializeCsv({
      rowModelSnapshot: model.getState().snapshot,
      // A real column ahead of the aggregate one: the group label takes the
      // FIRST exported column, so an aggregate sitting there would be
      // overwritten by it and this test could not see the option at all.
      columns: [
        { id: GROUP_COLUMN_ID, header: "Group" },
        { id: "a", header: "A", type: "text" },
        { id: "n", header: "N", type: "number" },
      ],
      scope: "all",
      options: { bom: false, includeAggregateRows: include },
    });
  }

  it("writes aggregate values into group rows", async () => {
    const withAgg = await aggregated(true);
    const without = await aggregated(false);
    // Ignoring includeAggregateRows entirely previously survived the suite.
    expect(withAgg?.text).not.toBe(without?.text);
  });
});

describe("serializeCsv omissions carry their evidence", () => {
  it("is complete with an empty omissions list", () => {
    const file = serializeCsv({
      rowModelSnapshot: snapshot(rows),
      columns,
      scope: "all",
    });
    expect(file?.omissions).toEqual([]);
    expect(file?.complete).toBe(true);
  });

  it("names unloaded rows, with the scope that proved it", () => {
    const file = serializeCsv({
      rowModelSnapshot: snapshot(rows),
      columns,
      scope: "loaded",
    });
    expect(file?.omissions).toEqual([
      { kind: "unloaded-rows", scope: "loaded" },
    ]);
    // Derived, never assigned separately — it cannot drift from the reasons.
    expect(file?.complete).toBe(false);
  });

  it("names collapsed groups, with the override count", async () => {
    const model = createLocalRowModel({ rows, columns: modelColumns });
    await model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "a" }],
    }).finished;
    model.collapseAll();

    const file = serializeCsv({
      rowModelSnapshot: model.getState().snapshot,
      columns: [
        { id: GROUP_COLUMN_ID, header: "Group" },
        { id: "n", header: "N", type: "number" },
      ],
      scope: "all",
    });

    expect(file?.omissions).toHaveLength(1);
    expect(file?.omissions[0]?.kind).toBe("collapsed-groups");
  });

  it("reports BOTH reasons when both apply", async () => {
    // The old boolean could only say "not complete". A caller can now tell a
    // server-side window apart from a collapsed group, and say which.
    const model = createLocalRowModel({ rows, columns: modelColumns });
    await model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "a" }],
    }).finished;
    model.collapseAll();

    const file = serializeCsv({
      rowModelSnapshot: model.getState().snapshot,
      columns: [
        { id: GROUP_COLUMN_ID, header: "Group" },
        { id: "n", header: "N", type: "number" },
      ],
      scope: "loaded",
    });

    expect(file?.omissions.map((o) => o.kind).sort()).toEqual([
      "collapsed-groups",
      "unloaded-rows",
    ]);
  });
});

describe("serializeCsv rowIds — how selection-only export is expressed", () => {
  it("restricts the export to the given rows", () => {
    expect(csv({ options: { rowIds: new Set(["r2"]) } })).toBe(
      "A,B,N\r\na2,b2,2",
    );
  });

  it("exports everything when rowIds is omitted", () => {
    expect(csv()).toBe("A,B,N\r\na1,b1,1\r\na2,b2,2");
  });

  it("still reports unloaded rows when the grid held only a window", () => {
    // AG Grid's export-selected silently degrades to the loaded rows. Here the
    // honesty falls out of `scope` — no separate rule for selection.
    const file = serializeCsv({
      rowModelSnapshot: snapshot(rows),
      columns,
      scope: "loaded",
      options: { rowIds: new Set(["r1"]) },
    });
    expect(file?.rowCount).toBe(1);
    expect(file?.omissions.map((o) => o.kind)).toEqual(["unloaded-rows"]);
  });

  it("keeps group rows as context for the rows that remain", async () => {
    const model = createLocalRowModel({ rows, columns: modelColumns });
    await model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "a" }],
    }).finished;

    const file = serializeCsv({
      rowModelSnapshot: model.getState().snapshot,
      columns: [
        { id: GROUP_COLUMN_ID, header: "Group" },
        { id: "b", header: "B", type: "text" },
        { id: "n", header: "N", type: "number" },
      ],
      scope: "all",
      options: { bom: false, rowIds: new Set(["r1"]) },
    });

    const lines = file!.text.split("\r\n");
    // The selected row survives under its group header, whose label takes the
    // first exported column — the derived group column is not exported.
    expect(lines).toContain("a1,");
    expect(lines).toContain("b1,1");
    // Its sibling's DATA row is gone.
    expect(lines).not.toContain("b2,2");
    // KNOWN BEHAVIOUR, asserted rather than assumed: the sibling's GROUP header
    // survives with nothing under it. Suppressing it needs lookahead — a group
    // row is written before its children are known — and AG Grid keeps group
    // rows too. Recorded here so a change is deliberate, not accidental.
    expect(lines).toContain("a2,");
  });
});

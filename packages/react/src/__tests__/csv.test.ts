import { describe, expect, it } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
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
    const file = serializeCsv({ rowModelSnapshot: snapshot(rows), columns });
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
      serializeCsv({ rowModelSnapshot: snapshot(rows), columns: [] }),
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

  it("does not escape an untyped column", () => {
    // Mirrors copy.ts's cellStyleAttr: `column.type` is the documented lever,
    // and guessing past it is what corrupts data.
    const untyped: PretableColumn<Row>[] = [{ id: "a", header: "A" }];
    expect(
      csv({
        columns: untyped,
        rows: [{ id: "r1", a: dangerous, b: "", n: 0 }],
      }),
    ).toBe("A\r\n=1+1");
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

import { describe, expect, it } from "vitest";

import { escapeTsvField } from "../copy";
import { parseTsv } from "../paste";

describe("parseTsv", () => {
  it("parses a plain tab/newline grid", () => {
    expect(parseTsv("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles CRLF row separators", () => {
    expect(parseTsv("a\tb\r\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles bare CR row separators", () => {
    expect(parseTsv("a\tb\rc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("mixes CRLF, CR and LF in one payload", () => {
    expect(parseTsv("a\r\nb\rc\nd")).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("keeps a TAB inside a quoted field", () => {
    expect(parseTsv('"a\tb"\tc')).toEqual([["a\tb", "c"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseTsv('"line1\nline2"\tc')).toEqual([["line1\nline2", "c"]]);
  });

  it("keeps a CRLF inside a quoted field verbatim", () => {
    expect(parseTsv('"line1\r\nline2"\tc')).toEqual([["line1\r\nline2", "c"]]);
  });

  it('unescapes doubled quotes ("" -> ")', () => {
    expect(parseTsv('"say ""hi"""')).toEqual([['say "hi"']]);
  });

  it("parses a field that is only a quoted quote", () => {
    expect(parseTsv('""""')).toEqual([['"']]);
  });

  it("parses an empty quoted field", () => {
    expect(parseTsv('""\tx')).toEqual([["", "x"]]);
  });

  it("treats a quote that is not at field start as a literal character", () => {
    expect(parseTsv('a"b\tc')).toEqual([['a"b', "c"]]);
    expect(parseTsv('a""b')).toEqual([['a""b']]);
  });

  it("trims exactly one trailing blank line", () => {
    expect(parseTsv("a\tb\n")).toEqual([["a", "b"]]);
    expect(parseTsv("a\tb\r\n")).toEqual([["a", "b"]]);
  });

  it("preserves a second trailing blank line as an empty row", () => {
    expect(parseTsv("a\tb\n\n")).toEqual([["a", "b"], [""]]);
  });

  it("preserves interior blank lines", () => {
    expect(parseTsv("a\n\nb")).toEqual([["a"], [""], ["b"]]);
  });

  it("preserves ragged rows", () => {
    expect(parseTsv("a\tb\tc\nd\ne\tf")).toEqual([
      ["a", "b", "c"],
      ["d"],
      ["e", "f"],
    ]);
  });

  it("preserves empty leading/trailing fields", () => {
    expect(parseTsv("\ta\t")).toEqual([["", "a", ""]]);
  });

  it("returns an empty matrix for empty input", () => {
    expect(parseTsv("")).toEqual([]);
  });

  it("reads a lone newline as one empty row", () => {
    expect(parseTsv("\n")).toEqual([[""]]);
  });

  it("tolerates an unterminated quoted field", () => {
    expect(parseTsv('"abc')).toEqual([["abc"]]);
  });

  it("keeps unicode intact", () => {
    expect(parseTsv("héllo\t🎿\tこんにちは")).toEqual([
      ["héllo", "🎿", "こんにちは"],
    ]);
  });
});

// The acceptance bar: parseTsv is the exact inverse of escapeTsvField.
const TRICKY_FIELDS = [
  "",
  "plain",
  " leading and trailing ",
  "0",
  "with\ttab",
  "with\nnewline",
  "with\r\ncrlf",
  "with\rcr",
  'with"quote',
  '"leading quote',
  'trailing quote"',
  '"fully quoted"',
  'say ""hi""',
  '"',
  '""',
  'tab\tand\nnewline\tand"quote',
  "héllo wörld",
  "🎿🏔️",
  "こんにちは",
  "a".repeat(200),
  "line1\nline2\nline3",
  "\t",
  "\n",
  "\r\n",
];

function encodeMatrix(matrix: string[][]): string {
  return matrix.map((row) => row.map(escapeTsvField).join("\t")).join("\n");
}

describe("parseTsv round-trips escapeTsvField", () => {
  it("round-trips every tricky field as a single-row pair", () => {
    for (const field of TRICKY_FIELDS) {
      const row = [field, "sentinel"];
      expect(parseTsv(encodeMatrix([row]))).toEqual([row]);
    }
  });

  it("round-trips every tricky field in the last column", () => {
    for (const field of TRICKY_FIELDS) {
      const row = ["sentinel", field];
      expect(parseTsv(encodeMatrix([row]))).toEqual([row]);
    }
  });

  it("round-trips every ordered pair of tricky fields", () => {
    for (const a of TRICKY_FIELDS) {
      for (const b of TRICKY_FIELDS) {
        const row = [a, b];
        expect(parseTsv(encodeMatrix([row]))).toEqual([row]);
      }
    }
  });

  it("round-trips a multi-row matrix of tricky fields", () => {
    const matrix = TRICKY_FIELDS.map((field, i) => [
      field,
      `row${String(i)}`,
      TRICKY_FIELDS[(i + 7) % TRICKY_FIELDS.length]!,
    ]);
    expect(parseTsv(encodeMatrix(matrix))).toEqual(matrix);
  });

  it("round-trips single-field rows (except the ambiguous lone empty field)", () => {
    for (const field of TRICKY_FIELDS) {
      if (field === "") continue; // a lone empty field encodes to "" — see parseTsv docs
      const matrix = [[field]];
      expect(parseTsv(encodeMatrix(matrix))).toEqual(matrix);
    }
  });
});

import { describe, expect, test } from "vitest";

import { parseJsonl } from "./recording-loader";
import type { Phase1Entry, Phase2Entry } from "./types";

describe("parseJsonl", () => {
  test("parses valid JSONL into an array", () => {
    const text =
      '{"t":0.042,"type":"response.output_text.delta","delta":"["}\n' +
      '{"t":0.061,"type":"response.output_text.done"}\n';

    const result = parseJsonl<Phase1Entry>(text);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      t: 0.042,
      type: "response.output_text.delta",
      delta: "[",
    });
    expect(result[1]).toEqual({
      t: 0.061,
      type: "response.output_text.done",
    });
  });

  test("ignores trailing blank lines", () => {
    const text = '{"t":0,"patches":[]}\n\n\n';
    const result = parseJsonl<Phase2Entry>(text);
    expect(result).toHaveLength(1);
  });

  test("throws with line number on malformed JSON", () => {
    const text = '{"t":0}\nnot json\n{"t":2}\n';
    expect(() => parseJsonl(text)).toThrow(/line 2/);
  });

  test("handles empty input", () => {
    expect(parseJsonl("")).toEqual([]);
    expect(parseJsonl("\n\n")).toEqual([]);
  });
});

import { describe, expect, test } from "vitest";

import { countGraphemes } from "../graphemes";
import { layoutPreparedText, prepareText } from "../index";

const FONT_KEY = "Inter-400-14";

/**
 * A measurer that returns exactly what the average-width path assumes:
 * `averageCharWidth × graphemeCount`. The two paths must agree on line count
 * for every input when fed this — that is the bridge between them.
 */
function bridgeMeasurer(averageCharWidth: number) {
  return (segment: string) => averageCharWidth * countGraphemes(segment);
}

function recordingMeasurer(width: (segment: string) => number) {
  const calls: string[] = [];

  return {
    calls,
    measureSegment: (segment: string) => {
      calls.push(segment);
      return width(segment);
    },
  };
}

describe("injectable segment measurer", () => {
  test("no measurer leaves the prepared record and the layout exactly as before", () => {
    const prepared = prepareText({
      text: "alpha beta gamma delta epsilon",
      fontKey: FONT_KEY,
      averageCharWidth: 7,
    });

    expect("tokenWidthsPx" in prepared).toBe(false);
    expect(prepared.tokenWidthsPx).toBeUndefined();

    // charsPerLine = floor(84 / 7) = 12: "alpha beta " / "gamma delta " /
    // "epsilon". measuredWidth is the widest line — 12 chars including the
    // trailing space it kept — times 7. Pinned as literals so the average path
    // cannot drift silently.
    expect(layoutPreparedText(prepared, 84, { lineHeightPx: 18 })).toEqual({
      lineCount: 3,
      height: 54,
      measuredWidth: 84,
      overflowX: false,
    });
  });

  test("a measurer attaches one width per token, index-aligned", () => {
    const prepared = prepareText({
      text: "alpha beta\ngamma",
      fontKey: FONT_KEY,
      measureSegment: (segment) => segment.length * 10,
    });

    expect(prepared.tokenWidthsPx).toHaveLength(prepared.tokens.length);
    expect(prepared.tokens.map((token) => token.kind)).toEqual([
      "word",
      "space",
      "word",
      "newline",
      "word",
    ]);
    // The newline carries no advance width and is never handed to the measurer.
    expect(prepared.tokenWidthsPx).toEqual([50, 10, 40, 0, 50]);
  });

  test("each distinct token is measured exactly once per prepareText call", () => {
    const { calls, measureSegment } = recordingMeasurer(
      (segment) => segment.length * 10,
    );

    prepareText({
      text: "beta alpha beta alpha beta\nbeta",
      fontKey: FONT_KEY,
      measureSegment,
    });

    // Six word tokens and five spaces, but only three distinct segments.
    expect(calls).toEqual(["beta", " ", "alpha"]);
    expect(new Set(calls).size).toBe(calls.length);
    expect(calls).not.toContain("\n");
  });

  test("the bridge: a measurer matching the average produces the same line count", () => {
    const cases: { text: string; averageCharWidth: number }[] = [
      { text: "alpha beta gamma delta epsilon", averageCharWidth: 7 },
      { text: "alpha beta gamma delta epsilon", averageCharWidth: 6.505 },
      { text: "one two three four five six seven eight", averageCharWidth: 8 },
      { text: "line one\nline two\n\nline four", averageCharWidth: 6.505 },
      {
        text: "supercalifragilisticexpialidocious rides again",
        averageCharWidth: 6.505,
      },
      { text: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", averageCharWidth: 7 },
      { text: "   leading and  doubled   spaces   ", averageCharWidth: 6.505 },
      { text: "trailing space ", averageCharWidth: 7 },
    ];

    const widths = [
      1, 2, 7, 13, 20, 27, 33, 40, 56, 65, 84, 100, 137, 200, 224, 401,
    ];

    // Letter spacing is part of the bridge, not a separate concern: the
    // average path folds it into the effective char width while the measured
    // path adds it per grapheme, and those are only the same rule if the two
    // keep agreeing under it.
    const letterSpacings = [0, 0.5, 2, -0.5];

    const disagreements: string[] = [];

    for (const { text, averageCharWidth } of cases) {
      for (const letterSpacingPx of letterSpacings) {
        const average = prepareText({
          text,
          fontKey: FONT_KEY,
          averageCharWidth,
          letterSpacingPx,
        });
        const measured = prepareText({
          text,
          fontKey: FONT_KEY,
          averageCharWidth,
          letterSpacingPx,
          measureSegment: bridgeMeasurer(averageCharWidth),
        });

        for (const width of widths) {
          const averageLines = layoutPreparedText(average, width).lineCount;
          const measuredLines = layoutPreparedText(measured, width).lineCount;

          if (averageLines !== measuredLines) {
            disagreements.push(
              `${JSON.stringify(text)} @ ${width}px, avg ${averageCharWidth}, ls ${letterSpacingPx}: average ${averageLines} vs measured ${measuredLines}`,
            );
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
    // Guards the loop itself: 8 cases × 4 spacings × 16 widths.
    expect(cases.length * letterSpacings.length * widths.length).toBe(512);
  });

  test("a measurer that disagrees with the average changes the line count", () => {
    const text = "ALPHA BETA GAMMA";
    const average = prepareText({
      text,
      fontKey: FONT_KEY,
      averageCharWidth: 7,
    });
    const measured = prepareText({
      text,
      fontKey: FONT_KEY,
      averageCharWidth: 7,
      // All-caps really is wider than the average: this is the whole point.
      measureSegment: (segment) => segment.length * 11,
    });

    expect(layoutPreparedText(average, 84).lineCount).toBe(2);
    expect(layoutPreparedText(measured, 84).lineCount).toBe(3);
  });

  test("measuredWidth on the measured path is a real measurement", () => {
    const prepared = prepareText({
      text: "alpha beta",
      fontKey: FONT_KEY,
      averageCharWidth: 7,
      measureSegment: (segment) => segment.length * 10,
    });

    // One line of "alpha beta" = 10 graphemes × 10px, not maxLineChars × 7.
    expect(layoutPreparedText(prepared, 200).measuredWidth).toBe(100);
  });

  test("nowrap reports the measured intrinsic width", () => {
    const prepared = prepareText({
      text: "alpha beta",
      fontKey: FONT_KEY,
      averageCharWidth: 7,
      measureSegment: (segment) => segment.length * 10,
    });

    const layout = layoutPreparedText(prepared, 40, { wrapMode: "nowrap" });

    expect(layout.lineCount).toBe(1);
    expect(layout.measuredWidth).toBe(100);
    expect(layout.overflowX).toBe(true);
    expect(
      layoutPreparedText(prepared, 400, { wrapMode: "nowrap" }).overflowX,
    ).toBe(false);
  });

  test("a token wider than the line gets its own lines and terminates", () => {
    const prepared = prepareText({
      text: "hi supercalifragilistic ok",
      fontKey: FONT_KEY,
      averageCharWidth: 10,
      measureSegment: (segment) => segment.length * 10,
    });

    // "supercalifragilistic" is 20 graphemes at 10px = 200px against a 50px
    // line: 5 graphemes per line, 4 lines of its own.
    const layout = layoutPreparedText(prepared, 50, { lineHeightPx: 20 });

    expect(layout.lineCount).toBe(6);
    expect(layout.height).toBe(120);
    expect(layout.measuredWidth).toBeLessThanOrEqual(50);
  });

  test("a single token wider than the line does not hang or lose lines", () => {
    const prepared = prepareText({
      text: "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww",
      fontKey: FONT_KEY,
      averageCharWidth: 10,
      measureSegment: (segment) => segment.length * 10,
    });

    expect(layoutPreparedText(prepared, 100).lineCount).toBe(4);
    expect(layoutPreparedText(prepared, 1).lineCount).toBe(40);
  });

  test("zero and negative available widths are clamped, not divided by", () => {
    const prepared = prepareText({
      text: "alpha beta",
      fontKey: FONT_KEY,
      averageCharWidth: 7,
      measureSegment: (segment) => segment.length * 10,
    });

    for (const width of [0, -1, -1000]) {
      const layout = layoutPreparedText(prepared, width, { lineHeightPx: 20 });

      // One line per grapheme of each word: 5 + 4 = 9.
      expect(layout.lineCount).toBe(9);
      expect(Number.isFinite(layout.height)).toBe(true);
      expect(Number.isFinite(layout.measuredWidth)).toBe(true);
      expect(layout.measuredWidth).toBe(0);
    }
  });

  test("zero and negative widths agree with the average path too", () => {
    for (const width of [0, -1]) {
      const average = prepareText({
        text: "alpha beta gamma",
        fontKey: FONT_KEY,
        averageCharWidth: 7,
      });
      const measured = prepareText({
        text: "alpha beta gamma",
        fontKey: FONT_KEY,
        averageCharWidth: 7,
        measureSegment: bridgeMeasurer(7),
      });

      expect(layoutPreparedText(measured, width).lineCount).toBe(
        layoutPreparedText(average, width).lineCount,
      );
    }
  });

  test("a widths array that does not match the tokens falls back to the average path", () => {
    const prepared = prepareText({
      text: "alpha beta gamma delta epsilon",
      fontKey: FONT_KEY,
      averageCharWidth: 7,
    });

    const corrupted = { ...prepared, tokenWidthsPx: [1, 2] };

    expect(layoutPreparedText(corrupted, 84, { lineHeightPx: 18 })).toEqual(
      layoutPreparedText(prepared, 84, { lineHeightPx: 18 }),
    );
  });
});

describe("letter spacing", () => {
  /**
   * The rule, measured rather than assumed.
   *
   * Playwright probe, `font: 20px monospace`, `letter-spacing: 10px`, the
   * 11-grapheme string `"aaaaa aaaaa"`, in Chromium 1234 / WebKit 2336 /
   * Firefox 1532. All three reported an inline width exactly 110px (= 11 × 10)
   * wider than the unspaced run, and all three kept the string on one line
   * only from ~242px (= 11 × (12.0 + 10)) upward — at ~232px, which is what a
   * "trailing spacing is trimmed at the line end" model predicts would fit, it
   * wrapped to two lines. So CSS charges the spacing to every grapheme, the
   * last one on a line included, and the engines do not diverge.
   *
   * These two cases are that probe, in arithmetic: an advance of 12px, a
   * spacing of 10px, and the same 242 / 232 boundary on both paths.
   */
  test("the last grapheme on a line is charged its letter spacing, as browsers do", () => {
    const text = "aaaaa aaaaa";
    const options = {
      text,
      fontKey: FONT_KEY,
      averageCharWidth: 12,
      letterSpacingPx: 10,
    };

    const average = prepareText(options);
    const measured = prepareText({
      ...options,
      measureSegment: (segment) => countGraphemes(segment) * 12,
    });

    // 11 × (12 + 10) = 242 exactly. A trailing-trimmed model would need only
    // 232, so a pass at 232 is the thing this test exists to catch.
    expect(layoutPreparedText(average, 242).lineCount).toBe(1);
    expect(layoutPreparedText(measured, 242).lineCount).toBe(1);
    expect(layoutPreparedText(average, 232).lineCount).toBe(2);
    expect(layoutPreparedText(measured, 232).lineCount).toBe(2);
  });

  test("letter spacing adds lines on the average path", () => {
    const text = "alpha beta gamma";

    const unspaced = prepareText({
      text,
      fontKey: FONT_KEY,
      averageCharWidth: 7,
    });
    const spaced = prepareText({
      text,
      fontKey: FONT_KEY,
      averageCharWidth: 7,
      letterSpacingPx: 3,
    });

    // charsPerLine goes from floor(84 / 7) = 12 to floor(84 / 10) = 8.
    expect(layoutPreparedText(unspaced, 84).lineCount).toBe(2);
    expect(layoutPreparedText(spaced, 84).lineCount).toBe(3);
  });

  test("letter spacing adds lines on the measured path", () => {
    const text = "alpha beta";
    const measureSegment = (segment: string) => countGraphemes(segment) * 10;

    const unspaced = prepareText({ text, fontKey: FONT_KEY, measureSegment });
    const spaced = prepareText({
      text,
      fontKey: FONT_KEY,
      measureSegment,
      letterSpacingPx: 1,
    });

    // 100px of text becomes 110px against a 100px line.
    expect(unspaced.tokenWidthsPx).toEqual([50, 10, 40]);
    expect(spaced.tokenWidthsPx).toEqual([55, 11, 44]);
    expect(layoutPreparedText(unspaced, 100).lineCount).toBe(1);
    expect(layoutPreparedText(spaced, 100).lineCount).toBe(2);
  });

  test("negative letter spacing removes lines, as CSS does", () => {
    const text = "alpha beta gamma";
    const options = { text, fontKey: FONT_KEY, averageCharWidth: 7 };

    // charsPerLine goes from floor(96 / 7) = 13 to floor(96 / 6) = 16, which
    // is exactly the 16 graphemes of the text.
    expect(layoutPreparedText(prepareText(options), 96).lineCount).toBe(2);
    expect(
      layoutPreparedText(prepareText({ ...options, letterSpacingPx: -1 }), 96)
        .lineCount,
    ).toBe(1);
  });

  test("letter spacing widens measuredWidth and the nowrap intrinsic width", () => {
    const text = "alpha beta";
    const measureSegment = (segment: string) => countGraphemes(segment) * 10;

    const measured = prepareText({
      text,
      fontKey: FONT_KEY,
      averageCharWidth: 10,
      measureSegment,
      letterSpacingPx: 2,
    });
    const average = prepareText({
      text,
      fontKey: FONT_KEY,
      averageCharWidth: 10,
      letterSpacingPx: 2,
    });

    // 10 graphemes × (10 + 2).
    expect(layoutPreparedText(measured, 500).measuredWidth).toBe(120);
    expect(layoutPreparedText(average, 500).measuredWidth).toBe(120);
    expect(
      layoutPreparedText(measured, 500, { wrapMode: "nowrap" }).measuredWidth,
    ).toBe(120);
  });

  test("zero and undefined letter spacing are identical to today, on both paths", () => {
    const texts = [
      "alpha beta gamma delta epsilon",
      "line one\nline two\n\nline four",
      "   leading and  doubled   spaces   ",
      "supercalifragilisticexpialidocious rides again",
    ];
    const widths = [1, 7, 13, 40, 84, 137, 401];

    for (const text of texts) {
      for (const measureSegment of [
        undefined,
        (segment: string) => countGraphemes(segment) * 6.505,
      ]) {
        const base = { text, fontKey: FONT_KEY, averageCharWidth: 6.505 };
        const absent = prepareText({ ...base, measureSegment });
        const explicitUndefined = prepareText({
          ...base,
          measureSegment,
          letterSpacingPx: undefined,
        });
        const zero = prepareText({
          ...base,
          measureSegment,
          letterSpacingPx: 0,
        });

        expect(explicitUndefined).toEqual(absent);
        expect(zero).toEqual(absent);
        // `toEqual` treats 0 and -0 as equal; the advance must be the same
        // double, since it is divided by.
        expect(Object.is(zero.averageCharWidth, absent.averageCharWidth)).toBe(
          true,
        );

        for (const width of widths) {
          expect(layoutPreparedText(zero, width)).toEqual(
            layoutPreparedText(absent, width),
          );
          expect(layoutPreparedText(explicitUndefined, width)).toEqual(
            layoutPreparedText(absent, width),
          );
        }
      }
    }
  });

  test("letter spacing does not make prepareText measure a segment twice", () => {
    const { calls, measureSegment } = recordingMeasurer(
      (segment) => segment.length * 10,
    );

    prepareText({
      text: "beta alpha beta alpha beta",
      fontKey: FONT_KEY,
      measureSegment,
      letterSpacingPx: 4,
    });

    expect(calls).toEqual(["beta", " ", "alpha"]);
  });
});

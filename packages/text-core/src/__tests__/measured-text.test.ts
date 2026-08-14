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

    // So is `pre-wrap`: it changes how both paths charge whitespace, and the
    // two only implement the same rule if they still agree under it.
    const wrapModes = ["wrap", "pre-wrap"] as const;

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
          for (const wrapMode of wrapModes) {
            const averageLines = layoutPreparedText(average, width, {
              wrapMode,
            }).lineCount;
            const measuredLines = layoutPreparedText(measured, width, {
              wrapMode,
            }).lineCount;

            if (averageLines !== measuredLines) {
              disagreements.push(
                `${JSON.stringify(text)} @ ${width}px, avg ${averageCharWidth}, ls ${letterSpacingPx}, ${wrapMode}: average ${averageLines} vs measured ${measuredLines}`,
              );
            }
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
    // Guards the loop itself: 8 cases × 4 spacings × 16 widths × 2 wrap modes.
    expect(
      cases.length * letterSpacings.length * widths.length * wrapModes.length,
    ).toBe(1024);
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

/**
 * `white-space: pre-wrap`.
 *
 * Every expectation in this block that is labelled "browser" was read out of
 * Chromium 151.0.7922.34, WebKit 26.5 and Firefox 153.0 through Playwright,
 * with `font: 20px monospace` (advance ~12px), `line-height: 20px`, container
 * widths set to a whole number of advances, and line counts taken from the
 * rendered block height. The three engines agreed on every case below. The
 * arithmetic here uses a flat 12px advance, which is what those containers
 * were sized in.
 */
describe("pre-wrap", () => {
  const ADVANCE = 12;
  /** A container of `n` advances, as the browser probe sized them. */
  const box = (n: number) => n * ADVANCE;

  function bothPaths(text: string) {
    return {
      average: prepareText({
        text,
        fontKey: FONT_KEY,
        averageCharWidth: ADVANCE,
      }),
      measured: prepareText({
        text,
        fontKey: FONT_KEY,
        averageCharWidth: ADVANCE,
        measureSegment: bridgeMeasurer(ADVANCE),
      }),
    };
  }

  function lineCounts(
    text: string,
    wrapMode: "wrap" | "pre-wrap",
    boxes: number[],
  ) {
    const { average, measured } = bothPaths(text);

    return {
      average: boxes.map(
        (n) => layoutPreparedText(average, box(n), { wrapMode }).lineCount,
      ),
      measured: boxes.map(
        (n) => layoutPreparedText(measured, box(n), { wrapMode }).lineCount,
      ),
    };
  }

  test("a space run hangs: it never moves down and never breaks the line itself", () => {
    // browser: "aa      aa" is 2 lines at every container from 2 to 9
    // advances and 1 line at 10, in all three engines. A model that pushed the
    // unfitting 6-space run onto the next line would report 3 at the narrow
    // end; one that made the run free would reach 1 line at 4.
    const boxes = [2, 3, 4, 5, 6, 8, 9, 10, 11];
    const expected = [2, 2, 2, 2, 2, 2, 2, 1, 1];

    expect(lineCounts("aa      aa", "pre-wrap", boxes)).toEqual({
      average: expected,
      measured: expected,
    });
  });

  test("leading spaces occupy the line, where wrap drops them", () => {
    // browser: "  aa aa" under `pre-wrap` is 2 lines at 5 advances and 1 at 7;
    // under `normal` it is 1 line from 5 up. This is the plan's
    // leading-spaces case, and the clearest wrap/pre-wrap divergence.
    const boxes = [4, 5, 6, 7];

    expect(lineCounts("  aa aa", "pre-wrap", boxes)).toEqual({
      average: [2, 2, 2, 1],
      measured: [2, 2, 2, 1],
    });
    expect(lineCounts("  aa aa", "wrap", boxes)).toEqual({
      average: [2, 1, 1, 1],
      measured: [2, 1, 1, 1],
    });
  });

  test("leading spaces after a forced break are preserved too", () => {
    // browser: "aa\n  aa bb" under `pre-wrap` is 3 lines at 5 and 6 advances,
    // 2 at 7 and 8.
    const boxes = [5, 6, 7, 8];

    expect(lineCounts("aa\n  aa bb", "pre-wrap", boxes)).toEqual({
      average: [3, 3, 2, 2],
      measured: [3, 3, 2, 2],
    });
    expect(lineCounts("aa\n  aa bb", "wrap", boxes)).toEqual({
      average: [2, 2, 2, 2],
      measured: [2, 2, 2, 2],
    });
  });

  test("a trailing space run before a forced break does not add a line", () => {
    // browser: "aa      \nbb" is 2 lines under `pre-wrap` at 4 advances — the
    // trailing run hangs off line one rather than starting a line of its own.
    // `wrap` also reports 2, for the other reason: the run collapses to a
    // single space, which fits beside "aa" in a 4-advance box.
    const boxes = [4, 10];

    expect(lineCounts("aa      \nbb", "pre-wrap", boxes)).toEqual({
      average: [2, 2],
      measured: [2, 2],
    });
    expect(lineCounts("aa      \nbb", "wrap", boxes)).toEqual({
      average: [2, 2],
      measured: [2, 2],
    });
  });

  test("a trailing space run at the end of the text does not add a line", () => {
    // browser: "aaa  " is 1 line at 2.5 advances, spaces hanging.
    expect(lineCounts("aaa  ", "pre-wrap", [3, 5])).toEqual({
      average: [1, 1],
      measured: [1, 1],
    });
  });

  test("`\\n` still forces a break under pre-wrap", () => {
    // browser: "a\nb" is 2 lines under `pre-wrap` in a box far wider than the
    // text, exactly as it is under `wrap`.
    expect(lineCounts("a\nb", "pre-wrap", [40])).toEqual({
      average: [2],
      measured: [2],
    });
  });

  /**
   * The trailing-whitespace decision, stated rather than inherited.
   *
   * Preserved spaces are charged to the running line width, so a line that
   * ends in whitespace reports that whitespace in `measuredWidth` — the same
   * choice `wrap` already makes (see the 84-not-77 pin at the top of this
   * file). The clamp to the available width is what keeps a *hanging* run from
   * inflating the answer: browsers let the run overflow the content box (line
   * box right edge 96px inside a 60px container for "aa      aa"), and
   * `measuredWidth` is a content-box width, so `min(available, widest)` is the
   * browser's own answer rather than an approximation of it.
   */
  test("preserved trailing whitespace counts toward measuredWidth, clamped to the box", () => {
    const { average, measured } = bothPaths("aa   ");

    // 5 graphemes × 12px, trailing run included — not the 24px the two
    // visible glyphs occupy.
    expect(
      layoutPreparedText(average, box(10), { wrapMode: "pre-wrap" })
        .measuredWidth,
    ).toBe(60);
    expect(
      layoutPreparedText(measured, box(10), { wrapMode: "pre-wrap" })
        .measuredWidth,
    ).toBe(60);

    const hanging = bothPaths("aa      aa");

    // The run hangs 36px past a 60px box; the reported width is the box.
    expect(
      layoutPreparedText(hanging.average, box(5), { wrapMode: "pre-wrap" })
        .measuredWidth,
    ).toBe(60);
    expect(
      layoutPreparedText(hanging.measured, box(5), { wrapMode: "pre-wrap" })
        .measuredWidth,
    ).toBe(60);
    // `wrap` collapses the run to one space, so the whole string is
    // "aa aa" — 5 graphemes, exactly the 60px box, on one line.
    expect(
      layoutPreparedText(hanging.average, box(5), { wrapMode: "wrap" })
        .measuredWidth,
    ).toBe(60);
    expect(
      layoutPreparedText(hanging.average, box(5), { wrapMode: "wrap" })
        .lineCount,
    ).toBe(1);
  });

  /**
   * The contradiction this file used to pin, now resolved.
   *
   * The previous version of this test recorded that `wrap` charged a mid-text
   * space run its full grapheme width — the same as `pre-wrap` — so the two
   * modes parted company only over *where* a run may sit. Browsers collapse
   * under `white-space: normal` ("a  a" measures 3 advances, not 4), so that
   * was an over-charge, left in place because that task had to leave `wrap`
   * untouched and pinned so that changing it would be deliberate. This is that
   * deliberate change: `wrap` now collapses, and the modes differ over a run's
   * *width* as well.
   */
  test("wrap collapses a mid-text space run where pre-wrap preserves it", () => {
    const boxes = [3, 5, 8, 9, 10];

    expect(lineCounts("aa      aa", "wrap", boxes)).not.toEqual(
      lineCounts("aa      aa", "pre-wrap", boxes),
    );
    // "aa aa" is 5 advances wide, so it fits from a 5-advance box up. The
    // 3-advance box still needs two lines, and both paths say so.
    expect(lineCounts("aa      aa", "wrap", boxes)).toEqual({
      average: [2, 1, 1, 1, 1],
      measured: [2, 1, 1, 1, 1],
    });
  });

  test("wrap and nowrap are untouched by the new mode", () => {
    const texts = [
      "  aa aa",
      "aa      aa",
      "aa      \nbb",
      "aa\n  aa bb",
      "aaa  ",
    ];
    const boxes = [1, 2, 4, 5, 7, 10, 40];

    for (const text of texts) {
      const { average, measured } = bothPaths(text);

      for (const n of boxes) {
        // The default is still `wrap`, and asking for it explicitly is still
        // the same computation.
        expect(
          layoutPreparedText(average, box(n), { wrapMode: "wrap" }),
        ).toEqual(layoutPreparedText(average, box(n)));
        expect(
          layoutPreparedText(measured, box(n), { wrapMode: "wrap" }),
        ).toEqual(layoutPreparedText(measured, box(n)));
      }
    }

    // `nowrap` still reports one line per explicit newline and the full
    // intrinsic width, whitespace included, regardless of the box.
    const { average, measured } = bothPaths("  aa aa");

    for (const layout of [
      layoutPreparedText(average, box(2), { wrapMode: "nowrap" }),
      layoutPreparedText(measured, box(2), { wrapMode: "nowrap" }),
    ]) {
      expect(layout.lineCount).toBe(1);
      expect(layout.measuredWidth).toBe(84);
      expect(layout.overflowX).toBe(true);
    }
  });
});

/**
 * `white-space: normal` collapsing, on both paths.
 *
 * Same Playwright probe as the `pre-wrap` block above (Chromium
 * 151.0.7922.34, WebKit 26.5, Firefox 153.0; `font: 20px monospace`,
 * `line-height: 20px`): inline `"a  a"` measures 36.02 / 36.01 / 36.10px
 * under `normal` — 3 advances, not the 4 it measures under `pre-wrap`. A run
 * of whitespace collapses to one space, and that is what `wrap` charges.
 */
describe("wrap collapses whitespace runs", () => {
  const ADVANCE = 12;
  const box = (n: number) => n * ADVANCE;

  function bothPaths(text: string) {
    return {
      average: prepareText({
        text,
        fontKey: FONT_KEY,
        averageCharWidth: ADVANCE,
      }),
      measured: prepareText({
        text,
        fontKey: FONT_KEY,
        averageCharWidth: ADVANCE,
        measureSegment: bridgeMeasurer(ADVANCE),
      }),
    };
  }

  function wrapLines(text: string, boxes: number[]) {
    const { average, measured } = bothPaths(text);

    return {
      average: boxes.map((n) => layoutPreparedText(average, box(n)).lineCount),
      measured: boxes.map(
        (n) => layoutPreparedText(measured, box(n)).lineCount,
      ),
    };
  }

  test("a run of any length costs exactly one space", () => {
    // Every one of these is "a a" once collapsed: 3 advances, one line in a
    // 3-advance box. Uncollapsed, the 20-space case would need 22.
    for (const run of [" ", "  ", "    ", " ".repeat(20)]) {
      expect(wrapLines(`a${run}a`, [3])).toEqual({
        average: [1],
        measured: [1],
      });
    }

    // And the collapse is not "free": a single space is still charged, so a
    // 2-advance box cannot hold "a a".
    expect(wrapLines("a  a", [2])).toEqual({ average: [2], measured: [2] });
  });

  test("measuredWidth reports the collapsed line, not the run", () => {
    const { average, measured } = bothPaths("aa      aa");

    // "aa aa" — 5 graphemes × 12px. The 8-grapheme raw string would be 120.
    expect(layoutPreparedText(average, box(10)).measuredWidth).toBe(60);
    expect(layoutPreparedText(measured, box(10)).measuredWidth).toBe(60);
  });

  test("collapsing holds under letter spacing, on both paths", () => {
    const options = {
      text: "aa    aa",
      fontKey: FONT_KEY,
      averageCharWidth: ADVANCE,
      letterSpacingPx: 8,
    };
    const average = prepareText(options);
    const measured = prepareText({
      ...options,
      measureSegment: bridgeMeasurer(ADVANCE),
    });

    // Collapsed to "aa aa": 5 graphemes × (12 + 8) = 100px exactly. The
    // spacing is charged to the collapsed space too, so 99px is two lines.
    for (const prepared of [average, measured]) {
      expect(layoutPreparedText(prepared, 100).lineCount).toBe(1);
      expect(layoutPreparedText(prepared, 99).lineCount).toBe(2);
    }
  });

  /**
   * What the tokenizer does with each whitespace kind, checked rather than
   * assumed — the collapse is defined on the `space` token, so which
   * characters land in one is the whole question.
   */
  test("tabs are `space` tokens and collapse with the rest of the run", () => {
    const prepared = prepareText({ text: "a \t b\nc", fontKey: FONT_KEY });

    expect(prepared.tokens.map((token) => token.kind)).toEqual([
      "word",
      "space",
      "word",
      "newline",
      "word",
    ]);
    // Mixed space-and-tab whitespace is ONE token — the tokenizer's
    // `[^\S\n]+` class takes the whole run — so the collapse sees a single
    // run rather than alternating tokens with word-sized gaps between them.
    expect(prepared.tokens[1]?.value).toBe(prepared.text.slice(1, 4));
    expect(prepared.tokens[1]?.length).toBe(3);

    // The space+tab run is charged one grapheme, so "aa \t\t\taa" is "aa aa".
    expect(wrapLines("aa \t\t\taa", [4, 5])).toEqual({
      average: [2, 1],
      measured: [2, 1],
    });
  });

  /**
   * `\n` keeps breaking under `wrap`.
   *
   * A browser under `white-space: normal` collapses a newline into the
   * surrounding whitespace and does not break there. This module breaks
   * anyway, because its callers render cell values with newlines preserved.
   * That is the pre-existing model; the collapse does not touch it.
   */
  test("a newline still breaks the line and is not collapsed away", () => {
    expect(wrapLines("aa\naa", [40])).toEqual({ average: [2], measured: [2] });
    // Whitespace either side of the break does not merge across it.
    expect(wrapLines("aa  \n  aa", [40])).toEqual({
      average: [2],
      measured: [2],
    });
  });

  test("pre-wrap and nowrap do not collapse", () => {
    const { average, measured } = bothPaths("aa      aa");

    for (const prepared of [average, measured]) {
      // Preserved: 10 graphemes need 10 advances, where collapsed needs 5.
      expect(
        layoutPreparedText(prepared, box(5), { wrapMode: "pre-wrap" })
          .lineCount,
      ).toBe(2);
      expect(
        layoutPreparedText(prepared, box(10), { wrapMode: "pre-wrap" })
          .lineCount,
      ).toBe(1);

      // The nowrap intrinsic width is the whole string, run included.
      expect(
        layoutPreparedText(prepared, box(5), { wrapMode: "nowrap" })
          .measuredWidth,
      ).toBe(120);
    }
  });

  test("a leading run is still dropped, not charged as one space", () => {
    // "  aa aa" collapses to "aa aa" with the leading run removed entirely —
    // 5 advances, not 6.
    expect(wrapLines("      aa aa", [5])).toEqual({
      average: [1],
      measured: [1],
    });
  });
});

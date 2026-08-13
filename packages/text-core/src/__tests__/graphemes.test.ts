import { afterEach, describe, expect, test, vi } from "vitest";

import { layoutPreparedText, prepareText } from "../index";

// "café naïve" written with COMBINING marks rather than precomposed letters:
//   c a f e U+0301 SPACE n a i U+0308 v e
// That is 12 code points but 10 user-perceived characters — the two combining
// marks attach to the letter before them. `Array.from` counts 12.
const COMBINING_TEXT = "cafe\u0301 nai\u0308ve";
const COMBINING_CODE_POINTS = 12;
const COMBINING_GRAPHEMES = 10;

// The family emoji: MAN ZWJ WOMAN ZWJ GIRL ZWJ BOY. Four emoji joined by three
// U+200D zero-width joiners is 7 code points, rendered as ONE glyph, so it is
// 1 user-perceived character. `Array.from` counts 7.
const FAMILY_EMOJI = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
const FAMILY_CODE_POINTS = 7;
const FAMILY_GRAPHEMES = 1;

describe("grapheme segmentation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test("the fixtures really do differ between graphemes and code points", () => {
    expect(Array.from(COMBINING_TEXT)).toHaveLength(COMBINING_CODE_POINTS);
    expect(Array.from(FAMILY_EMOJI)).toHaveLength(FAMILY_CODE_POINTS);
    expect(COMBINING_GRAPHEMES).toBeLessThan(COMBINING_CODE_POINTS);
    expect(FAMILY_GRAPHEMES).toBeLessThan(FAMILY_CODE_POINTS);
  });

  test("combining marks count as one character with the letter they attach to", () => {
    const prepared = prepareText({
      text: COMBINING_TEXT,
      fontKey: "Inter-400-14",
    });

    expect(prepared.graphemeCount).toBe(COMBINING_GRAPHEMES);
  });

  test("a ZWJ emoji sequence counts as a single character", () => {
    const prepared = prepareText({
      text: FAMILY_EMOJI,
      fontKey: "Inter-400-14",
    });

    expect(prepared.graphemeCount).toBe(FAMILY_GRAPHEMES);
  });

  test("token lengths — the wrap arithmetic's input — count graphemes", () => {
    const prepared = prepareText({
      text: `${FAMILY_EMOJI} café`,
      fontKey: "Inter-400-14",
    });

    // ["👨‍👩‍👧‍👦", " ", "café"] → 1 grapheme, 1 space, 4 graphemes.
    expect(prepared.tokens.map((token) => token.length)).toEqual([1, 1, 4]);
  });

  test("breakpoints are grapheme indices, not code-point indices", () => {
    const prepared = prepareText({
      text: COMBINING_TEXT,
      fontKey: "Inter-400-14",
    });

    // The only breakpoint is after the space, which follows "café" — four
    // user-perceived characters — so the break is at index 5, not 6.
    expect(prepared.breakpoints).toEqual([5]);
  });

  test("grapheme counts change the predicted line count for emoji text", () => {
    const text = Array.from({ length: 4 }, () => FAMILY_EMOJI).join(" ");
    const prepared = prepareText({
      text,
      fontKey: "Inter-400-14",
      averageCharWidth: 10,
    });

    // 7 graphemes ("X X X X") at 10px each fit inside 100px on one line.
    // Counting code points would make it 31 "characters" and wrap it.
    expect(
      layoutPreparedText(prepared, 100, { lineHeightPx: 20 }).lineCount,
    ).toBe(1);
  });

  test("the segmenter is constructed once, not once per call", async () => {
    vi.resetModules();

    const RealSegmenter = Intl.Segmenter;
    let constructions = 0;
    const CountingSegmenter = function (
      this: unknown,
      ...args: ConstructorParameters<typeof Intl.Segmenter>
    ) {
      constructions += 1;
      return new RealSegmenter(...args);
    } as unknown as typeof Intl.Segmenter;

    vi.stubGlobal("Intl", { ...Intl, Segmenter: CountingSegmenter });

    const { prepareText: prepareTextFresh } = await import("../prepare-text");

    for (let index = 0; index < 5; index += 1) {
      prepareTextFresh({
        text: `${COMBINING_TEXT} ${String(index)}`,
        fontKey: "Inter-400-14",
      });
    }

    expect(constructions).toBe(1);
  });

  test("falls back to Array.from where Intl.Segmenter is unavailable", async () => {
    vi.resetModules();
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });

    const { prepareText: prepareTextWithoutSegmenter } =
      await import("../prepare-text");

    const prepared = prepareTextWithoutSegmenter({
      text: FAMILY_EMOJI,
      fontKey: "Inter-400-14",
    });

    // Without a segmenter the count degrades to code points — the pre-existing
    // behaviour — rather than throwing.
    expect(prepared.graphemeCount).toBe(FAMILY_CODE_POINTS);

    const ascii = prepareTextWithoutSegmenter({
      text: "alpha beta gamma",
      fontKey: "Inter-400-14",
    });

    // ASCII is unaffected either way.
    expect(ascii.graphemeCount).toBe(16);
  });
});

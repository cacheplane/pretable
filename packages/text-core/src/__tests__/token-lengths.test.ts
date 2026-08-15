import { afterEach, describe, expect, test, vi } from "vitest";

import { countGraphemes, segmentGraphemes } from "../graphemes";
import { prepareText } from "../index";

const FONT_KEY = "Inter-400-14";

// MAN ZWJ WOMAN ZWJ GIRL ZWJ BOY — 7 code points, 11 code units, 1 grapheme.
const FAMILY = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
// Regional indicator pairs. Two code points, 4 code units, 1 grapheme each —
// and the pairing is *positional*, so a mis-sliced run changes the count.
const FLAG_US = "\u{1F1FA}\u{1F1F8}";
const FLAG_JP = "\u{1F1EF}\u{1F1F5}";
// THUMBS UP + EMOJI MODIFIER FITZPATRICK TYPE-4. 2 code points, 4 code units,
// 1 grapheme.
const THUMBS_UP_SKIN = "\u{1F44D}\u{1F3FD}";
// COMBINING ACUTE ACCENT. One code unit that attaches to whatever precedes it
// — including, and this is the trap, a *space*.
const ACUTE = "́";
const DIAERESIS = "̈";

/**
 * The corpus the length mapping is held to.
 *
 * Every entry is here to distinguish a correct grapheme→token mapping from a
 * plausible wrong one; see the "the corpus can actually disprove" test below,
 * which fails if the corpus stops exercising the traps.
 */
const CORPUS: readonly string[] = [
  // Degenerate inputs.
  "",
  " ",
  "   ",
  "\n",
  "\n\n",
  " \n \n ",
  "\t  ",
  // Plain ASCII: the control. A wrong mapping must NOT show up here, which is
  // why the emoji entries exist.
  "alpha beta gamma",
  "alpha beta gamma delta epsilon zeta eta theta",
  "-hyphen/slash_underscore-",
  // A single token that IS one multi-code-unit cluster.
  FAMILY,
  FLAG_US,
  THUMBS_UP_SKIN,
  // Clusters at, inside, and around token boundaries.
  `${FAMILY} ${FAMILY}`,
  `${FAMILY} caf${ACUTE}`,
  `word${FAMILY}word`,
  `${THUMBS_UP_SKIN} ok`,
  `${FLAG_US}${FLAG_JP} flags`,
  // Three flags back to back: six regional indicators whose clustering depends
  // on pair *parity*, so slicing the run anywhere changes the answer.
  `${FLAG_US}${FLAG_US}${FLAG_US}`,
  `${FLAG_US} ${FLAG_US}${FLAG_JP}`,
  // Combining marks on letters.
  `cafe${ACUTE} nai${DIAERESIS}ve`,
  `e${ACUTE}${ACUTE}e`,
  // THE STRADDLE: `" " + U+0301` is ONE grapheme cluster but TWO tokens, because
  // the tokenizer splits on whitespace and the segmenter does not.
  `a ${ACUTE}b`,
  ` ${ACUTE}`,
  `${ACUTE}${ACUTE} ${ACUTE}`,
  `a  ${ACUTE}${ACUTE}b`,
  // CRLF, which `prepareText` normalises before anything else touches it.
  "x\r\ny",
  `${FAMILY}\r\n${FLAG_US}`,
  "a\r\n\r\nb",
  // A lone CR is *not* normalised: it stays inline whitespace.
  "a\rb",
  // Mixed, long enough to have many tokens.
  `The ${FAMILY} family ate caf${ACUTE}e at ${FLAG_JP}\nand said ${THUMBS_UP_SKIN} twice.`,
];

function prepare(text: string) {
  return prepareText({ text, fontKey: FONT_KEY });
}

describe("token lengths derive from the single grapheme pass", () => {
  /**
   * The safety net for removing the second segmentation pass.
   *
   * Before this change every token's `length` was literally
   * `countGraphemes(token.value)`. That is now derived from the whole-string
   * segmentation instead, so this asserts the derivation reproduces the old
   * definition exactly, for every token of every corpus entry.
   */
  test("every token length equals countGraphemes(token.value), the pre-change definition", () => {
    const mismatches: string[] = [];

    for (const text of CORPUS) {
      const prepared = prepare(text);

      prepared.tokens.forEach((token, index) => {
        // Newlines have never carried a length.
        const expected =
          token.kind === "newline" ? 0 : countGraphemes(token.value);

        if (token.length !== expected) {
          mismatches.push(
            `${JSON.stringify(text)} token#${String(index)} ${JSON.stringify(
              token.value,
            )} (${token.kind}): got ${String(token.length)}, want ${String(
              expected,
            )}`,
          );
        }
      });
    }

    expect(mismatches).toEqual([]);
  });

  /**
   * A corpus that only holds ASCII would pass the test above no matter how the
   * mapping was written, because code units, code points and graphemes all
   * coincide there. This fails if that ever becomes true of the corpus.
   */
  test("the corpus can actually disprove a code-unit mapping", () => {
    const tokensWhereCodeUnitsDiffer: string[] = [];
    const straddlingEntries: string[] = [];

    for (const text of CORPUS) {
      const prepared = prepare(text);

      for (const token of prepared.tokens) {
        if (token.kind !== "newline" && token.value.length !== token.length) {
          tokensWhereCodeUnitsDiffer.push(token.value);
        }
      }

      // A straddle is detectable from the outside: the token lengths sum to
      // MORE than the string's grapheme count, because one cluster was charged
      // to two tokens.
      const summed = prepared.tokens.reduce(
        (total, token) => total + token.length,
        0,
      );
      const newlines = prepared.tokens.filter(
        (token) => token.kind === "newline",
      ).length;

      if (summed + newlines > prepared.graphemeCount) {
        straddlingEntries.push(text);
      }
    }

    // Emoji, flags and combining marks: counting code units would be wrong here.
    expect(tokensWhereCodeUnitsDiffer.length).toBeGreaterThan(10);
    // And at least one entry has a cluster spanning a token boundary.
    expect(straddlingEntries.length).toBeGreaterThan(0);
  });

  test("token values still tile the prepared text exactly", () => {
    for (const text of CORPUS) {
      const prepared = prepare(text);

      expect(prepared.tokens.map((token) => token.value).join("")).toBe(
        prepared.text,
      );
    }
  });

  test("token kinds are unchanged by the rewrite", () => {
    expect(
      prepare(`a\t ${FAMILY}\nb`).tokens.map((token) => token.kind),
    ).toEqual(["word", "space", "word", "newline", "word"]);

    // A lone CR is inline whitespace, not a newline.
    expect(prepare("a\rb").tokens.map((token) => token.kind)).toEqual([
      "word",
      "space",
      "word",
    ]);
  });
});

describe("the named grapheme traps, with their expected numbers spelled out", () => {
  test("a ZWJ family emoji is one grapheme, alone and inside a word", () => {
    expect(prepare(FAMILY).tokens).toEqual([
      { kind: "word", value: FAMILY, length: 1 },
    ]);

    expect(prepare(`word${FAMILY}word`).tokens.map((t) => t.length)).toEqual([
      9,
    ]);
  });

  test("regional indicators pair up — three flags are three graphemes, not six", () => {
    expect(prepare(`${FLAG_US}${FLAG_US}${FLAG_US}`).tokens[0]?.length).toBe(3);
    expect(prepare(`${FLAG_US}${FLAG_JP} flags`).tokens.map((t) => t.length)) //
      .toEqual([2, 1, 5]);
  });

  test("a skin-tone modifier does not add a character", () => {
    expect(prepare(`${THUMBS_UP_SKIN} ok`).tokens.map((t) => t.length)).toEqual(
      [1, 1, 2],
    );
  });

  test("combining marks attach to the letter before them", () => {
    expect(prepare(`cafe${ACUTE} nai${DIAERESIS}ve`).tokens).toEqual([
      { kind: "word", value: `cafe${ACUTE}`, length: 4 },
      { kind: "space", value: " ", length: 1 },
      { kind: "word", value: `nai${DIAERESIS}ve`, length: 5 },
    ]);
  });

  test("a cluster straddling a token boundary is charged to both tokens", () => {
    // `" " + U+0301` is ONE cluster spanning TWO tokens. Both sides count it,
    // which is what per-token `countGraphemes` used to produce: it saw `" "`
    // and `"́b"` as independent strings, 1 and 2 graphemes.
    const prepared = prepare(`a ${ACUTE}b`);

    expect(prepared.graphemeCount).toBe(3);
    expect(prepared.tokens).toEqual([
      { kind: "word", value: "a", length: 1 },
      { kind: "space", value: " ", length: 1 },
      { kind: "word", value: `${ACUTE}b`, length: 2 },
    ]);
    expect(segmentGraphemes(`a ${ACUTE}b`)).toEqual(["a", ` ${ACUTE}`, "b"]);
  });

  test("whitespace-only text produces one space token of its grapheme count", () => {
    expect(prepare("   ").tokens).toEqual([
      { kind: "space", value: "   ", length: 3 },
    ]);
    expect(prepare("").tokens).toEqual([]);
  });

  test("CRLF is still normalised to LF before segmentation or tokenizing", () => {
    const prepared = prepare("x\r\ny");

    expect(prepared.text).toBe("x\ny");
    expect(prepared.text).not.toContain("\r");
    expect(prepared.tokens).toEqual([
      { kind: "word", value: "x", length: 1 },
      { kind: "newline", value: "\n", length: 0 },
      { kind: "word", value: "y", length: 1 },
    ]);
    // Unnormalised, "\r\n" is a single grapheme cluster, so this would be 3.
    expect(prepared.graphemeCount).toBe(3);

    const emoji = prepare(`${FAMILY}\r\n${FLAG_US}`);

    expect(emoji.tokens.map((token) => token.length)).toEqual([1, 0, 1]);
  });
});

describe("the second segmentation pass is gone", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /**
   * The perf pin. `prepareText` used to segment the whole string once and then
   * re-segment it token by token via `countGraphemes`; on an S2 wrapped-text
   * scroll that duplicate pass was 156ms of a 748ms window. One `segment()`
   * call per `prepareText` is the invariant that keeps it gone.
   */
  test("prepareText segments each string exactly once, however many tokens it has", async () => {
    vi.resetModules();

    const RealSegmenter = Intl.Segmenter;
    const segmented: string[] = [];
    const CountingSegmenter = function (
      this: unknown,
      ...args: ConstructorParameters<typeof Intl.Segmenter>
    ) {
      const real = new RealSegmenter(...args);

      return {
        segment: (input: string) => {
          segmented.push(input);

          return real.segment(input);
        },
      };
    } as unknown as typeof Intl.Segmenter;

    vi.stubGlobal("Intl", { ...Intl, Segmenter: CountingSegmenter });

    const { prepareText: prepareTextFresh } = await import("../prepare-text");

    const text = `The ${FAMILY} family ate caf${ACUTE}e in ${FLAG_JP} today`;
    const prepared = prepareTextFresh({ text, fontKey: FONT_KEY });

    // Fifteen tokens (eight words, seven spaces), one segmentation — of the
    // whole string, not of a token. Before the change this was sixteen calls.
    expect(prepared.tokens.length).toBe(15);
    expect(segmented).toEqual([text]);
  });
});

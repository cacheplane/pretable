import { afterEach, describe, expect, test, vi } from "vitest";

import { countGraphemes, segmentGraphemes } from "../graphemes";

/**
 * Grid text is overwhelmingly ASCII, and ASCII cannot form a multi-code-unit
 * grapheme cluster: no surrogate pairs, no combining marks, no ZWJ sequences.
 * The one exception is CRLF, which Unicode joins into a single cluster — so
 * the fast path has to decline any text containing a carriage return.
 *
 * These tests pin BOTH halves. The segmenter must not be consulted for text
 * that cannot need it (it is 97% of `prepareText`'s cost — see the header of
 * `graphemes.ts`), and every answer must stay byte-identical to the answer the
 * segmenter would have given, CRLF included.
 */
describe("the ASCII fast path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /**
   * Re-imports `graphemes.ts` against an `Intl.Segmenter` that counts how many
   * times it is asked to segment anything, so a test can prove the fast path
   * did not reach it. Real segmentation still happens underneath, so the
   * answers these tests compare against are the genuine ones.
   */
  async function importWithCountingSegmenter(): Promise<{
    readonly countGraphemes: (text: string) => number;
    readonly segmentGraphemes: (text: string) => string[];
    readonly segmentCalls: () => number;
  }> {
    vi.resetModules();
    const RealSegmenter = Intl.Segmenter;
    let calls = 0;
    const CountingSegmenter = function (
      this: unknown,
      ...args: ConstructorParameters<typeof Intl.Segmenter>
    ) {
      const real = new RealSegmenter(...args);
      return {
        segment(input: string) {
          calls += 1;
          return real.segment(input);
        },
      };
    } as unknown as typeof Intl.Segmenter;

    vi.stubGlobal("Intl", { ...Intl, Segmenter: CountingSegmenter });
    const fresh = await import("../graphemes");
    return {
      countGraphemes: fresh.countGraphemes,
      segmentGraphemes: fresh.segmentGraphemes,
      segmentCalls: () => calls,
    };
  }

  test("ASCII text is counted without consulting the segmenter", async () => {
    const graphemes = await importWithCountingSegmenter();

    expect(graphemes.countGraphemes("Pretable says hello token-1234")).toBe(30);

    expect(graphemes.segmentCalls()).toBe(0);
  });

  test("ASCII text is segmented without consulting the segmenter", async () => {
    const graphemes = await importWithCountingSegmenter();

    expect(graphemes.segmentGraphemes("a b")).toEqual(["a", " ", "b"]);

    expect(graphemes.segmentCalls()).toBe(0);
  });

  test("non-ASCII text still goes to the segmenter", async () => {
    const graphemes = await importWithCountingSegmenter();

    // The positive twin of the two tests above: if the fast path swallowed
    // everything, they would pass for the wrong reason.
    expect(graphemes.countGraphemes("Pretableからこんにちは")).toBe(15);

    expect(graphemes.segmentCalls()).toBe(1);
  });

  test("CRLF is one grapheme cluster, so the fast path declines it", async () => {
    const graphemes = await importWithCountingSegmenter();

    // The only ASCII text whose grapheme count is not its code-unit length:
    // "a\r\nb" is 4 code units but 3 user-perceived characters.
    expect(graphemes.countGraphemes("a\r\nb")).toBe(3);
    expect(graphemes.segmentGraphemes("a\r\nb")).toEqual(["a", "\r\n", "b"]);

    expect(graphemes.segmentCalls()).toBe(2);
  });

  test("a lone carriage return is still one grapheme", () => {
    expect(countGraphemes("\r")).toBe(1);
    expect(segmentGraphemes("a\rb")).toEqual(["a", "\r", "b"]);
  });

  test("the fast path agrees with the segmenter across the ASCII range", () => {
    // Every ASCII code unit, one string, so no member of the range can take a
    // different path from its neighbours unnoticed. Built without CR, which
    // the case above covers separately.
    const ascii = Array.from({ length: 128 }, (_, code) =>
      code === 0x0d ? "" : String.fromCharCode(code),
    ).join("");

    expect(countGraphemes(ascii)).toBe(ascii.length);
    expect(segmentGraphemes(ascii)).toEqual(ascii.split(""));
  });

  test("mixed text takes the segmenter's answer, not the fast path's", () => {
    // One non-ASCII character anywhere must disqualify the WHOLE string: the
    // family emoji is 11 code units and 1 grapheme, so a length-based answer
    // would be 10 too many.
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    const mixed = `ok ${family}`;

    expect(mixed.length).toBe(14);
    expect(countGraphemes(mixed)).toBe(4);
  });
});

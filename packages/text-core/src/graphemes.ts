type GraphemeSegmenter = {
  segment(input: string): Iterable<{ segment: string }>;
};

// Constructing an `Intl.Segmenter` is expensive and `prepareText` runs on the
// estimate path, so the instance is built once and memoized at module scope.
// `undefined` means "not yet resolved"; `null` means "host has no Segmenter".
let cachedSegmenter: GraphemeSegmenter | null | undefined;

function resolveSegmenter(): GraphemeSegmenter | null {
  if (cachedSegmenter !== undefined) {
    return cachedSegmenter;
  }

  const ctor = (
    globalThis as {
      Intl?: { Segmenter?: typeof Intl.Segmenter };
    }
  ).Intl?.Segmenter;

  cachedSegmenter =
    typeof ctor === "function"
      ? (new ctor(undefined, { granularity: "grapheme" }) as GraphemeSegmenter)
      : null;

  return cachedSegmenter;
}

/**
 * Text that provably has one grapheme cluster per code unit, so the segmenter
 * can be skipped entirely.
 *
 * ASCII cannot form a multi-code-unit cluster: no surrogate pairs, no combining
 * marks, no ZWJ sequences, no regional indicators. CRLF is the sole exception —
 * Unicode joins it into a single cluster — so `\r` (U+000D) is excluded from
 * the range and any text containing one takes the slow path.
 *
 * This is not a micro-optimisation. `prepareText` runs per wrapped cell on the
 * estimate path, and segmentation was 97% of its cost: the S2 bench corpus
 * measured 105.31ms per pass, of which 102.09ms was this. It is also charged
 * twice per string — once for the whole text, once per token — which is why
 * skipping it where it cannot matter is worth a named constant.
 */
const ONE_CLUSTER_PER_CODE_UNIT = /^[\u0000-\u000C\u000E-\u007F]*$/;

/**
 * Splits text into user-perceived characters (extended grapheme clusters).
 *
 * Falls back to `Array.from` — code points — where `Intl.Segmenter` is
 * unavailable. That fallback is the pre-existing behaviour, so it is never
 * worse than what it replaces.
 */
export function segmentGraphemes(text: string): string[] {
  if (ONE_CLUSTER_PER_CODE_UNIT.test(text)) {
    return text.split("");
  }

  const segmenter = resolveSegmenter();

  if (segmenter === null) {
    return Array.from(text);
  }

  const graphemes: string[] = [];

  for (const { segment } of segmenter.segment(text)) {
    graphemes.push(segment);
  }

  return graphemes;
}

/**
 * Number of user-perceived characters in `text`.
 *
 * Counts by stepping the segmenter rather than by `segmentGraphemes(...).length`:
 * every caller of this wants a number, and materialising one string per
 * grapheme to read `.length` off the array allocated an object per character of
 * every token in the grid.
 */
export function countGraphemes(text: string): number {
  if (ONE_CLUSTER_PER_CODE_UNIT.test(text)) {
    return text.length;
  }

  const segmenter = resolveSegmenter();

  if (segmenter === null) {
    return Array.from(text).length;
  }

  // Stepped by hand rather than `for (const _ of ...)`: the loop binding would
  // be unused, which lint rejects.
  const graphemes = segmenter.segment(text)[Symbol.iterator]();
  let count = 0;

  while (graphemes.next().done !== true) {
    count += 1;
  }

  return count;
}

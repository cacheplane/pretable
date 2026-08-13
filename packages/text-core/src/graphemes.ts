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
 * Splits text into user-perceived characters (extended grapheme clusters).
 *
 * Falls back to `Array.from` — code points — where `Intl.Segmenter` is
 * unavailable. That fallback is the pre-existing behaviour, so it is never
 * worse than what it replaces.
 */
export function segmentGraphemes(text: string): string[] {
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

/** Number of user-perceived characters in `text`. */
export function countGraphemes(text: string): number {
  return segmentGraphemes(text).length;
}

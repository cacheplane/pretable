/**
 * Focus is declared inside the example source, not in metadata, so it travels
 * with the code through any edit. Markers are inert comments — the file still
 * compiles and runs as part of the live demo — and are removed here before the
 * source is displayed, copied, or serialized for an agent.
 *
 *   const x = 1;            // [!focus]
 *   // [!focus:start] ... // [!focus:end]
 */

const START = /^\s*(?:\/\/|\/\*)\s*\[!focus:start\]\s*(?:\*\/)?\s*$/;
const END = /^\s*(?:\/\/|\/\*)\s*\[!focus:end\]\s*(?:\*\/)?\s*$/;
const INLINE = /\s*(?:\/\/|\/\*)\s*\[!focus\]\s*(?:\*\/)?\s*$/;

export interface StripResult {
  source: string;
  /** 1-based line numbers in `source`. */
  focusLines: number[];
}

export function stripFocusMarkers(input: string): StripResult {
  const out: string[] = [];
  const focusLines: number[] = [];
  let open = false;

  for (const line of input.split("\n")) {
    if (START.test(line)) {
      if (open) {
        throw new Error(
          "Focus marker error: [!focus:start] inside an open region.",
        );
      }
      open = true;
      continue;
    }
    if (END.test(line)) {
      if (!open) {
        throw new Error(
          "Focus marker error: [!focus:end] without a matching [!focus:start].",
        );
      }
      open = false;
      continue;
    }
    const inline = INLINE.test(line);
    out.push(inline ? line.replace(INLINE, "") : line);
    if (inline || open) focusLines.push(out.length);
  }

  if (open) {
    throw new Error(
      "Focus marker error: [!focus:start] without a matching [!focus:end].",
    );
  }
  return { source: out.join("\n"), focusLines };
}

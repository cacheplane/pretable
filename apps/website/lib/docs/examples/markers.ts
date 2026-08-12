/**
 * Focus is declared inside the example source, not in metadata, so it travels
 * with the code through any edit. Markers are inert comments — the file still
 * compiles and runs as part of the live demo — and are removed here before the
 * source is displayed, copied, or serialized for an agent.
 *
 *   const x = 1;            // [!focus]
 *   // [!focus:start] ... // [!focus:end]
 */

const START =
  /^\s*(?:\/\/\s*\[!focus:start\]|\/\*\s*\[!focus:start\]\s*\*\/)\s*$/;
const END = /^\s*(?:\/\/\s*\[!focus:end\]|\/\*\s*\[!focus:end\]\s*\*\/)\s*$/;
const INLINE = /\s*(?:\/\/\s*\[!focus\]|\/\*\s*\[!focus\]\s*\*\/)\s*$/;

/**
 * Anything shaped like a focus marker that survived the checks above — a
 * marker with trailing content after it, a mismatched comment pair, or a
 * second marker left behind when only the last one on a line was stripped.
 * Matches `[!focus]`, `[!focus:start]`, `[!focus:end]`, etc.
 */
const RESIDUAL_MARKER = /\[!focus[\]:]/;

export interface StripResult {
  readonly source: string;
  /** 1-based line numbers in `source`. */
  readonly focusLines: readonly number[];
}

/**
 * Strips `[!focus]` markers from `input` and reports which lines they mark.
 *
 * Recognized forms:
 * - a trailing marker that ends its line, e.g. `code; // [!focus]` (or the
 *   block-comment equivalent, for languages without `//`)
 * - a region, `// [!focus:start]` … `// [!focus:end]` (or the block-comment
 *   equivalent) — every line between the two is focused, and the marker
 *   lines themselves are dropped from the output.
 *
 * A line that strips to nothing (a marker alone on its own line) is dropped
 * entirely, the same way a region's marker lines are — it would otherwise
 * leave a focused blank line behind. Input line endings are read as
 * `\r?\n`; the result always joins with `\n`.
 *
 * @returns `source` with markers removed, and `focusLines` — 1-based line
 *   numbers in `source` — for every focused line.
 * @throws {Error} If a `[!focus…]`-shaped marker doesn't match one of the
 *   recognized forms above (trailing content after it, or a mismatched
 *   comment pair), if `[!focus:end]` appears with no open region, if
 *   `[!focus:start]` appears while a region is already open, or if a region
 *   is left unclosed at the end of the input.
 */
export function stripFocusMarkers(input: string): StripResult {
  const out: string[] = [];
  const focusLines: number[] = [];
  let open = false;
  let openLine = -1;

  const lines = input.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (START.test(line)) {
      if (open) {
        throw new Error(
          `Focus marker error: [!focus:start] inside an open region. (line ${lineNumber})`,
        );
      }
      open = true;
      openLine = lineNumber;
      continue;
    }
    if (END.test(line)) {
      if (!open) {
        throw new Error(
          `Focus marker error: [!focus:end] without a matching [!focus:start]. (line ${lineNumber})`,
        );
      }
      open = false;
      continue;
    }

    const inline = INLINE.test(line);
    let text = line;
    if (inline) {
      text = line.replace(INLINE, "");
      if (text.trim() === "") {
        // The whole line was a focus marker; drop it, like a region marker.
        continue;
      }
    }

    if (RESIDUAL_MARKER.test(text)) {
      throw new Error(
        `Focus marker error: unrecognized "[!focus...]" on line ${lineNumber} — a marker must end its line ("code; // [!focus]") or stand alone as [!focus:start] / [!focus:end].`,
      );
    }

    out.push(text);
    if (inline || open) focusLines.push(out.length);
  }

  if (open) {
    throw new Error(
      `Focus marker error: [!focus:start] without a matching [!focus:end]. (line ${openLine})`,
    );
  }
  return { source: out.join("\n"), focusLines };
}

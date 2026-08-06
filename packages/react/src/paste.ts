/**
 * Pure, React-free clipboard-paste primitives: TSV parsing and paste geometry.
 * No DOM, no async, no validation — the surface layers those on top.
 */

/**
 * Parse clipboard text (`text/plain`, TSV flavor) into a matrix of raw cell strings.
 *
 * The exact inverse of `escapeTsvField` (`./copy`), which quotes a field **iff** it
 * contains TAB/CR/LF/`"` and doubles embedded quotes. Accordingly:
 *
 * - A field whose **first** character is `"` is a quoted field: it is read up to the
 *   closing quote, `""` collapses to a single `"`, and it may contain TAB, CR and LF.
 * - A `"` anywhere else is an ordinary character (`a"b` parses as `a"b`), because
 *   an escaped field never emits one there.
 * - `\r\n`, `\n` and `\r` all terminate a row.
 * - Exactly **one** trailing blank line is trimmed — Excel-on-Windows appends one.
 *   A second trailing blank line survives as an empty row.
 *
 * Ragged input is preserved: rows keep whatever field count they had.
 *
 * Known ambiguity: an empty string decodes to `[]`, not `[[""]]`. A matrix holding a
 * single empty field encodes to the empty string, so the two are indistinguishable,
 * and "no content" is by far the more useful reading of an empty clipboard.
 *
 * @public
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let fieldStart = true;
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
    fieldStart = true;
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (fieldStart && ch === '"') {
      inQuotes = true;
      fieldStart = false;
      i += 1;
      continue;
    }

    if (ch === "\t") {
      endField();
      i += 1;
      continue;
    }

    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }

    if (ch === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }

    field += ch;
    fieldStart = false;
    i += 1;
  }

  endRow();

  // Trim exactly one trailing blank line: the row a final terminator leaves behind.
  const last = rows[rows.length - 1];
  if (last && last.length === 1 && last[0] === "") rows.pop();

  return rows;
}

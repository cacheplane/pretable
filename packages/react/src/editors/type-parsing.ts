import type { ColumnOption, ColumnType } from "@pretable/core";
import { isValidDateValue } from "@pretable-internal/calendar-date";

import { matchOption } from "./enum-options";

export type DraftParseResult =
  { ok: true; value: unknown } | { ok: false; message: string };

/**
 * Built-in per-type draft parsing, run at commit before the column's
 * `validate`. `parseEditValue` on the column overrides this entirely.
 */
export function parseDraftForType(
  column: { type?: ColumnType; options?: ColumnOption[] },
  draft: unknown,
): DraftParseResult {
  switch (column.type) {
    case "number": {
      if (typeof draft === "number") return { ok: true, value: draft };
      const raw = String(draft ?? "").trim();
      if (raw === "") return { ok: true, value: null };
      const n = Number(raw);
      if (Number.isNaN(n)) return { ok: false, message: "Not a number" };
      return { ok: true, value: n };
    }
    case "enum": {
      const options = column.options ?? [];
      // An enum column without options behaves as a plain text column.
      if (options.length === 0) return { ok: true, value: draft };
      const raw = String(draft ?? "").trim();
      if (raw === "") return { ok: true, value: null };
      const match = matchOption(options, raw);
      return match
        ? { ok: true, value: match.value }
        : { ok: false, message: "Pick an option" };
    }
    case "date": {
      if (draft === "") return { ok: true, value: null };
      return isValidDateValue(draft)
        ? { ok: true, value: draft }
        : { ok: false, message: "Use YYYY-MM-DD" };
    }
    default:
      return { ok: true, value: draft };
  }
}

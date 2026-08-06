import type { ColumnOption, ColumnType } from "@pretable/core";

import { isValidIsoDate, toIsoDate } from "./date-utils";
import { matchOption } from "./enum-options";

export type DraftParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

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
      if (draft === null || draft === undefined || draft === "")
        return { ok: true, value: null };
      // A Date/timestamp draft (a cell value that never went through the
      // editor) normalises; typed text must be strict ISO.
      if (typeof draft !== "string") {
        const iso = toIsoDate(draft);
        return iso
          ? { ok: true, value: iso }
          : { ok: false, message: "Use YYYY-MM-DD" };
      }
      const raw = draft.trim();
      if (raw === "") return { ok: true, value: null };
      return isValidIsoDate(raw)
        ? { ok: true, value: raw }
        : { ok: false, message: "Use YYYY-MM-DD" };
    }
    default:
      return { ok: true, value: draft };
  }
}

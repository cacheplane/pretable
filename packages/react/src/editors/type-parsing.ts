import type { ColumnType } from "@pretable/core";

export type DraftParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/**
 * Built-in per-type draft parsing, run at commit before the column's
 * `validate`. `parseEditValue` on the column overrides this entirely.
 * Enum strictness and date validity join here in sub-projects 2/3.
 */
export function parseDraftForType(
  column: { type?: ColumnType },
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
    default:
      return { ok: true, value: draft };
  }
}

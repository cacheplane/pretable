/**
 * Group identity — ids are derived from the full group path so they are stable
 * across recomputes (expand state, focus and selection are all id-addressed).
 *
 * Shape: `__group__:<colId>=<key>/<colId>=<key>…`, outermost level first.
 *
 * `/`, `=` and `%` are percent-escaped in both the column id and the key, so a
 * value containing a separator can never be mistaken for a level boundary.
 * (ag-grid joins with a raw `-`, which is ambiguous; this is the fix.)
 */

/** Prefix that marks a flat-row-list entry as a group row. */
export const GROUP_ID_PREFIX = "__group__:";

const LEVEL_SEPARATOR = "/";
const KEY_SEPARATOR = "=";

/**
 * Percent-escape the characters that carry structural meaning in a group id.
 * `%` must be escaped first, otherwise a literal `"%2F"` in the data would
 * decode back to a separator.
 *
 * @internal
 */
export function escapeGroupKey(raw: string): string {
  return raw.replace(/%/g, "%25").replace(/\//g, "%2F").replace(/=/g, "%3D");
}

/** Inverse of {@link escapeGroupKey}. @internal */
export function unescapeGroupKey(escaped: string): string {
  return escaped.replace(/%(25|2F|3D)/g, (_match, code: string) => {
    if (code === "2F") return "/";
    if (code === "3D") return "=";
    return "%";
  });
}

/**
 * Canonical string form of a group key. Type-tagged so that values which merely
 * stringify alike (`1` vs `"1"`, `null` vs `"null"`) land in distinct groups
 * with distinct ids instead of silently colliding.
 *
 * `null` and `undefined` deliberately share one key: a column with missing
 * values forms a single blank group.
 *
 * @internal
 */
export function stringifyGroupValue(value: unknown): string {
  if (value === null || value === undefined) return "~";

  switch (typeof value) {
    case "string":
      return `s:${value}`;
    case "number":
      return `n:${value}`;
    case "boolean":
      return `b:${value}`;
    case "bigint":
      return `i:${value}`;
    default:
      return `o:${safeToString(value)}`;
  }
}

function safeToString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unstringifiable]";
  }
}

/** One level of a group path. @internal */
export interface GroupPathSegment {
  columnId: string;
  value: unknown;
}

/**
 * Build the stable id for a group at the given path (outermost level first).
 *
 * @internal
 */
export function makeGroupId(path: readonly GroupPathSegment[]): string {
  let id = GROUP_ID_PREFIX;

  for (let i = 0; i < path.length; i += 1) {
    if (i > 0) id += LEVEL_SEPARATOR;
    id += escapeGroupKey(path[i].columnId);
    id += KEY_SEPARATOR;
    id += escapeGroupKey(stringifyGroupValue(path[i].value));
  }

  return id;
}

/** True when a flat-row-list id addresses a group row. @internal */
export function isGroupId(id: string): boolean {
  return id.startsWith(GROUP_ID_PREFIX);
}

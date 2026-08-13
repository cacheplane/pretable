/**
 * Delivering a serialized file to the user's disk.
 *
 * **No top-level browser access, on purpose.** Every `document` /
 * `URL.createObjectURL` reference below lives inside a function body, so this
 * module is safe to import from a server graph. That is the whole requirement:
 * `"use client"` would NOT save it — a client module still executes during SSR,
 * Next's own docs are explicit that a Client Component "runs on the server
 * alongside its browser render" — and `client-only` would not either, since it
 * guards the RSC graph and resolves to an empty module during SSR.
 *
 * The same rule bans a module-scope capability probe. A
 * `const CAN_SAVE = typeof window !== "undefined" && ...` evaluates safely and
 * then differs between the server pass and the browser pass, which is a
 * hydration mismatch the moment it reaches render.
 */
import type { PretableCsvFile } from "./csv";

/**
 * `text/csv` with an explicit charset, and the extension must agree with it.
 *
 * The HTML spec instructs the UA to "alter filename to add an extension
 * corresponding to claimed type" when the Blob's type and the `download` name
 * disagree — which is the documented Safari complaint about `.txt` being
 * appended. Keeping the pair consistent makes that step a no-op.
 *
 * Explicitly NOT `application/octet-stream`, the usual instinct for "force a
 * download": Chromium special-cases it to map to *no* extension, so it yields
 * an extensionless file rather than a more forceful download. AG Grid ships
 * `text/plain` here, which is the same class of mismatch waiting to surface.
 */
const CSV_MIME = "text/csv;charset=utf-8";

/**
 * Windows forbids these anywhere in a name; macOS and Linux permit most of
 * them, but Chromium replaces the whole set with `_` on EVERY platform before
 * the file reaches disk. Sanitizing here rather than letting it happen is the
 * difference between a name we chose and a name we discovered.
 */
const ILLEGAL = /[<>:"/\\|?*\s\x00-\x1f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Reserved device names on Windows, which are reserved in every directory and
 * remain reserved with an extension — `CON.csv` is still `CON`.
 *
 * Chromium's own list is larger than Microsoft's and prefixes matches with `_`.
 * Doing it here keeps the name predictable across platforms.
 */
const RESERVED =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|clock\$|conin\$|conout\$|desktop\.ini|thumbs\.db)$/i;

/**
 * Bytes, not characters. Every mainstream filesystem caps a path component at
 * 255 BYTES, so slicing UTF-16 code units overshoots on any non-ASCII name —
 * 200 `é` is 400 bytes — and can leave a lone surrogate at the cut.
 */
const MAX_STEM_BYTES = 180;

/** Truncate to a byte budget without splitting a code point. */
function clampBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;

  let out = "";
  let used = 0;
  // Iterating the string yields whole code points, so a surrogate pair is
  // never split — the failure `slice()` produces on an emoji.
  for (const ch of text) {
    const size = encoder.encode(ch).length;
    if (used + size > maxBytes) break;
    out += ch;
    used += size;
  }
  return out;
}

/** Pad to two digits without pulling in a formatter. */
const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * ISO 8601 basic format, UTC: `20260813T140530Z`.
 *
 * The separators are removed rather than kept because **Chromium replaces `:`
 * with `_` on every OS, including Linux** — a raw `toISOString()` does not
 * survive as written anywhere, so passing colons only cedes control of the
 * result. Big-endian and zero-padded so byte order equals time order, which is
 * the property RFC 3339 §5.1 names.
 */
export function exportTimestamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * Input for {@link buildExportFileName}.
 *
 * @public
 */
export interface BuildExportFileNameArgs {
  /** Base name. Sanitized, never trusted. */
  name: string;
  /** Stamped into the name. Passed in so the result is testable. */
  date: Date;
  /**
   * When `false`, the name carries a `-PARTIAL` marker.
   *
   * This is where the incompleteness signal lives, because the file itself
   * cannot carry it: RFC 4180 has no comment syntax, so a marker row would be a
   * data row. A filename travels with the artifact when it is emailed onward,
   * is legible without being parsed, and costs the bytes nothing.
   */
  complete?: boolean;
  extension?: string;
}

/** True for the characters `sanitizeStem` trims from either end. */
function isTrimmable(ch: string): boolean {
  return ch === "." || ch === "-";
}

/**
 * Trim leading and trailing dots and hyphens in linear time.
 *
 * A hand-rolled scan rather than a regex, because the obvious end-anchored form
 * (`/[.\s-]+$/`) backtracks polynomially on adversarial input.
 */
function trimDotsAndSpace(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isTrimmable(text[start] as string)) start += 1;
  while (end > start && isTrimmable(text[end - 1] as string)) end -= 1;
  return text.slice(start, end);
}

/**
 * Reduce arbitrary caller text to a filename component that lands on disk
 * unchanged on Windows, macOS and Linux alike.
 *
 * Shared by {@link buildExportFileName} and by `defaultSaveFile`'s `fileName`
 * escape hatch, because a caller-supplied name is exactly the input that should
 * not be trusted — and an earlier version documented that it was sanitized
 * while passing it straight to the anchor.
 *
 * @internal
 */
export function sanitizeStem(name: string): string {
  // Chromium strips a leading dot entirely (no accidental hidden files) and
  // turns trailing dots and spaces into underscores on Windows while removing
  // them on POSIX — a real cross-OS divergence. Normalizing here makes the name
  // the same everywhere. Path traversal cannot survive either: `/` and `\` are
  // already gone by this point.
  //
  // The trim is a SCAN, not `/^[.\s]+/` + `/[.\s]+$/`. Those backtrack
  // polynomially on caller-controlled input — an end-anchored `[.\s]+$`
  // re-scans to the end from every start position, so a name of N tabs costs
  // O(N²). Measured before the fix: 20k tabs 1.4s, 40k 5.3s, 80k 12s. A
  // filename derived from a user-entered report title is enough to freeze the
  // tab, which is why CodeQL flags it as ReDoS.
  let stem = trimDotsAndSpace(name.replace(ILLEGAL, "-"))
    .replace(/-{2,}/g, "-")
    // Collapse dot runs too — inert for traversal, but needless ambiguity for
    // anything that later parses the name.
    .replace(/\.{2,}/g, ".");

  if (stem === "" || RESERVED.test(stem)) {
    // A name that sanitizes to nothing, or collides with a device name, gets a
    // deterministic stand-in rather than whatever the browser would have chosen.
    stem = stem === "" ? "export" : `_${stem}`;
  }

  return clampBytes(stem, MAX_STEM_BYTES);
}

/**
 * Build a download filename that survives every filesystem unchanged.
 *
 * Pure, and deliberately so — everything Chromium would otherwise do to a name
 * is lossy, silent, and differs by OS.
 *
 * @public
 */
export function buildExportFileName({
  name,
  date,
  complete = true,
  extension = "csv",
}: BuildExportFileNameArgs): string {
  const stem = sanitizeStem(name);
  const suffix = complete ? "" : "-PARTIAL";
  const stamped = `${stem}-${exportTimestamp(date)}${suffix}`;
  const ext = extension.startsWith(".") ? extension : `.${extension}`;

  // Unconditional. An earlier version guarded this with an endsWith() check
  // described as "idempotent", which was dead code: `stamped` always ends in
  // the timestamp's `Z` or in `-PARTIAL`, so it can never already carry the
  // extension. Idempotency happens earlier — a caller passing "report.csv"
  // gets the ".csv" folded into the stem by the sanitizer, not appended twice.
  return `${stamped}${ext}`;
}

/**
 * Options for {@link defaultSaveFile}.
 *
 * @public
 */
export interface SaveFileOptions {
  /**
   * Base name for the file, before the timestamp and extension. Sanitized.
   *
   * Use this rather than `fileName` unless you genuinely need to bypass
   * stamping — it is the only way to get `invoices-<stamp>.csv` without
   * reimplementing the stamping and losing sanitization with it.
   */
  name?: string;
  /**
   * Replaces the generated name outright, INCLUDING the timestamp and the
   * completeness marker.
   *
   * It is still sanitized: an earlier version documented that and did not do
   * it, so `"../../CON:evil"` reached the anchor verbatim. A caller-supplied
   * name is exactly the input that should not be trusted.
   */
  fileName?: string;
  /** Injected in tests; defaults to `new Date()` at call time. */
  now?: Date;
}

/**
 * Turn a serialized CSV into a Blob.
 *
 * Separate from the download so callers can upload it, hand it to a worker, or
 * assert on its bytes. Handsontable's `exportAsBlob` is the precedent, and both
 * AG Grid and MUI ship a string-returning equivalent for the same reason.
 *
 * @public
 */
export function toCsvBlob(file: PretableCsvFile): Blob {
  // A single string, which caps this at V8's ~536M-character limit — about 1.29
  // million rows for a 20-column shape, 13x the 100k the benchmarks target.
  //
  // Building Blob parts incrementally during serialization would remove the
  // ceiling entirely and, in the research benchmark, used 63MB peak against
  // 90MB for the array-join this ships. Those numbers describe the option that
  // was NOT built — this code is the 90MB row — and are recorded so the
  // trade-off is legible, not as a measurement of what is here.
  return new Blob([file.text], { type: CSV_MIME });
}

/**
 * Save a serialized CSV to the user's disk.
 *
 * Blob + `URL.createObjectURL` + a synthetic `<a download>` click. Chosen over
 * `showSaveFilePicker` for one decisive reason: **`<a download>` has no user-
 * activation requirement**, so it still works after an `await`, while
 * `showSaveFilePicker` is transient-activation-gated and throws `SecurityError`
 * once any asynchronous work has happened. Chrome's own guidance is to open the
 * picker *before* doing the work — which would make the user name a file before
 * knowing whether the export succeeded. It is also ~27% of users, desktop
 * Chromium only, and untestable, since Playwright cannot drive a native dialog.
 *
 * @public
 */
export function defaultSaveFile(
  file: PretableCsvFile,
  options: SaveFileOptions = {},
): void {
  const blob = toCsvBlob(file);
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = options.fileName
    ? sanitizeStem(options.fileName)
    : buildExportFileName({
        name: options.name ?? "export",
        date: options.now ?? new Date(),
        complete: file.complete,
      });
  anchor.style.display = "none";

  // Appended before clicking: Firefox historically required the anchor to be in
  // the document for `.click()` to dispatch, and it costs nothing.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Deferred, not immediate. Revoking synchronously after `click()` is
  // spec-correct — URL parsing copies the blob — but it broke downloads in
  // Firefox for long enough that the ecosystem does not trust it (FileSaver.js
  // waits 40s). The cost of waiting is one timer; the cost of being wrong is a
  // silently missing file. Leaked URLs are bounded by page lifetime anyway,
  // since the File API revokes them on unload.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

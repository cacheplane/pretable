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
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Reserved device names on Windows, which are reserved in every directory and
 * remain reserved with an extension — `CON.csv` is still `CON`.
 *
 * Chromium's own list is larger than Microsoft's and prefixes matches with `_`.
 * Doing it here keeps the name predictable across platforms.
 */
const RESERVED =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|clock\$|conin\$|conout\$|desktop\.ini|thumbs\.db)$/i;

/** Leaves headroom under the 255-byte component limit on every filesystem. */
const MAX_STEM = 180;

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
  let stem = name
    .replace(ILLEGAL, "-")
    // Chromium strips a leading dot entirely (no accidental hidden files) and
    // turns trailing dots and spaces into underscores on Windows while removing
    // them on POSIX — a real cross-OS divergence. Removing them here makes the
    // name the same everywhere.
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .replace(/-{2,}/g, "-");

  if (stem === "" || RESERVED.test(stem)) {
    // A name that sanitizes to nothing, or collides with a device name, gets a
    // deterministic stand-in rather than whatever the browser would have chosen.
    stem = stem === "" ? "export" : `_${stem}`;
  }

  if (stem.length > MAX_STEM) stem = stem.slice(0, MAX_STEM);

  const suffix = complete ? "" : "-PARTIAL";
  const stamped = `${stem}-${exportTimestamp(date)}${suffix}`;
  const ext = extension.startsWith(".") ? extension : `.${extension}`;

  // Idempotent: a caller passing "report.csv" gets one extension, not two.
  return stamped.toLowerCase().endsWith(ext.toLowerCase())
    ? stamped
    : `${stamped}${ext}`;
}

/**
 * Options for {@link defaultSaveFile}.
 *
 * @public
 */
export interface SaveFileOptions {
  /** Overrides the generated name entirely. Still passed through sanitization. */
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
  // Building Blob parts incrementally during serialization would remove the
  // ceiling entirely and cut peak memory ~40% (measured: 63MB vs 90MB at 100k),
  // and is the right change if anyone ever exports past a million rows. It is
  // not worth the API contortion before then.
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
  anchor.download =
    options.fileName ??
    buildExportFileName({
      name: "export",
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

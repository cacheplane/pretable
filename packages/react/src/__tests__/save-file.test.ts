import { afterEach, describe, expect, it, vi } from "vitest";

import type { PretableCsvFile } from "../csv";
import {
  buildExportFileName,
  defaultSaveFile,
  exportTimestamp,
  toCsvBlob,
} from "../save-file";

const AT = new Date(Date.UTC(2026, 7, 13, 14, 5, 30));

function file(overrides: Partial<PretableCsvFile> = {}): PretableCsvFile {
  return {
    text: "A,B\r\n1,2",
    rowCount: 1,
    scope: "all",
    complete: true,
    ...overrides,
  };
}

describe("exportTimestamp", () => {
  it("is ISO 8601 basic format in UTC, with no colons", () => {
    // Colons are not merely a Windows problem: Chromium replaces `:` with `_`
    // on every OS, so a raw toISOString() does not survive as written anywhere.
    expect(exportTimestamp(AT)).toBe("20260813T140530Z");
    expect(exportTimestamp(AT)).not.toContain(":");
  });

  it("zero-pads so byte order equals time order", () => {
    expect(exportTimestamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe(
      "20260102T030405Z",
    );
  });
});

describe("buildExportFileName", () => {
  it("stamps the name and appends the extension", () => {
    expect(buildExportFileName({ name: "report", date: AT })).toBe(
      "report-20260813T140530Z.csv",
    );
  });

  it("replaces characters that are illegal on any platform", () => {
    expect(
      buildExportFileName({ name: 'a/b\\c:d*e?f"g<h>i|j', date: AT }),
    ).toBe("a-b-c-d-e-f-g-h-i-j-20260813T140530Z.csv");
  });

  it("strips a leading dot so the file is never hidden", () => {
    expect(buildExportFileName({ name: ".hidden", date: AT })).toBe(
      "hidden-20260813T140530Z.csv",
    );
  });

  it("strips trailing dots and spaces", () => {
    // Windows silently drops them, so a name kept as-is would not be the name
    // on disk. POSIX keeps them, which is the divergence being closed.
    expect(buildExportFileName({ name: "report. ", date: AT })).toBe(
      "report-20260813T140530Z.csv",
    );
  });

  it("prefixes a Windows reserved device name", () => {
    // CON.csv is still CON.
    expect(buildExportFileName({ name: "CON", date: AT })).toBe(
      "_CON-20260813T140530Z.csv",
    );
    expect(buildExportFileName({ name: "lpt9", date: AT })).toBe(
      "_lpt9-20260813T140530Z.csv",
    );
  });

  it("falls back to a deterministic stem when the name sanitizes to nothing", () => {
    expect(buildExportFileName({ name: "...", date: AT })).toBe(
      "export-20260813T140530Z.csv",
    );
  });

  it("does not double the extension", () => {
    expect(buildExportFileName({ name: "report", date: AT })).toMatch(/\.csv$/);
    expect(
      buildExportFileName({
        name: "report",
        date: AT,
        extension: ".csv",
      }).match(/\.csv/g),
    ).toHaveLength(1);
  });

  it("caps the stem so the whole name stays under the 255-byte limit", () => {
    const name = buildExportFileName({ name: "x".repeat(500), date: AT });
    expect(name.length).toBeLessThan(255);
  });

  it("marks an INCOMPLETE export in the filename", () => {
    // The signal cannot live in the file: RFC 4180 has no comment syntax, so a
    // marker row is a data row. A filename travels with the artifact when it is
    // emailed onward and costs the bytes nothing.
    expect(
      buildExportFileName({ name: "report", date: AT, complete: false }),
    ).toBe("report-20260813T140530Z-PARTIAL.csv");
  });

  it("does not mark a complete export", () => {
    expect(
      buildExportFileName({ name: "report", date: AT, complete: true }),
    ).not.toContain("PARTIAL");
  });
});

describe("toCsvBlob", () => {
  it("carries the CSV bytes", async () => {
    // Asserted on the Blob we hold — NEVER on anything recovered from an object
    // URL. In jsdom, createObjectURL exists and appears to work, but jsdom's
    // Blob is not Node's, so the store holds the string "undefined" while the
    // MIME type survives. A round-trip assertion there can pass against
    // garbage; an assertion that survives the bytes becoming "undefined" is not
    // an assertion.
    const blob = toCsvBlob(file({ text: 'a,"b,c"\r\n1,2' }));
    await expect(blob.text()).resolves.toBe('a,"b,c"\r\n1,2');
  });

  it("declares text/csv with a charset, matching the .csv extension", () => {
    // A mismatch is something the HTML spec tells the UA to "fix" by appending
    // an extension — the documented Safari .txt complaint. Never
    // application/octet-stream: Chromium maps it to NO extension.
    expect(toCsvBlob(file()).type).toBe("text/csv;charset=utf-8");
  });
});

const fileFixture = file;

/** Stubs URL.* and returns the array that collects revoked urls. */
function stubObjectUrlFor(onCreate: (blob: Blob) => void): string[] {
  const revokedUrls: string[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: (b: Blob) => {
      onCreate(b);
      return "blob:stub";
    },
    revokeObjectURL: (u: string) => revokedUrls.push(u),
  });
  return revokedUrls;
}

afterEach(() => {
  // restoreAllMocks does NOT undo stubGlobal; only unstubAllGlobals does.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("defaultSaveFile", () => {
  const created: string[] = [];
  const revoked: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    created.length = 0;
    revoked.length = 0;
  });

  function stubObjectUrl() {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (b: Blob) => {
        created.push(b.type);
        return "blob:stub";
      },
      revokeObjectURL: (u: string) => revoked.push(u),
    });
  }

  it("clicks a download anchor and cleans it up", () => {
    stubObjectUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");

    defaultSaveFile(file(), { fileName: "x.csv", now: AT });

    expect(click).toHaveBeenCalledOnce();
    // Removed again: the anchor is an implementation detail, not a mutation.
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("names the file from the export's completeness", () => {
    stubObjectUrl();
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });

    defaultSaveFile(file({ complete: false, scope: "loaded" }), { now: AT });

    expect(downloadName).toBe("export-20260813T140530Z-PARTIAL.csv");
  });

  it("defers revoking the object URL", () => {
    vi.useFakeTimers();
    stubObjectUrl();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    defaultSaveFile(file(), { fileName: "x.csv", now: AT });

    // Revoking synchronously after click() broke downloads in Firefox for long
    // enough that the ecosystem stopped trusting it. The cost of waiting is a
    // timer; the cost of being wrong is a silently missing file.
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual(["blob:stub"]);
    vi.useRealTimers();
  });
});

describe("save-file gaps found in review", () => {
  it("caps the stem in BYTES, without splitting a code point", () => {
    // 200 "é" is 400 bytes: a UTF-16 slice overshoots the 255-byte component
    // limit on ext4/APFS, and slicing an emoji leaves a lone surrogate.
    const accented = buildExportFileName({ name: "é".repeat(200), date: AT });
    expect(new TextEncoder().encode(accented).length).toBeLessThan(255);

    const emoji = buildExportFileName({ name: "😀".repeat(200), date: AT });
    expect(new TextEncoder().encode(emoji).length).toBeLessThan(255);
    // A lone surrogate would round-trip through the replacement character.
    expect(emoji).not.toContain("�");
    expect([...emoji].every((ch) => ch.codePointAt(0)! !== 0xd83d)).toBe(true);
  });

  it("strips bidi overrides, which disguise an extension", () => {
    // U+202E renders "invoice<RLO>fdp.exe" as "invoiceexe.pdf" in Finder and
    // Explorer. A blocklist that strips C0 controls but leaves these is
    // inconsistent with a name documented as never trusted.
    const name = buildExportFileName({
      name: "invoice‮fdp.exe",
      date: AT,
    });
    expect(name).not.toContain("‮");
  });

  it("collapses runs of replaced characters", () => {
    expect(buildExportFileName({ name: "a///b", date: AT })).toBe(
      "a-b-20260813T140530Z.csv",
    );
  });

  it("appends the anchor to the document before clicking it", () => {
    // Firefox historically would not dispatch .click() on a detached anchor.
    stubObjectUrlFor(() => {});
    let wasConnected = false;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      wasConnected = this.isConnected;
    });

    defaultSaveFile(fileFixture(), { fileName: "x", now: AT });

    expect(wasConnected).toBe(true);
  });

  it("holds the object URL well past the click", () => {
    // Pins the deferral as a real duration, not merely "eventually". A revoke
    // at 1ms would satisfy an assertion that only advances the full 60s.
    vi.useFakeTimers();
    const revokedUrls = stubObjectUrlFor(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    defaultSaveFile(fileFixture(), { fileName: "x", now: AT });

    vi.advanceTimersByTime(10_000);
    expect(revokedUrls).toEqual([]);
    vi.advanceTimersByTime(50_000);
    expect(revokedUrls).toEqual(["blob:stub"]);
    vi.useRealTimers();
  });

  it("sanitizes a caller-supplied fileName", () => {
    // Documented as sanitized and previously was not: "../../CON:evil" reached
    // the anchor verbatim.
    stubObjectUrlFor(() => {});
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });

    defaultSaveFile(fileFixture(), { fileName: "../../CON:evil\\x", now: AT });

    expect(downloadName).not.toContain("..");
    expect(downloadName).not.toContain("/");
    expect(downloadName).not.toContain(":");
  });

  it("stamps a caller-supplied base name", () => {
    stubObjectUrlFor(() => {});
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });

    defaultSaveFile(fileFixture(), { name: "invoices", now: AT });

    expect(downloadName).toBe("invoices-20260813T140530Z.csv");
  });
});

describe("sanitizeStem is linear, not polynomial", () => {
  it("sanitizes a pathological name in linear time", () => {
    // SPACES, not tabs: `ILLEGAL` already replaces tabs (they are in the
    // \x00-\x1f range), so they never reach the trim. A space is matched by
    // `\s` and is legal in a filename, which makes it the reachable vector —
    // getting that wrong made a first version of this test pass against the
    // unfixed code for the wrong reason.
    //
    // Asserted on elapsed time rather than by simply calling it, because a
    // synchronous ReDoS BLOCKS the thread: vitest's own per-test timeout never
    // fires, so the previous version of this test hung the runner instead of
    // failing. The margin is ~4 orders of magnitude — the scan is microseconds,
    // the old `/[.\s]+$/` took 2.8s on this input — so the bound is not a
    // load-sensitive micro-benchmark.
    // The shape matters, and two earlier versions of this test got it wrong.
    // Leading spaces are cheap (the start-anchored trim removes them in one
    // pass) and trailing spaces are cheap (they match at once). The quadratic
    // case is whitespace in the MIDDLE followed by a non-space, because the
    // end-anchored `/[.\s]+$/` then re-scans to the end from every position.
    // That is an ordinary user-entered title: "Report<many spaces>final".
    //
    // Tabs are also wrong here: `ILLEGAL` replaces them before the trim runs.
    const hostile = "Report" + " ".repeat(40_000) + "final";

    const started = performance.now();
    const name = buildExportFileName({ name: hostile, date: AT });
    const elapsed = performance.now() - started;

    expect(name).toBe("Report-final-20260813T140530Z.csv");
    expect(elapsed).toBeLessThan(500);
  });
});

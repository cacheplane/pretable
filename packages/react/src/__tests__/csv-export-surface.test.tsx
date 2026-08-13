import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROW_SELECT_COLUMN_ID } from "../constants";
import type { PretableCsvFile, SerializeCsvArgs } from "../csv";
import { PretableSurface } from "../pretable-surface";
import type {
  PretableSurfaceGrid,
  PretableSurfaceSharedProps,
} from "../pretable-surface";
import type { PretableColumn } from "../types";

/**
 * The surface half of CSV export: `grid.exportCsv()`.
 *
 * `csv.ts` and `save-file.ts` are covered by their own unit tests — this file
 * only asserts the wiring those two cannot see: that the columns handed to the
 * serializer are the DRAWN ones, that the scope really is `resolveDataScope`'s
 * answer, that `onlySelected` resolves against the live selection, and that a
 * partial file is spoken aloud rather than left to a filename nobody hears.
 */

afterEach(cleanup);

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  qty: number;
  region: string;
}

const ROWS: Row[] = [
  { id: "r1", name: "Alpha", qty: 1, region: "east" },
  { id: "r2", name: "Bravo", qty: 2, region: "west" },
  { id: "r3", name: "Charlie", qty: 3, region: "east" },
];

const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Name", value: (row) => row.name },
  { id: "qty", header: "Qty", value: (row) => row.qty },
  { id: "region", header: "Region", value: (row) => row.region },
];

type Grid = PretableSurfaceGrid<Row, string, readonly PretableColumn<Row>[]>;

type MountProps = Partial<
  PretableSurfaceSharedProps<Row, string, readonly PretableColumn<Row>[]>
>;

function mount(props: MountProps = {}) {
  let captured: Grid | null = null;
  const view = render(
    <PretableSurface<Row>
      ariaLabel="csv export"
      columns={COLUMNS}
      getRowId={(row) => row.id}
      onGridReady={(ready) => {
        captured = ready;
      }}
      rows={ROWS}
      viewportHeight={300}
      {...props}
    />,
  );

  return {
    view,
    grid: () => captured as unknown as Grid,
    exportCsv: (options?: Parameters<Grid["exportCsv"]>[0]) => {
      act(() => {
        (captured as unknown as Grid).exportCsv(options);
      });
    },
  };
}

/** The saved file's lines, with the UTF-8 BOM and CRLF grammar taken off. */
function lines(file: PretableCsvFile): string[] {
  return file.text.replace(/^﻿/, "").split("\r\n");
}

function saved(saveFile: ReturnType<typeof vi.fn>): PretableCsvFile {
  expect(saveFile).toHaveBeenCalledTimes(1);
  return saveFile.mock.calls[0]![0] as PretableCsvFile;
}

function rowCheckbox(container: HTMLElement, rowId: string): HTMLElement {
  const box = container.querySelector(
    `[data-pretable-row-id="${rowId}"] button[data-pretable-row-select]`,
  );
  if (!box) throw new Error(`no checkbox for row ${rowId}`);
  return box as HTMLElement;
}

describe("grid.exportCsv column order", () => {
  it("exports the drawn order after a reorder, not the declaration order", () => {
    const saveFile = vi.fn();
    const harness = mount({ saveFile });

    act(() => harness.grid().setColumnOrder(["region", "name", "qty"]));
    harness.exportCsv();

    const text = lines(saved(saveFile));
    // Declaration order is Name,Qty,Region. The file must follow the screen.
    expect(text[0]).toBe("Region,Name,Qty");
    expect(text[1]).toBe("east,Alpha,1");
  });

  it("exports the drawn order after a pin, not the declaration order", () => {
    const saveFile = vi.fn();
    const harness = mount({ saveFile });

    act(() => harness.grid().setColumnPinned("region", "left"));
    harness.exportCsv();

    expect(lines(saved(saveFile))[0]).toBe("Region,Name,Qty");
  });

  it("leaves the row-select column out of the file", () => {
    const saveFile = vi.fn();
    const harness = mount({
      saveFile,
      rowSelectionColumn: { enabled: true },
    });

    harness.exportCsv();

    const header = lines(saved(saveFile))[0]!;
    expect(header).toBe("Name,Qty,Region");
    expect(header).not.toContain(ROW_SELECT_COLUMN_ID);
  });
});

describe("grid.exportCsv onlySelected", () => {
  it("exports only the checked rows", () => {
    const saveFile = vi.fn();
    const harness = mount({
      saveFile,
      rowSelectionColumn: { enabled: true },
    });

    fireEvent.click(rowCheckbox(harness.view.container, "r2"));
    fireEvent.click(rowCheckbox(harness.view.container, "r3"));
    harness.exportCsv({ onlySelected: true });

    const file = saved(saveFile);
    expect(lines(file)).toEqual([
      "Name,Qty,Region",
      "Bravo,2,west",
      "Charlie,3,east",
    ]);
    expect(file.rowCount).toBe(2);
  });

  it("exports everything when the selection is empty", () => {
    const saveFile = vi.fn();
    const harness = mount({
      saveFile,
      rowSelectionColumn: { enabled: true },
    });

    // Nothing ticked. A zero-row download is indistinguishable from a broken
    // button, so the request degrades to the whole grid rather than to nothing.
    harness.exportCsv({ onlySelected: true });

    expect(saved(saveFile).rowCount).toBe(3);
  });

  it("exports everything when onlySelected is omitted, even with a selection", () => {
    const saveFile = vi.fn();
    const harness = mount({
      saveFile,
      rowSelectionColumn: { enabled: true },
    });

    fireEvent.click(rowCheckbox(harness.view.container, "r2"));
    harness.exportCsv();

    expect(saved(saveFile).rowCount).toBe(3);
  });
});

describe("grid.exportCsv delivery", () => {
  it("hands saveFile the file serializeCsv produced", () => {
    const saveFile = vi.fn();
    const harness = mount({ saveFile });

    harness.exportCsv();

    const file = saved(saveFile);
    expect(lines(file)).toEqual([
      "Name,Qty,Region",
      "Alpha,1,east",
      "Bravo,2,west",
      "Charlie,3,east",
    ]);
    // The BOM the default options ask for really is on the bytes.
    expect(file.text.startsWith("﻿")).toBe(true);
    expect(file).toMatchObject({
      rowCount: 3,
      scope: "all",
      omissions: [],
      complete: true,
    });
  });

  it("hands saveFile the very object onExport returned", () => {
    const replacement: PretableCsvFile = {
      text: "substituted",
      rowCount: 7,
      scope: "all",
      omissions: [],
      complete: true,
    };
    const saveFile = vi.fn();
    const harness = mount({ saveFile, onExport: () => replacement });

    harness.exportCsv();

    expect(saved(saveFile)).toBe(replacement);
  });

  it("passes onExport the drawn columns and the resolved scope", () => {
    const seen: SerializeCsvArgs<
      Row,
      string,
      readonly PretableColumn<Row>[]
    >[] = [];
    const harness = mount({
      onExport: (args) => {
        seen.push(args);
        return null;
      },
      saveFile: vi.fn(),
    });

    act(() => harness.grid().setColumnOrder(["qty", "region", "name"]));
    harness.exportCsv();

    const args = seen[0]!;
    expect(args.columns.map((column) => column.id)).toEqual([
      "qty",
      "region",
      "name",
    ]);
    expect(args.scope).toBe("all");
  });

  it("cancels with no download when onExport returns null", () => {
    const saveFile = vi.fn();
    const harness = mount({ saveFile, onExport: () => null });

    harness.exportCsv();

    expect(saveFile).not.toHaveBeenCalled();
  });

  it("reports a window as loaded rather than as the whole population", () => {
    const saveFile = vi.fn();
    const harness = mount({
      saveFile,
      processing: { filter: "external", sort: "external" },
      resultMeta: { total: { kind: "exact", count: 100 } },
    });

    harness.exportCsv();

    const file = saved(saveFile);
    expect(file.scope).toBe("loaded");
    expect(file.omissions).toEqual([
      { kind: "unloaded-rows", scope: "loaded" },
    ]);
    expect(file.complete).toBe(false);
  });
});

describe("grid.exportCsv option merging", () => {
  it("merges surface csvOptions under the per-call options", () => {
    const saveFile = vi.fn();
    const harness = mount({
      saveFile,
      csvOptions: { delimiter: ";", includeHeaders: false, bom: false },
    });

    harness.exportCsv({ includeHeaders: true });

    // The per-call `includeHeaders` wins; the surface's `delimiter` and `bom`
    // survive a call that never mentioned them.
    const file = saved(saveFile);
    expect(file.text.startsWith("﻿")).toBe(false);
    expect(lines(file)[0]).toBe("Name;Qty;Region");
  });

  it("applies a surface-level csvOptions with no per-call options at all", () => {
    const saveFile = vi.fn();
    const harness = mount({ saveFile, csvOptions: { delimiter: "|" } });

    harness.exportCsv();

    expect(lines(saved(saveFile))[0]).toBe("Name|Qty|Region");
  });
});

// ---------------------------------------------------------------------------
// Export aria-live announcements.
//
// Same live region and debounce as the copy and paste announcements; the
// helpers mirror paste-surface.test.tsx's rather than being shared, because the
// flush there also drains the paste gate's microtask chain.
// ---------------------------------------------------------------------------

const ANNOUNCE_DEBOUNCE_MS = 500;

function liveRegion(view: ReturnType<typeof render>): HTMLElement | null {
  return view.baseElement.querySelector("[data-pretable-live-region]");
}

/**
 * `saveFile` may be async, so the announcement is one microtask behind the
 * call; only after that does the debounce timer exist, which is why the two
 * advances cannot be collapsed into one.
 */
async function flushExportAndAnnounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);
  });
}

describe("grid.exportCsv announcements", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces the rows and columns written", async () => {
    const harness = mount({ saveFile: vi.fn() });

    harness.exportCsv();
    await flushExportAndAnnounce();

    expect(liveRegion(harness.view)).toHaveTextContent(
      "3 rows × 3 columns exported",
    );
  });

  it("says the file is partial when the export omitted something", async () => {
    const harness = mount({
      saveFile: vi.fn(),
      processing: { filter: "external", sort: "external" },
      resultMeta: { total: { kind: "exact", count: 100 } },
    });

    harness.exportCsv();
    await flushExportAndAnnounce();

    // A `-PARTIAL` filename is invisible to a screen-reader user; this is the
    // only place they learn the download is short.
    expect(liveRegion(harness.view)).toHaveTextContent(
      "3 loaded rows × 3 columns exported, partial file",
    );
  });

  it("passes the omissions through to an overriding message factory", async () => {
    const exportAnnouncement = vi.fn(
      ({ omissions }: { omissions: readonly { kind: string }[] }) =>
        `omitted: ${omissions.map((omission) => omission.kind).join(",")}`,
    );
    const harness = mount({
      saveFile: vi.fn(),
      processing: { filter: "external", sort: "external" },
      resultMeta: { total: { kind: "exact", count: 100 } },
      messages: { exportAnnouncement },
    });

    harness.exportCsv();
    await flushExportAndAnnounce();

    expect(liveRegion(harness.view)).toHaveTextContent(
      "omitted: unloaded-rows",
    );
    expect(exportAnnouncement.mock.calls[0]![0]).toMatchObject({
      complete: false,
      scope: "loaded",
    });
  });

  it("announces the count of the columns actually written", async () => {
    const harness = mount({ saveFile: vi.fn() });

    harness.exportCsv({ columnIds: ["region", "name"] });
    await flushExportAndAnnounce();

    expect(liveRegion(harness.view)).toHaveTextContent(
      "3 rows × 2 columns exported",
    );
  });

  it("announces nothing when onExport cancelled the export", async () => {
    const harness = mount({ saveFile: vi.fn(), onExport: () => null });

    harness.exportCsv();
    await flushExportAndAnnounce();

    expect(liveRegion(harness.view)).toHaveTextContent("");
  });

  it("announces a failure when saveFile rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const harness = mount({
      saveFile: () => Promise.reject(new Error("disk on fire")),
    });

    harness.exportCsv();
    await flushExportAndAnnounce();

    expect(liveRegion(harness.view)).toHaveTextContent("Export failed");
    warn.mockRestore();
  });
});

describe("exportCsv refuses two ways of naming the same row set", () => {
  it("throws when onlySelected and rowIds are both given", () => {
    // Merging `rowIds` last made `onlySelected` win and the caller's set vanish
    // with nothing said — the silent narrowing this module refuses elsewhere.
    const { grid } = mount();
    expect(() =>
      grid().exportCsv({ onlySelected: true, rowIds: new Set(["r1"]) }),
    ).toThrow(/not both/);
  });

  it("accepts either one alone", () => {
    const { grid } = mount();
    expect(() => grid().exportCsv({ onlySelected: true })).not.toThrow();
    expect(() => grid().exportCsv({ rowIds: new Set(["r1"]) })).not.toThrow();
  });
});

describe("the conflict refusal reaches surface-level rowIds too", () => {
  /**
   * `csvOptions.rowIds` and a call-site `rowIds` are the same declaration made
   * in two places. Guarding only the call site let `onlySelected` overwrite the
   * surface-level one — the silent narrowing the throw exists to refuse,
   * escaping through the door the throw was not watching.
   */
  it("throws when onlySelected meets a rowIds declared on the surface", () => {
    const { grid } = mount({ csvOptions: { rowIds: new Set(["r1"]) } });
    expect(() => grid().exportCsv({ onlySelected: true })).toThrow(/not both/);
  });

  it("an empty selection with a surface rowIds still refuses", () => {
    // The empty-selection fallback is "export everything", but with a surface
    // `rowIds` set it exported that OTHER subset instead — a button that
    // silently downloads someone else's rows, which is no better than one that
    // silently downloads none.
    const { grid } = mount({ csvOptions: { rowIds: new Set(["r1"]) } });
    expect(() => grid().exportCsv({ onlySelected: true })).toThrow(/not both/);
  });

  it("leaves a surface rowIds alone when onlySelected is not asked for", () => {
    const saveFile = vi.fn();
    const { exportCsv } = mount({
      csvOptions: { rowIds: new Set(["r1"]) },
      saveFile,
    });
    exportCsv();
    expect(lines(saved(saveFile))).toEqual(["Name,Qty,Region", "Alpha,1,east"]);
  });
});

describe("delivery failures are reported, and deliveries are not", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("announces failure when saveFile throws synchronously", async () => {
    // `Promise.resolve(saveFile(file))` evaluates the call BEFORE wrapping it,
    // so a synchronous throw escaped `exportCsv` entirely: no warning, no
    // announcement, and the rest of the click handler died with it.
    // `defaultSaveFile` is itself entirely synchronous DOM work — anchor, Blob,
    // object URL — so this is the shape a real failure takes, not a contrived
    // one. Its async twin two blocks up already passes; only this one did not.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const harness = mount({
      saveFile: () => {
        throw new Error("no DOM");
      },
    });

    harness.exportCsv();
    await flushExportAndAnnounce();

    expect(liveRegion(harness.view)).toHaveTextContent("Export failed");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not report a delivered file as failed when the message factory throws", async () => {
    // `.then(ok).catch(err)` chains the failure handler AFTER the success step,
    // so an announcement that threw was caught by the export's own failure
    // branch: the file was on disk and the screen-reader user was told it was
    // not. `.then(ok, err)` keeps the two apart.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const saveFile = vi.fn();
    const harness = mount({
      messages: {
        exportAnnouncement: () => {
          throw new Error("bad localizer");
        },
      },
      saveFile,
    });

    harness.exportCsv();
    await flushExportAndAnnounce();

    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(liveRegion(harness.view)?.textContent ?? "").not.toMatch(/failed/i);
    // Named as the consumer's bug, and named as distinct from a failed export
    // — the success branch has to swallow its own throw or it escapes as an
    // unhandled rejection, so silence here would hide a real defect.
    expect(warn.mock.calls[0]?.[0]).toMatch(/announcement failed/);
    warn.mockRestore();
  });
});

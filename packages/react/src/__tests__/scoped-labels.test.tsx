import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableSurfaceMessages } from "../pretable-surface";

afterEach(cleanup);

type Row = { id: string; name: string };

/**
 * The callback argument types, read off the interface rather than restated, so
 * a renamed or retyped key fails at compile time instead of at runtime.
 */
type SelectAllArgs = Parameters<
  NonNullable<PretableSurfaceMessages["selectAllAnnouncement"]>
>[0];
type CopyArgs = Parameters<
  NonNullable<PretableSurfaceMessages["copyAnnouncement"]>
>[0];

const rows: Row[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bob" },
];

const columns = [{ id: "name", header: "Name", widthPx: 120 }];

function renderSurface(props: {
  external?: boolean;
  total?: number;
  messages?: PretableSurfaceMessages;
  copyToClipboard?: () => Promise<void>;
}) {
  return render(
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      rowSelectionColumn={{ enabled: true }}
      messages={props.messages}
      copyToClipboard={props.copyToClipboard}
      processing={
        props.external ? { filter: "external", sort: "external" } : undefined
      }
      resultMeta={
        props.total === undefined
          ? undefined
          : { total: { kind: "exact", count: props.total } }
      }
    />,
  );
}

type GroupedRow = { id: string; dept: string; name: string };

/**
 * Four loaded records, two of which fall under a collapsible group. Collapsing
 * one group drives `visibleRows` below `loadedRowCount` — the only way the two
 * counts a select-all announcement quotes can disagree.
 */
const groupedRows: GroupedRow[] = [
  { id: "a", dept: "Eng", name: "Ada" },
  { id: "b", dept: "Eng", name: "Bob" },
  { id: "c", dept: "Ops", name: "Cy" },
  { id: "d", dept: "Ops", name: "Dee" },
];

const groupedColumns = [
  { id: "dept", header: "Dept", widthPx: 120 },
  { id: "name", header: "Name", widthPx: 120 },
];

function renderGroupedSurface() {
  return render(
    <PretableSurface<GroupedRow>
      ariaLabel="People"
      columns={groupedColumns}
      rows={groupedRows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      rowSelectionColumn={{ enabled: true }}
      state={{ rowGroups: ["dept"] }}
      processing={{ filter: "external", sort: "external" }}
      resultMeta={{ total: { kind: "exact", count: 5432 } }}
    />,
  );
}

function liveRegionText(view: ReturnType<typeof render>) {
  return view.baseElement.querySelector("[data-pretable-live-region]")
    ?.textContent;
}

function flushAnnouncement() {
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

describe("scoped select-all labeling", () => {
  it('says "Select all rows" in local mode', () => {
    renderSurface({});
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    ).toBeInTheDocument();
  });

  it('says "Select all loaded rows" when the window is partial', () => {
    renderSurface({ external: true, total: 5432 });
    expect(
      screen.getByRole("checkbox", { name: "Select all loaded rows" }),
    ).toBeInTheDocument();
  });

  it('says "Select all rows" when the window IS the whole population', () => {
    renderSurface({ external: true, total: 2 });
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    ).toBeInTheDocument();
  });

  it("passes scope and counts to selectAllAnnouncement", () => {
    const seen: SelectAllArgs[] = [];
    renderSurface({
      external: true,
      total: 5432,
      messages: {
        selectAllAnnouncement: (args) => {
          seen.push(args);
          return "ok";
        },
      },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all loaded rows" }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      scope: "loaded",
      loadedCount: 2,
      total: 5432,
      isAll: true,
    });
  });

  it("passes scope and counts to selectAllAnnouncement on Cmd/Ctrl+A", () => {
    const seen: SelectAllArgs[] = [];
    const view = renderSurface({
      external: true,
      total: 5432,
      messages: {
        selectAllAnnouncement: (args) => {
          seen.push(args);
          return "ok";
        },
      },
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "a", metaKey: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      scope: "loaded",
      loadedCount: 2,
      total: 5432,
      isAll: true,
    });
  });

  it("passes scope to copyAnnouncement", async () => {
    const seen: CopyArgs[] = [];
    const view = renderSurface({
      external: true,
      total: 5432,
      copyToClipboard: () => Promise.resolve(),
      messages: {
        copyAnnouncement: (args) => {
          seen.push(args);
          return "ok";
        },
      },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all loaded rows" }),
    );
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      scope: "loaded",
      rowCount: 2,
      columnCount: 1,
    });
  });
});

describe("scoped default announcement text", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says 'All rows selected' in local mode", () => {
    const view = renderSurface({});
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("All rows selected");
  });

  it("quotes the loaded count when the window is partial", () => {
    const view = renderSurface({ external: true, total: 5432 });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all loaded rows" }),
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("2 of 2 loaded rows selected");
  });

  it("never claims more rows are selected than the grid has loaded", () => {
    const view = renderGroupedSurface();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Eng" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all loaded rows" }),
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("2 of 4 loaded rows selected");
  });

  it("marks a copy taken from a partial window", async () => {
    const view = renderSurface({
      external: true,
      total: 5432,
      copyToClipboard: () => Promise.resolve(),
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all loaded rows" }),
    );
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("2 loaded rows × 1 columns copied");
  });

  it("leaves the local-mode copy text unqualified", async () => {
    const view = renderSurface({ copyToClipboard: () => Promise.resolve() });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });
    await act(async () => {
      await Promise.resolve();
    });
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("2 rows × 1 columns copied");
  });
});

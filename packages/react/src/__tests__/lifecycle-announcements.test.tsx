import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnFilter, PretableMatchingTotal } from "@pretable/core";

import {
  PretableSurface,
  type PretableSurfaceMessages,
} from "../pretable-surface";
import type { PretableDataState } from "../data-state";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const ANNOUNCE_DEBOUNCE_MS = 500;

type Row = { id: string; name: string };

const columns = [{ id: "name", header: "Name", widthPx: 120 }];
const page1: Row[] = [{ id: "a", name: "Ada" }];
const page2: Row[] = [...page1, { id: "b", name: "Bob" }];
/** One "Ada" among nine non-matches, so an engine filter parts the two counts. */
const tenRows: Row[] = [
  ...page1,
  ...Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` })),
];
const matchesOne: Record<string, ColumnFilter> = {
  name: { operator: "contains", value: "Ada" },
};
const matchesNone: Record<string, ColumnFilter> = {
  name: { operator: "contains", value: "zzzz" },
};

function Harness({
  rows,
  dataState,
  total = { kind: "exact", count: 4120 },
  filterAuthority = "external",
  filters,
  messages,
}: {
  rows: Row[];
  dataState: PretableDataState;
  total?: PretableMatchingTotal;
  filterAuthority?: "engine" | "external";
  filters?: Record<string, ColumnFilter>;
  messages?: PretableSurfaceMessages;
}) {
  return (
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      processing={{ filter: filterAuthority, sort: filterAuthority }}
      // Under engine authority the engine computes the total itself and
      // dev-warns about a supplied one.
      resultMeta={filterAuthority === "external" ? { total } : undefined}
      dataState={dataState}
      messages={messages}
      state={filters ? { filters } : undefined}
    />
  );
}

/** The live region is portaled out of the grid; `baseElement` still holds it. */
function liveRegionText(view: ReturnType<typeof render>): string {
  return (
    view.baseElement.querySelector("[data-pretable-live-region]")
      ?.textContent ?? ""
  );
}

function flushAnnouncement(): void {
  act(() => {
    vi.advanceTimersByTime(ANNOUNCE_DEBOUNCE_MS);
  });
}

/** Load one row under `total` and return what the surface said about it. */
function announceFirstPage(total: PretableMatchingTotal): string {
  const view = render(
    <Harness rows={[]} dataState={{ phase: "loading" }} total={total} />,
  );
  view.rerender(
    <Harness rows={page1} dataState={{ phase: "idle" }} total={total} />,
  );
  flushAnnouncement();
  return liveRegionText(view);
}

describe("lifecycle announcements", () => {
  it("announces the honest count on loading → idle", () => {
    const view = render(<Harness rows={[]} dataState={{ phase: "loading" }} />);
    view.rerender(<Harness rows={page1} dataState={{ phase: "idle" }} />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Showing 1 of 4120");
  });

  it("announces the delta on loading-more → idle", () => {
    const view = render(<Harness rows={page1} dataState={{ phase: "idle" }} />);
    view.rerender(
      <Harness rows={page1} dataState={{ phase: "loading-more" }} />,
    );
    view.rerender(<Harness rows={page2} dataState={{ phase: "idle" }} />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Loaded 1 more. 2 of 4120 loaded.");
  });

  it("is silent when a refresh resolves to the same counts", () => {
    const view = render(<Harness rows={page1} dataState={{ phase: "idle" }} />);
    view.rerender(<Harness rows={page1} dataState={{ phase: "refreshing" }} />);
    view.rerender(<Harness rows={page1} dataState={{ phase: "idle" }} />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("");
  });

  it("announces a refresh that changed the counts", () => {
    const view = render(<Harness rows={page1} dataState={{ phase: "idle" }} />);
    view.rerender(<Harness rows={page1} dataState={{ phase: "refreshing" }} />);
    view.rerender(<Harness rows={page2} dataState={{ phase: "idle" }} />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Showing 2 of 4120");
  });

  it("announces an error", () => {
    const view = render(<Harness rows={page1} dataState={{ phase: "idle" }} />);
    view.rerender(
      <Harness
        rows={page1}
        dataState={{ phase: "error", message: "network down" }}
      />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Could not load results. network down");
  });

  it("announces a refined message while the error phase holds", () => {
    const view = render(<Harness rows={page1} dataState={{ phase: "idle" }} />);
    view.rerender(
      <Harness
        rows={page1}
        dataState={{ phase: "error", message: "network down" }}
      />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Could not load results. network down");

    view.rerender(
      <Harness
        rows={page1}
        dataState={{ phase: "error", message: "network down, retrying" }}
      />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe(
      "Could not load results. network down, retrying",
    );
  });

  it("announces once when the query moves ahead of the rows", () => {
    const view = render(<Harness rows={page1} dataState={{ phase: "idle" }} />);
    view.rerender(<Harness rows={page1} dataState={{ phase: "stale" }} />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Updating results…");
  });

  it("says nothing on the first render", () => {
    const view = render(
      <Harness
        rows={[]}
        dataState={{ phase: "loading" }}
        total={{ kind: "exact", count: 0 }}
      />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("");
  });

  it("stays silent when rows arrive under an unchanged phase", () => {
    const view = render(<Harness rows={[]} dataState={{ phase: "loading" }} />);
    view.rerender(<Harness rows={page1} dataState={{ phase: "idle" }} />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Showing 1 of 4120");

    view.rerender(<Harness rows={page2} dataState={{ phase: "idle" }} />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Showing 1 of 4120");
  });

  it("reports a shrunken tail as a population, not a negative delta", () => {
    const view = render(<Harness rows={page2} dataState={{ phase: "idle" }} />);
    view.rerender(
      <Harness rows={page2} dataState={{ phase: "loading-more" }} />,
    );
    view.rerender(<Harness rows={page1} dataState={{ phase: "idle" }} />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Showing 1 of 4120");
  });

  it("does not let a resolving phase swallow the user's own announcement", () => {
    const messages: PretableSurfaceMessages = {
      selectAllAnnouncement: () => "SELECTION",
    };
    const view = render(
      <Harness
        rows={page1}
        dataState={{ phase: "loading-more" }}
        messages={messages}
      />,
    );
    fireEvent.keyDown(view.getByRole("grid"), { key: "a", metaKey: true });
    view.rerender(
      <Harness
        rows={page2}
        dataState={{ phase: "idle" }}
        messages={messages}
      />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("SELECTION");
  });
});

describe("lifecycle announcement counts", () => {
  it("counts the matching records, not the ones an engine filter excluded", () => {
    const view = render(
      <Harness
        rows={[]}
        dataState={{ phase: "loading" }}
        filterAuthority="engine"
        filters={matchesOne}
      />,
    );
    view.rerender(
      <Harness
        rows={tenRows}
        dataState={{ phase: "idle" }}
        filterAuthority="engine"
        filters={matchesOne}
      />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Showing 1");
  });

  it("agrees with the empty block when an engine filter matches nothing", () => {
    const view = render(
      <Harness
        rows={[]}
        dataState={{ phase: "loading" }}
        filterAuthority="engine"
        filters={matchesNone}
      />,
    );
    view.rerender(
      <Harness
        rows={tenRows}
        dataState={{ phase: "idle" }}
        filterAuthority="engine"
        filters={matchesNone}
      />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Showing 0");
    expect(
      view.baseElement.querySelector("[data-pretable-body-state]"),
    ).toHaveAttribute("data-pretable-body-state", "empty");
  });

  it("hands the population scope to a custom resultsAnnouncement", () => {
    const seen: ("all" | "loaded")[] = [];
    const messages: PretableSurfaceMessages = {
      resultsAnnouncement: ({ scope }) => {
        seen.push(scope);
        return "seen";
      },
    };

    const partial = render(
      <Harness
        rows={[]}
        dataState={{ phase: "loading" }}
        messages={messages}
      />,
    );
    partial.rerender(
      <Harness
        rows={page1}
        dataState={{ phase: "idle" }}
        messages={messages}
      />,
    );
    flushAnnouncement();
    partial.unmount();

    const whole = render(
      <Harness
        rows={[]}
        dataState={{ phase: "loading" }}
        filterAuthority="engine"
        messages={messages}
      />,
    );
    whole.rerender(
      <Harness
        rows={page1}
        dataState={{ phase: "idle" }}
        filterAuthority="engine"
        messages={messages}
      />,
    );
    flushAnnouncement();

    expect(seen).toEqual(["loaded", "all"]);
  });

  it("phrases an estimated population as an approximation", () => {
    expect(announceFirstPage({ kind: "estimate", count: 5000 })).toBe(
      "Showing 1 of about 5000",
    );
  });

  it("phrases a floor-only population as a lower bound", () => {
    expect(announceFirstPage({ kind: "unknown", atLeast: 200 })).toBe(
      "Showing 1 of more than 200",
    );
  });

  it("quotes only the loaded count when the population is unknown", () => {
    expect(announceFirstPage({ kind: "unknown" })).toBe("Showing 1");
  });

  it("drops the population when the loaded records are the population", () => {
    expect(announceFirstPage({ kind: "exact", count: 1 })).toBe("Showing 1");
  });
});

describe("data-driven focus reconciliation", () => {
  const REPAIRED =
    "Focused row is no longer in the results; moved to a nearby row.";

  function FocusHarness({
    rows,
    datasetKey,
    dataState,
    focus,
    messages,
    rowGroups,
  }: {
    rows: Row[];
    datasetKey: string;
    dataState?: PretableDataState;
    focus?: { rowId: string | null; columnId: string | null };
    messages?: PretableSurfaceMessages;
    rowGroups?: string[];
  }) {
    return (
      <>
        {/* A focus target the surface does not own, so "the user was outside
            the grid" is a real place rather than `<body>`. */}
        <button data-testid="outside" type="button">
          Outside
        </button>
        <PretableSurface<Row>
          ariaLabel="People"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          viewportHeight={400}
          processing={{ filter: "external", sort: "external" }}
          resultMeta={{
            datasetKey,
            total: { kind: "exact", count: rows.length },
          }}
          dataState={dataState}
          messages={messages}
          state={{ focus, rowGroups }}
        />
      </>
    );
  }

  function cellAt(
    view: ReturnType<typeof render>,
    rowId: string,
  ): HTMLElement | null {
    return view.container.querySelector<HTMLElement>(
      `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="name"]`,
    );
  }

  function focusCell(view: ReturnType<typeof render>, rowId: string): void {
    const cell = cellAt(view, rowId);
    if (!cell) throw new Error(`no rendered cell for row ${rowId}`);
    act(() => {
      cell.focus();
      fireEvent.click(cell);
    });
  }

  function viewportOf(view: ReturnType<typeof render>): HTMLElement {
    const viewport = view.container.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    );
    if (!viewport) throw new Error("no scroll viewport rendered");
    return viewport;
  }

  /** jsdom runs no layout, so `scrollTop` is inert until it is given storage. */
  function makeScrollRecording(el: HTMLElement): void {
    let scrollTop = 0;
    Object.defineProperty(el, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (next: number) => {
        scrollTop = next;
      },
    });
  }

  it("announces a repaired focus when the focused row leaves the results", () => {
    const view = render(<FocusHarness rows={page2} datasetKey="q1" />);
    focusCell(view, "b");
    view.rerender(<FocusHarness rows={page1} datasetKey="q1" />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe(REPAIRED);
  });

  it("is silent when the focused row survives a same-key replacement", () => {
    const view = render(<FocusHarness rows={page2} datasetKey="q1" />);
    focusCell(view, "b");
    view.rerender(<FocusHarness rows={[...page2]} datasetKey="q1" />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("");
    expect(cellAt(view, "b")).toHaveAttribute("tabindex", "0");
  });

  it("is silent when the consumer moves its own controlled focus with the rows", () => {
    const view = render(
      <FocusHarness
        rows={page2}
        datasetKey="q1"
        focus={{ rowId: "b", columnId: "name" }}
      />,
    );
    view.rerender(
      <FocusHarness
        rows={[...page2]}
        datasetKey="q1"
        focus={{ rowId: "a", columnId: "name" }}
      />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("");
    expect(cellAt(view, "a")).toHaveAttribute("tabindex", "0");
  });

  it("claims no nearby row when the replacement empties the results", () => {
    const view = render(<FocusHarness rows={page2} datasetKey="q1" />);
    focusCell(view, "b");
    view.rerender(<FocusHarness rows={[]} datasetKey="q1" />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("");
    expect(document.activeElement).toBe(viewportOf(view));
  });

  it("prefers the repair to the results count in one announcement window", () => {
    const view = render(
      <FocusHarness
        rows={page2}
        datasetKey="q1"
        dataState={{ phase: "refreshing" }}
      />,
    );
    focusCell(view, "b");
    view.rerender(
      <FocusHarness
        rows={page1}
        datasetKey="q1"
        dataState={{ phase: "idle" }}
      />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe(REPAIRED);
  });

  it("never talks over the confirmation of a keystroke the user just pressed", () => {
    const selectAll: PretableSurfaceMessages = {
      selectAllAnnouncement: () => "SELECT ALL",
    };
    const view = render(
      <FocusHarness rows={page2} datasetKey="q1" messages={selectAll} />,
    );
    focusCell(view, "b");
    fireEvent.keyDown(viewportOf(view), { key: "a", ctrlKey: true });
    view.rerender(
      <FocusHarness rows={page1} datasetKey="q1" messages={selectAll} />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("SELECT ALL");
  });

  it("announces the results count when that same refresh moves no cursor", () => {
    const view = render(
      <FocusHarness
        rows={page2}
        datasetKey="q1"
        dataState={{ phase: "refreshing" }}
      />,
    );
    view.rerender(
      <FocusHarness
        rows={page1}
        datasetKey="q1"
        dataState={{ phase: "idle" }}
      />,
    );
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("Showing 1");
  });

  it("moves focus to the first cell of a new dataset and does not announce a repair", () => {
    const view = render(<FocusHarness rows={page2} datasetKey="q1" />);
    focusCell(view, "b");
    view.rerender(<FocusHarness rows={page2} datasetKey="q2" />);
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("");
    expect(cellAt(view, "a")).toHaveAttribute("tabindex", "0");
    expect(document.activeElement).toBe(cellAt(view, "a"));
  });

  it("takes nothing when the user was outside the grid at the pivot", () => {
    const view = render(<FocusHarness rows={page2} datasetKey="q1" />);
    const outside = view.getByTestId("outside");
    act(() => {
      outside.focus();
    });
    view.rerender(<FocusHarness rows={page2} datasetKey="q2" />);
    flushAnnouncement();
    expect(document.activeElement).toBe(outside);
    expect(
      view.container.querySelector('[data-pretable-cell][tabindex="0"]'),
    ).toBeNull();
  });

  it("lands on the first row the user sees, group row included, at the pivot", () => {
    const grouped = { rows: tenRows, rowGroups: ["name"] };
    const view = render(<FocusHarness {...grouped} datasetKey="q1" />);
    const rows = view.container.querySelectorAll("[data-pretable-row-id]");
    const lastCell = rows[rows.length - 1]?.querySelector<HTMLElement>(
      '[data-pretable-column-id="__pretable_group__"]',
    );
    if (!lastCell) throw new Error("no group-column cell rendered");
    act(() => {
      lastCell.focus();
    });

    view.rerender(<FocusHarness {...grouped} datasetKey="q2" />);

    const firstRow = view.container.querySelector("[data-pretable-row-id]");
    expect(firstRow).toHaveAttribute("data-pretable-group-row");
    expect(document.activeElement).toBe(
      firstRow?.querySelector('[data-pretable-column-id="__pretable_group__"]'),
    );
  });

  it("resets the scroll offset at the pivot", () => {
    const view = render(<FocusHarness rows={page2} datasetKey="q1" />);
    const viewport = viewportOf(view);
    makeScrollRecording(viewport);
    viewport.scrollTop = 240;
    view.rerender(<FocusHarness rows={page2} datasetKey="q2" />);
    expect(viewport.scrollTop).toBe(0);
  });
});

describe("loaded-boundary announcement", () => {
  function lastLoadedCell(view: ReturnType<typeof render>): HTMLElement {
    const cell = view.container.querySelector<HTMLElement>(
      '[data-pretable-row-id="b"] [data-pretable-column-id="name"]',
    );
    if (!cell) throw new Error("no rendered cell for row b");
    act(() => {
      cell.focus();
      fireEvent.click(cell);
    });
    return cell;
  }

  it("announces once when ArrowDown is refused at the last loaded row", () => {
    const view = render(
      <Harness
        rows={page2}
        dataState={{ phase: "idle" }}
        total={{ kind: "exact", count: 5432 }}
      />,
    );
    const lastCell = lastLoadedCell(view);
    act(() => {
      fireEvent.keyDown(lastCell, { key: "ArrowDown" });
    });
    flushAnnouncement();
    expect(liveRegionText(view)).toBe(
      "End of loaded rows. 5430 more available.",
    );
  });

  it("says nothing at the boundary when everything is loaded", () => {
    const view = render(
      <Harness
        rows={page2}
        dataState={{ phase: "idle" }}
        total={{ kind: "exact", count: 2 }}
      />,
    );
    const lastCell = lastLoadedCell(view);
    act(() => {
      fireEvent.keyDown(lastCell, { key: "ArrowDown" });
    });
    flushAnnouncement();
    expect(liveRegionText(view)).toBe("");
  });
});

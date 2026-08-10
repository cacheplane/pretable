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

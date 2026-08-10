import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableDataState } from "../data-state";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

type Row = { id: string; name: string };

const columns = [{ id: "name", header: "Name", widthPx: 120 }];
const page1: Row[] = [{ id: "a", name: "Ada" }];
const page2: Row[] = [...page1, { id: "b", name: "Bob" }];

function Harness({
  rows,
  dataState,
  total,
}: {
  rows: Row[];
  dataState: PretableDataState;
  total: number;
}) {
  return (
    <PretableSurface<Row>
      ariaLabel="People"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={400}
      processing={{ filter: "external", sort: "external" }}
      resultMeta={{ total: { kind: "exact", count: total } }}
      dataState={dataState}
    />
  );
}

/** The live region is portaled to document.body and settles after 500 ms. */
function liveText(): string {
  act(() => {
    vi.advanceTimersByTime(600);
  });
  return (
    document.body.querySelector("[data-pretable-live-region]")?.textContent ??
    ""
  );
}

describe("lifecycle announcements", () => {
  it("announces the honest count on loading → idle", () => {
    const view = render(
      <Harness rows={[]} dataState={{ phase: "loading" }} total={4120} />,
    );
    view.rerender(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    expect(liveText()).toBe("Showing 1 of 4120");
  });

  it("announces the delta on loading-more → idle", () => {
    const view = render(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    view.rerender(
      <Harness
        rows={page1}
        dataState={{ phase: "loading-more" }}
        total={4120}
      />,
    );
    view.rerender(
      <Harness rows={page2} dataState={{ phase: "idle" }} total={4120} />,
    );
    expect(liveText()).toBe("Loaded 1 more. 2 of 4120 loaded.");
  });

  it("is silent when a refresh resolves", () => {
    const view = render(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    view.rerender(
      <Harness rows={page1} dataState={{ phase: "refreshing" }} total={4120} />,
    );
    view.rerender(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    expect(liveText()).toBe("");
  });

  it("announces an error", () => {
    const view = render(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    view.rerender(
      <Harness
        rows={page1}
        dataState={{ phase: "error", message: "network down" }}
        total={4120}
      />,
    );
    expect(liveText()).toBe("Could not load results. network down");
  });

  it("announces once when the query moves ahead of the rows", () => {
    const view = render(
      <Harness rows={page1} dataState={{ phase: "idle" }} total={4120} />,
    );
    view.rerender(
      <Harness rows={page1} dataState={{ phase: "stale" }} total={4120} />,
    );
    expect(liveText()).toBe("Updating results…");
  });

  it("says nothing on the first render", () => {
    render(<Harness rows={[]} dataState={{ phase: "loading" }} total={0} />);
    expect(liveText()).toBe("");
  });
});

import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  PretableMatchingTotal,
  PretableProcessingOptions,
} from "@pretable/core";
import { PretableSurface } from "../pretable-surface";
import { settledWindow, windowIds } from "./window-settle";

type Row = { id: string; name: string; score: number };

const TOTAL = 20;
const ALL: Row[] = Array.from({ length: TOTAL }, (_, index) => ({
  id: `row-${index}`,
  name: `name-${index}`,
  score: index,
}));

const columns = [
  { id: "name", header: "Name", widthPx: 120 },
  { id: "score", header: "Score", widthPx: 120 },
];

const EXTERNAL: PretableProcessingOptions = {
  filter: "external",
  sort: "external",
};

const QUERY = { filters: [], sort: [], rowGroups: [] };
const EXACT: PretableMatchingTotal = { kind: "exact", count: TOTAL };
const ESTIMATE: PretableMatchingTotal = { kind: "estimate", count: TOTAL };

function ids(start: number, length = 10): string[] {
  return windowIds(ALL, start, length);
}

function WindowedGrid({
  windowStart,
  length = 10,
  total = EXACT,
}: {
  windowStart: number;
  length?: number;
  total?: PretableMatchingTotal;
}) {
  return (
    <PretableSurface<Row>
      ariaLabel="Windowed"
      columns={columns}
      rows={ALL.slice(windowStart, windowStart + length)}
      getRowId={(row) => row.id}
      viewportHeight={800}
      processing={EXTERNAL}
      resultMeta={{
        total,
        window: {
          start: windowStart,
          hasMore: windowStart + length < TOTAL,
        },
        datasetKey: "sort=name",
      }}
      query={QUERY}
      onQueryChange={() => undefined}
    />
  );
}

function rowNodes(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-pretable-row-id]"),
  );
}

function firstRowTop(container: HTMLElement): number {
  const first = rowNodes(container)[0];
  if (first === undefined) throw new Error("no rows drawn");
  return Number.parseFloat(first.style.top);
}

function rowHeight(container: HTMLElement): number {
  const first = rowNodes(container)[0];
  if (first === undefined) throw new Error("no rows drawn");
  return Number(first.getAttribute("data-pretable-row-height"));
}

function ariaRowIndexes(container: HTMLElement): number[] {
  return rowNodes(container).map((node) =>
    Number(node.getAttribute("aria-rowindex")),
  );
}

/** The drawn scroll extent — the content div the scroller can reach. */
function contentHeight(container: HTMLElement): number {
  const content = container.querySelector<HTMLElement>(
    "[data-pretable-scroll-content]",
  );
  if (content === null) throw new Error("no scroll content element");
  return Number.parseFloat(content.style.height);
}

afterEach(cleanup);

describe("a gate that reopens at the same window", () => {
  it("redraws the leading spacer and the scroll extent with the announced indices", async () => {
    // The gate is SHUT on mount (an estimated total), so nothing about the
    // window may be trusted: rows 10..19 are announced from the head of the
    // dataset and drawn against a zero spacer.
    const { container, rerender } = render(
      <WindowedGrid windowStart={10} total={ESTIMATE} />,
    );
    await settledWindow(container, ids(10), 0);
    const height = rowHeight(container);
    expect(ariaRowIndexes(container)[0]).toBe(2);
    expect(firstRowTop(container)).toBe(0);

    // The count query lands. Same window, same rows, exact total — the gate
    // reopens and the rows are now announced at their real dataset position.
    rerender(<WindowedGrid windowStart={10} total={EXACT} />);
    expect(ariaRowIndexes(container)[0]).toBe(12);

    // ...and the geometry has to follow: 10 rows of leading spacer, and a
    // scroll extent that covers the whole population rather than the loaded
    // window alone. Without a spacer replan both stay collapsed.
    await settledWindow(container, ids(10), 10);
    expect(firstRowTop(container)).toBe(10 * height);
    expect(contentHeight(container)).toBe(TOTAL * height);
  }, 20_000);
});

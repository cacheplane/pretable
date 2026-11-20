import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  PretableMatchingTotal,
  PretableProcessingOptions,
  PretableSelectionState,
} from "@pretable/core";
import { PretableSurface } from "../pretable-surface";
import { settledRows, settledWindow } from "./window-settle";

// Compatibility controls for future remote ownership. These are deliberately
// existing rows-owned surfaces, with no remote API or unavailable record slots.
// Metadata-only windowGap updates already live in indexed-rendering.test.tsx;
// copy/CSV/edit behavior stays in its existing dedicated suites.
type Row = { id: string; name: string; team: string };
const rows: Row[] = [
  { id: "a", name: "Ada", team: "x" },
  { id: "b", name: "Bob", team: "x" },
  { id: "c", name: "Cara", team: "x" },
];
const columns = [
  { id: "name", header: "Name", widthPx: 120 },
  { id: "team", header: "Team", widthPx: 120 },
];
const external: PretableProcessingOptions = {
  filter: "external",
  sort: "external",
};
const exact: PretableMatchingTotal = { kind: "exact", count: 1000 };
const getRowId = (row: Row) => row.id;

type FixtureProps = {
  manual: boolean;
  label?: string;
  total?: PretableMatchingTotal;
  processing?: PretableProcessingOptions;
  grouped?: boolean;
  datasetKey?: string;
  selection?: PretableSelectionState;
};
function Fixture({
  manual,
  label = "Compatibility",
  total = exact,
  processing = external,
  grouped = false,
  datasetKey = "first",
  selection,
}: FixtureProps) {
  return (
    <PretableSurface<Row>
      ariaLabel={label}
      columns={columns}
      rows={rows}
      getRowId={getRowId}
      viewportHeight={800}
      processing={manual ? processing : undefined}
      resultMeta={
        manual
          ? { total, window: { start: 102, hasMore: true }, datasetKey }
          : undefined
      }
      query={{
        filters: [],
        sort: [],
        rowGroups: grouped ? [{ columnId: "team" }] : [],
      }}
      onQueryChange={() => undefined}
      state={selection ? { selection } : undefined}
    />
  );
}
function painted(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-pretable-row-id] [data-pretable-column-id="name"][data-pretable-selected="true"]',
    ),
  ).map((cell) =>
    cell
      .closest("[data-pretable-row-id]")!
      .getAttribute("data-pretable-row-id"),
  );
}
afterEach(cleanup);

describe.each([false, true])(
  "manual window = %s, paired with ordinary local rows",
  (manual) => {
    it("keeps exact count, row positions and spacer geometry coherent", async () => {
      const view = render(<Fixture manual={manual} />);
      await settledWindow(view.container, ["a", "b", "c"], manual ? 102 : 0);
      expect(view.getByRole("grid")).toHaveAttribute(
        "aria-rowcount",
        manual ? "1001" : "4",
      );
      expect(
        view.container.querySelector('[data-pretable-row-id="a"]'),
      ).toHaveAttribute("aria-rowindex", manual ? "104" : "2");
      expect(
        view.container.querySelectorAll("[data-pretable-row-id]"),
      ).toHaveLength(3);
    });

    it("uses loaded geometry when the total is unknown", async () => {
      const view = render(
        <Fixture manual={manual} total={{ kind: "unknown" }} />,
      );
      await settledWindow(view.container, ["a", "b", "c"], 0);
      expect(view.getByRole("grid")).toHaveAttribute(
        "aria-rowcount",
        manual ? "-1" : "4",
      );
      expect(
        view.container.querySelector('[data-pretable-row-id="a"]'),
      ).toHaveAttribute("aria-rowindex", "2");
    });

    it("uses loaded positions when filter authority is not external", async () => {
      const view = render(
        <Fixture
          manual={manual}
          processing={{ filter: "engine", sort: "external" }}
        />,
      );
      await settledWindow(view.container, ["a", "b", "c"], 0);
      expect(view.getByRole("grid")).toHaveAttribute("aria-rowcount", "4");
      expect(
        view.container.querySelector('[data-pretable-row-id="a"]'),
      ).toHaveAttribute("aria-rowindex", "2");
    });

    it("does not apply a flat population offset to grouped rows", () => {
      const view = render(<Fixture manual={manual} grouped />);
      const grid = view.getByRole("treegrid");
      expect(grid).toHaveAttribute("aria-rowcount", "5");
      const first = view.container.querySelector<HTMLElement>(
        "[data-pretable-group-row]",
      )!;
      expect(first).toHaveAttribute("aria-rowindex", "2");
      expect(first.style.top).toBe("0px");
      // Data rows follow the group header in the same loaded coordinate space.
      expect(
        view.container.querySelector('[data-pretable-row-id="a"]'),
      ).toHaveAttribute("aria-rowindex", "3");
      expect(within(grid).getAllByRole("row")).toHaveLength(5);
    });

    it("invalidates an evicted positional selection when only datasetKey changes", async () => {
      const selection: PretableSelectionState = {
        ranges: [
          {
            startRowId: "absent-start",
            endRowId: "absent-end",
            startColumnId: "name",
            endColumnId: "name",
            datasetRowSpan: {
              start: 100,
              end: 109,
              datasetKey: "first",
              datasetTotal: 1000,
            },
          },
        ],
        anchor: { rowId: "absent-start", columnId: "name" },
      };
      const view = render(<Fixture manual={manual} selection={selection} />);
      await settledRows(view.container, ["a", "b", "c"]);
      expect(painted(view.container)).toEqual(manual ? ["a", "b", "c"] : []);
      view.rerender(
        <Fixture manual={manual} selection={selection} datasetKey="second" />,
      );
      expect(painted(view.container)).toEqual([]);
    });
  },
);

it("keeps simultaneous manual and local surfaces independent with shared row IDs", async () => {
  const view = render(
    <>
      <section data-testid="manual">
        <Fixture manual label="Manual" />
      </section>
      <section data-testid="local">
        <Fixture manual={false} label="Local" />
      </section>
    </>,
  );
  const manual = view.getByTestId("manual");
  const local = view.getByTestId("local");
  await settledWindow(manual, ["a", "b", "c"], 102);
  await settledWindow(local, ["a", "b", "c"], 0);
  fireEvent.click(
    manual.querySelector(
      '[data-pretable-row-id="b"] [data-pretable-column-id="name"]',
    )!,
  );
  expect(painted(manual)).toEqual(["b"]);
  expect(painted(local)).toEqual([]);
  fireEvent.click(
    local.querySelector(
      '[data-pretable-row-id="c"] [data-pretable-column-id="name"]',
    )!,
  );
  expect(painted(manual)).toEqual(["b"]);
  expect(painted(local)).toEqual(["c"]);
  expect(within(manual).getByRole("grid")).toHaveAttribute(
    "aria-rowcount",
    "1001",
  );
  expect(within(local).getByRole("grid")).toHaveAttribute("aria-rowcount", "4");
});

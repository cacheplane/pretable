import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createColumnHelper, createLocalRowModel } from "@pretable/core";
import { renderToString } from "react-dom/server";
import { PretableSurface, type PretableSurfaceGrid } from "../pretable-surface";
import type { PretableColumn } from "../types";
import type { PretableSummaries } from "../summary";

type Row = { id: string; amount: number; team: string };
const rows: Row[] = [
  { id: "a", amount: 10, team: "A" },
  { id: "b", amount: 20, team: "B" },
];
const columns: PretableColumn<Row>[] = [
  {
    id: "amount",
    header: "Amount",
    type: "number",
    aggregate: "sum",
    widthPx: 160,
  },
  { id: "team", header: "Team", widthPx: 240 },
];
const both: PretableSummaries = {
  filtered: { authority: "engine" },
  all: { authority: "engine" },
};
let originalWidth: PropertyDescriptor | undefined;
beforeEach(() => {
  originalWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 300,
  });
});
afterEach(() => {
  cleanup();
  if (originalWidth)
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalWidth);
  else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
});
function surface(summaries?: PretableSummaries) {
  return (
    <PretableSurface
      ariaLabel="Delivery"
      columns={columns}
      rows={rows}
      summaries={summaries}
      viewportHeight={320}
      toolPanel={false}
    />
  );
}
describe("fixed summary rows", () => {
  it("keeps both captions outside the data grid and preserves the first aggregate column", async () => {
    const view = render(surface(both));
    await waitFor(() =>
      expect(
        view.container.querySelectorAll(
          '[data-pretable-summary-state="ready"]',
        ),
      ).toHaveLength(2),
    );
    for (const name of ["Matching rows", "All input rows"]) {
      const table = view.getByRole("table", { name });
      expect(
        within(table).getByRole("columnheader", { name: "Amount" }),
      ).toBeInTheDocument();
      expect(
        within(table).getByRole("cell", { name: "30" }),
      ).toBeInTheDocument();
      expect(view.getByRole("grid")).not.toContainElement(table);
    }
    expect(view.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
    expect(
      view.container.querySelector("[data-pretable-summaries] [tabindex]"),
    ).toBeNull();
    expect(
      view.container.querySelector("[data-pretable-summaries] [aria-live]"),
    ).toBeNull();
  });
  it("restores the original viewport and DOM when disabled", () => {
    const view = render(surface());
    const height = view.getByRole("grid").style.height;
    expect(
      view.container.querySelector("[data-pretable-summaries]"),
    ).toBeNull();
    view.rerender(surface(both));
    expect(parseFloat(view.getByRole("grid").style.height)).toBeLessThan(
      parseFloat(height),
    );
    view.rerender(surface());
    expect(view.getByRole("grid").style.height).toBe(height);
    expect(
      view.container.querySelector("[data-pretable-summary-wrapper]"),
    ).toBeNull();
  });
  it("never masks server authority and partial/stale state with a custom caption", () => {
    const view = render(
      surface({
        all: {
          authority: "server",
          label: "Budget",
          requestKey: "now",
          aggregateDefinitionKey: "sum",
          result: {
            state: "stale",
            label: "Previous refresh",
            requestKey: "old",
            aggregateDefinitionKey: "sum",
            completeness: "partial",
            values: { amount: 0, team: "must not render", unknown: 999 },
          },
        },
      }),
    );
    const table = view.getByRole("table");
    expect(table).toHaveTextContent("Budget");
    expect(table).toHaveTextContent("Server");
    expect(table).toHaveTextContent("Partial");
    expect(table).toHaveTextContent("Previous refresh");
    expect(within(table).getByRole("cell", { name: "0" })).toBeInTheDocument();
    expect(table).not.toHaveTextContent("must not render");
  });
});

it("updates both scopes for filters, transactions and collapse without changing row identity", async () => {
  const helper = createColumnHelper<Row>();
  const schema = [
    helper.accessor("amount", { type: "number", aggregate: "sum" }),
    helper.accessor("team", { type: "text" }),
  ] as const;
  const model = createLocalRowModel({ rows, columns: schema });
  const view = render(
    <PretableSurface
      ariaLabel="Delivery"
      model={model}
      summaries={both}
      viewportHeight={320}
      toolPanel={false}
    />,
  );
  const amount = (scope: string) =>
    view.container.querySelector(
      `[data-pretable-summary-scope="${scope}"] [data-pretable-summary-column="amount"]`,
    );
  await waitFor(() => expect(amount("filtered")).toHaveTextContent("30"));
  act(() =>
    model.setQuery({
      filters: [{ columnId: "team", operator: "equals", value: "A" }],
      sort: [],
      rowGroups: [{ columnId: "team" }],
    }),
  );
  await waitFor(() => expect(amount("filtered")).toHaveTextContent("10"));
  expect(amount("all")).toHaveTextContent("30");
  act(() =>
    model.applyTransaction({ update: [{ id: "a", changes: { amount: 15 } }] }),
  );
  await waitFor(() => expect(amount("filtered")).toHaveTextContent("15"));
  expect(amount("all")).toHaveTextContent("35");
  act(() => model.collapseAll());
  await waitFor(() => expect(amount("filtered")).toHaveTextContent("15"));
  expect(amount("all")).toHaveTextContent("35");
  view.unmount();
  model.dispose();
});
it("uses actual model derivations when the original schema has no aggregate", async () => {
  const helper = createColumnHelper<Row>();
  const schema = [
    helper.accessor("amount", { type: "number" }),
    helper.accessor("team", { type: "text" }),
  ] as const;
  const model = createLocalRowModel({ rows, columns: schema });
  const view = render(
    <PretableSurface
      ariaLabel="Delivery"
      model={model}
      summaries={both}
      viewportHeight={320}
      toolPanel={false}
    />,
  );
  const cell = () =>
    view.container.querySelector(
      '[data-pretable-summary-scope="all"] [data-pretable-summary-column="amount"]',
    );
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-pretable-summary-state="ready"]'),
    ).not.toBeNull(),
  );
  expect(cell()).toBeEmptyDOMElement();
  act(() =>
    model.setDerivations([
      {
        id: "amount",
        type: "number",
        accessor: (row: Row) => row.amount,
        value: (row: Row) => row.amount,
        aggregate: "sum",
      },
      {
        id: "team",
        type: "text",
        accessor: (row: Row) => row.team,
        value: (row: Row) => row.team,
      },
    ] as never),
  );
  await waitFor(() => expect(cell()).toHaveTextContent("30"));
  act(() =>
    model.setDerivations([
      {
        id: "amount",
        type: "number",
        accessor: (row: Row) => row.amount,
        value: (row: Row) => row.amount,
      },
      {
        id: "team",
        type: "text",
        accessor: (row: Row) => row.team,
        value: (row: Row) => row.team,
      },
    ] as never),
  );
  await waitFor(() => expect(cell()).toBeEmptyDOMElement());
  view.unmount();
  model.dispose();
});
it.each(["loading", "error", "unavailable"] as const)(
  "keeps %s distinct from missing, null and zero and bypasses formatters",
  (state) => {
    const formatSummary = vi.fn(() => "WRONG");
    const view = render(
      <PretableSurface
        ariaLabel="Delivery"
        columns={[{ ...columns[0]!, formatSummary }, columns[1]!]}
        rows={rows}
        summaries={{
          all: {
            authority: "server",
            requestKey: "q",
            aggregateDefinitionKey: "a",
            result: { state },
          },
        }}
        viewportHeight={320}
        toolPanel={false}
      />,
    );
    expect(
      view.container.querySelector('[data-pretable-summary-column="amount"]'),
    ).toHaveTextContent(
      state === "loading"
        ? "Loading"
        : state === "error"
          ? "Error"
          : "Unavailable",
    );
    expect(formatSummary).not.toHaveBeenCalled();
  },
);
it("rejects mismatched requests and incompatible stale definitions", () => {
  const server = (
    state: "ready" | "stale",
    requestKey: string,
    aggregateDefinitionKey: string,
  ): PretableSummaries => ({
    all: {
      authority: "server",
      requestKey: "current",
      aggregateDefinitionKey: "sum",
      result: {
        state,
        label: "Earlier answer",
        requestKey,
        aggregateDefinitionKey,
        completeness: "complete",
        values: { amount: 999 },
      },
    },
  });
  const view = render(surface(server("ready", "old", "sum")));
  expect(view.getByRole("table")).not.toHaveTextContent("999");
  expect(view.getByRole("table")).toHaveTextContent("Unavailable");
  view.rerender(surface(server("stale", "old", "avg")));
  expect(view.getByRole("table")).not.toHaveTextContent("999");
  view.rerender(surface(server("stale", "old", "sum")));
  expect(view.getByRole("table")).toHaveTextContent("999");
});
it("labels partial engine inputs even with exact totals and a custom caption", async () => {
  const view = render(
    <PretableSurface
      ariaLabel="Delivery"
      columns={columns}
      rows={rows}
      processing={{ filter: "external" }}
      resultMeta={{
        total: { kind: "exact", count: 2 },
        window: { start: 0, hasMore: false },
      }}
      summaries={{ all: { authority: "engine", label: "Budget" } }}
      viewportHeight={320}
      toolPanel={false}
    />,
  );
  await waitFor(() => expect(view.getByRole("table")).toHaveTextContent("30"));
  expect(view.getByRole("table")).toHaveTextContent("Loaded rows only");
});
it("formats locale changes and localizes captions and availability in SSR", () => {
  const summaries: PretableSummaries = {
    all: {
      authority: "server",
      requestKey: "q",
      aggregateDefinitionKey: "a",
      result: {
        state: "ready",
        requestKey: "q",
        aggregateDefinitionKey: "a",
        completeness: "complete",
        values: { amount: 1234.5 },
      },
    },
  };
  const props = {
    ariaLabel: "Delivery",
    columns: [{ ...columns[0]!, numberFormat: { minimumFractionDigits: 2 } }],
    rows,
    summaries,
    viewportHeight: 320,
    toolPanel: false as const,
  };
  const view = render(<PretableSurface {...props} locale="en-US" />);
  expect(view.getByRole("table")).toHaveTextContent("1,234.50");
  view.rerender(<PretableSurface {...props} locale="de-DE" />);
  expect(view.getByRole("table")).toHaveTextContent("1.234,50");
  const html = renderToString(
    <PretableSurface
      {...props}
      summaries={{ all: { authority: "engine" } }}
      messages={{
        summaryCaption: () => "Gesamt",
        summaryStateMessage: () => "Nicht verfügbar",
      }}
    />,
  );
  expect(html).toContain("Gesamt");
  expect(html).toContain("Nicht verfügbar");
});
it("shares column width, order, visibility, pin styles and source scroll", async () => {
  let grid!: PretableSurfaceGrid<Row, string, typeof columns>;
  const view = render(
    <PretableSurface
      ariaLabel="Delivery"
      columns={columns}
      rows={rows}
      summaries={both}
      viewportHeight={320}
      toolPanel={false}
      onGridReady={(ready) => {
        grid = ready;
      }}
    />,
  );
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-pretable-summary-state="ready"]'),
    ).not.toBeNull(),
  );
  act(() => {
    grid.setColumnWidth("amount", 180);
    grid.setColumnPinned("amount", "right");
  });
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-pretable-summary-column="amount"]'),
    ).toHaveStyle({ width: "180px", position: "sticky" }),
  );
  act(() => grid.setColumnVisible("team", false));
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-pretable-summary-column="team"]'),
    ).toBeNull(),
  );
  act(() => {
    grid.setColumnVisible("team", true);
    grid.setColumnPinned("amount", null);
    grid.setColumnOrder(["team", "amount"]);
  });
  await waitFor(() =>
    expect(
      view.container.querySelector("[data-pretable-summary-scroll] td"),
    ).toHaveAttribute("data-pretable-summary-column", "team"),
  );
  const viewport = view.getByRole("grid");
  viewport.scrollLeft = 90;
  fireEvent.scroll(viewport);
  for (const mirror of view.container.querySelectorAll(
    "[data-pretable-summary-scroll]",
  ))
    expect(mirror.scrollLeft).toBe(90);
});

it("keeps real header associations for column IDs containing whitespace", () => {
  const view = render(
    <PretableSurface
      ariaLabel="Names"
      rows={[{ id: "a", "total hours": 2 }]}
      columns={[
        {
          id: "total hours",
          header: "Total hours",
          aggregate: "sum",
          type: "number",
        },
      ]}
      viewportHeight={200}
      toolPanel={false}
      summaries={{
        all: {
          authority: "server",
          requestKey: "q",
          aggregateDefinitionKey: "a",
          result: {
            state: "ready",
            requestKey: "q",
            aggregateDefinitionKey: "a",
            completeness: "complete",
            values: { "total hours": 2 },
          },
        },
      }}
    />,
  );
  const cell = within(view.getByRole("table")).getByRole("cell", { name: "2" });
  const headerIds = cell.getAttribute("headers")!.split(/\s+/);
  expect(headerIds).toHaveLength(1);
  expect(document.getElementById(headerIds[0]!)).toHaveTextContent(
    "Total hours",
  );
});

it("supports server summaries when a custom model lacks optional summary capability", async () => {
  const helper = createColumnHelper<Row>();
  const model = createLocalRowModel({
    rows,
    columns: [
      helper.accessor("amount", { type: "number", aggregate: "sum" }),
      helper.accessor("team", { type: "text" }),
    ] as const,
  });
  const custom = Object.create(model) as typeof model;
  Object.defineProperty(custom, "acquireSummaryScopes", { value: undefined });
  const view = render(
    <PretableSurface
      ariaLabel="Custom"
      model={custom}
      viewportHeight={240}
      toolPanel={false}
      summaries={{
        filtered: { authority: "engine" },
        all: {
          authority: "server",
          requestKey: "q",
          aggregateDefinitionKey: "a",
          result: {
            state: "ready",
            requestKey: "q",
            aggregateDefinitionKey: "a",
            completeness: "complete",
            values: { amount: 123 },
          },
        },
      }}
    />,
  );
  expect(
    view.container.querySelector('[data-pretable-summary-scope="filtered"]'),
  ).toHaveTextContent("Unavailable");
  expect(
    view.container.querySelector('[data-pretable-summary-scope="all"]'),
  ).toHaveTextContent("123");
  view.unmount();
  model.dispose();
});

it("respects effective aggregate overrides and leaves disabled aggregate slots blank", async () => {
  let grid!: PretableSurfaceGrid<Row, string, typeof columns>;
  const view = render(
    <PretableSurface
      ariaLabel="Overrides"
      columns={columns}
      rows={rows}
      summaries={both}
      viewportHeight={320}
      toolPanel={false}
      onGridReady={(ready) => {
        grid = ready;
      }}
    />,
  );
  const cell = () =>
    view.container.querySelector(
      '[data-pretable-summary-scope="all"] [data-pretable-summary-column="amount"]',
    );
  await waitFor(() => expect(cell()).toHaveTextContent("30"));
  act(() => grid.setColumnAggregate("amount", "count"));
  await waitFor(() => expect(cell()).toHaveTextContent("2"));
  act(() => grid.setColumnAggregate("amount", null));
  await waitFor(() => expect(cell()).toBeEmptyDOMElement());
});

it("does not disturb selection, editing, keyboard focus or copied data when toggled", async () => {
  let grid!: PretableSurfaceGrid<Row, string, typeof columns>;
  const copy = vi.fn();
  const props = {
    ariaLabel: "Editing",
    columns,
    rows,
    viewportHeight: 320,
    toolPanel: false as const,
    copyToClipboard: copy,
    onGridReady: (ready: typeof grid) => {
      grid = ready;
    },
  };
  const view = render(<PretableSurface {...props} />);
  const dataCell = view.container.querySelector<HTMLElement>(
    '[data-pretable-cell][data-pretable-column-id="amount"]',
  )!;
  fireEvent.click(dataCell);
  act(() => {
    grid.toggleRowSelection("a");
    grid.beginEdit({ rowId: "a", columnId: "amount", value: 10 });
  });
  const state = grid.getState();
  view.rerender(<PretableSurface {...props} summaries={both} />);
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-pretable-summary-state="ready"]'),
    ).not.toBeNull(),
  );
  expect(grid.getState().selection).toEqual(state.selection);
  expect(grid.getState().editing).toEqual(state.editing);
  expect(grid.getState().focus).toEqual(state.focus);
  act(() => grid.cancelEdit());
  fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });
  await waitFor(() => expect(copy).toHaveBeenCalled());
  expect(copy.mock.calls[0]![0].text).not.toContain("Matching rows");
  expect(copy.mock.calls[0]![0].text).not.toContain("30");
});

it("distinguishes a missing server value from a real null or zero", () => {
  const answer = (
    values: Readonly<Record<string, unknown>>,
  ): PretableSummaries => ({
    all: {
      authority: "server",
      requestKey: "q",
      aggregateDefinitionKey: "a",
      result: {
        state: "ready",
        requestKey: "q",
        aggregateDefinitionKey: "a",
        completeness: "complete",
        values,
      },
    },
  });
  const view = render(surface(answer({})));
  const cell = () =>
    view.container.querySelector('[data-pretable-summary-column="amount"]');
  expect(cell()).toHaveTextContent("—");
  view.rerender(surface(answer({ amount: null })));
  expect(cell()).toBeEmptyDOMElement();
  view.rerender(surface(answer({ amount: 0 })));
  expect(cell()).toHaveTextContent("0");
});

it("marks known partial counts as loaded without requiring external processing", async () => {
  const view = render(
    <PretableSurface
      ariaLabel="Partial"
      columns={columns}
      rows={rows}
      summaries={both}
      resultMeta={{ total: { kind: "exact", count: 100 } }}
      viewportHeight={320}
      toolPanel={false}
    />,
  );
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-pretable-summary-state="ready"]'),
    ).not.toBeNull(),
  );
  expect(
    view.getByRole("table", { name: /All loaded rows/ }),
  ).not.toHaveTextContent("Loaded rows only");
});

it("uses committed aggregate definitions for server-only model summaries", async () => {
  const helper = createColumnHelper<Row>();
  const schema = [
    helper.accessor("amount", { type: "number" }),
    helper.accessor("team", { type: "text", aggregate: "count" }),
  ] as const;
  const model = createLocalRowModel({
    rows,
    columns: schema,
  });
  const summaries: PretableSummaries = {
    all: {
      authority: "server",
      requestKey: "q",
      aggregateDefinitionKey: "a",
      result: {
        state: "ready",
        requestKey: "q",
        aggregateDefinitionKey: "a",
        completeness: "complete",
        values: { amount: 900, team: 99 },
      },
    },
  };
  const view = render(
    <PretableSurface
      ariaLabel="Model server"
      model={model}
      summaries={summaries}
      viewportHeight={240}
      toolPanel={false}
    />,
  );
  const amount = () =>
    view.container.querySelector('[data-pretable-summary-column="amount"]');
  const team = () =>
    view.container.querySelector('[data-pretable-summary-column="team"]');
  expect(amount()).toBeEmptyDOMElement();
  expect(team()).toHaveTextContent("99");
  // Direct derivations deliberately change aggregate types independently of
  // the immutable original schema/presentation tuple.
  await act(async () => {
    await model.setDerivations([
      { ...schema[0], aggregate: "sum" },
      { ...schema[1], aggregate: undefined },
    ] as never).finished;
  });
  await waitFor(() => expect(amount()).toHaveTextContent("900"));
  expect(team()).toBeEmptyDOMElement();
  view.unmount();
  model.dispose();
});

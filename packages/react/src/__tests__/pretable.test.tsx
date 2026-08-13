import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect } from "react";

import { Pretable } from "../index";
import { usePretable } from "../use-pretable";
import { createColumnHelper } from "@pretable/core";
import { measureRenderedRowHeight } from "../row-height";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("renders no prototype scaffolding — no banner, and the grid announces the caller's ariaLabel", () => {
  const view = render(
    <Pretable
      ariaLabel="Empty test grid"
      rows={[]}
      columns={[]}
      getRowId={() => "empty"}
    />,
  );

  expect(view.queryByText("Pretable React adapter")).not.toBeInTheDocument();
  expect(view.queryByText(/^Rows:/)).not.toBeInTheDocument();
  expect(view.queryByText(/^Columns:/)).not.toBeInTheDocument();
  expect(
    view.getByRole("grid", { name: "Empty test grid" }),
  ).toBeInTheDocument();
});

it("exposes the benchmark viewport, content, row, and cell DOM markers", () => {
  const view = render(
    <Pretable
      ariaLabel="Messages"
      columns={[
        {
          id: "message",
          header: "Message",
        },
      ]}
      getRowId={(row) => row.id}
      rows={[
        {
          id: "row-0",
          message: "Hello from Pretable",
        },
      ]}
    />,
  );

  const viewport = view.container.querySelector(
    "[data-pretable-scroll-viewport]",
  );
  const content = view.container.querySelector(
    "[data-pretable-scroll-content]",
  );
  const row = view.container.querySelector("[data-pretable-row]");
  const cells = row?.querySelectorAll("[data-pretable-cell]");

  expect(viewport).toHaveAttribute("role", "grid");
  expect(viewport).toHaveAttribute("tabindex", "-1");
  expect(content).toBeInTheDocument();
  expect(
    view.getByRole("columnheader", { name: "Sort Message" }),
  ).toBeInTheDocument();
  expect(row).toHaveAttribute("data-pretable-row-index", "0");
  expect(cells).toHaveLength(1);
});

it("renders a body cell with only its value — not the header label prefixed onto it", () => {
  const view = render(
    <Pretable
      ariaLabel="People"
      columns={[
        {
          id: "name",
          header: "Name",
        },
      ]}
      getRowId={(row) => row.id}
      rows={[
        {
          id: "row-0",
          name: "Ada",
        },
      ]}
    />,
  );

  const cell = view.container.querySelector("[data-pretable-cell]");

  expect(cell).not.toBeNull();
  expect(cell?.textContent).toBe("Ada");
  expect(view.queryByText("NameAda")).not.toBeInTheDocument();
});

it("preserves the benchmark viewport policy on the public wrapper path", () => {
  const view = render(
    <Pretable
      ariaLabel="Messages"
      columns={[
        {
          id: "message",
          header: "Message",
        },
      ]}
      getRowId={(row) => row.id}
      rows={[
        {
          id: "row-0",
          message: "Hello from Pretable",
        },
      ]}
    />,
  );

  const viewport = view.getByRole("grid", { name: "Messages" });

  expect(viewport).toHaveStyle({
    contain: "none",
    contentVisibility: "visible",
    containIntrinsicSize: "none",
    overflowAnchor: "none",
    overscrollBehavior: "contain",
  });
});

it("renders accessor-driven values correctly through the public wrapper", () => {
  const view = render(
    <Pretable
      ariaLabel="People"
      columns={[
        {
          id: "fullName",
          header: "Full name",
          value: (row: { firstName: string; lastName: string }) =>
            `${row.firstName} ${row.lastName}`,
        },
      ]}
      getRowId={(row) => row.id}
      rows={[
        {
          id: "person-0",
          firstName: "Ada",
          lastName: "Lovelace",
        },
      ]}
    />,
  );

  expect(view.getByText("Ada Lovelace")).toBeInTheDocument();
});

it("measures wrapped rows and applies the measured height back to data-pretable-row-height", async () => {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    borderBottomWidth: "1px",
    paddingBottom: "10px",
    paddingTop: "10px",
  } as CSSStyleDeclaration);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function scrollHeight(this: HTMLElement) {
      if (
        this instanceof HTMLElement &&
        this.dataset.pretableCell !== undefined &&
        this.textContent?.includes("Tall measurement target")
      ) {
        return 180;
      }

      return 22;
    },
  );

  const view = render(
    <Pretable
      ariaLabel="Messages"
      columns={[
        {
          id: "message",
          header: "Message",
          wrap: true,
        },
      ]}
      getRowId={(row) => row.id}
      rows={[
        {
          id: "row-0",
          message: "Tall measurement target",
        },
      ]}
    />,
  );

  const row = view.getByTestId("pretable-row");

  await waitFor(() => {
    expect(row).toHaveAttribute("data-pretable-row-height", "201");
  });
});

it("renders a scrollable viewport and virtualizes rows on scroll", async () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: `row-${index}`,
    message: `Row ${index}`,
  }));

  const view = render(
    <Pretable
      ariaLabel="Messages"
      columns={[
        {
          id: "message",
          header: "Message",
        },
      ]}
      getRowId={(row) => row.id}
      rows={rows}
    />,
  );

  const viewport = view.getByRole("grid", { name: "Messages" });

  expect(await view.findByText("Row 0")).toBeInTheDocument();
  expect(view.queryByText("Row 99")).not.toBeInTheDocument();

  fireEvent.scroll(viewport, {
    target: {
      scrollTop: 44 * 90,
    },
  });

  expect(await view.findByText("Row 90")).toBeInTheDocument();
});

it("uses caller-provided row ids in the public component path", () => {
  const rows = [
    {
      eventId: "evt-001",
      message: "First message",
    },
    {
      eventId: "evt-002",
      message: "Second message",
    },
  ];
  const view = render(
    <Pretable
      ariaLabel="Events"
      columns={[
        {
          id: "message",
          header: "Message",
        },
      ]}
      getRowId={(row) => row.eventId}
      rows={rows}
    />,
  );

  const renderedRows = view.getAllByTestId("pretable-row");

  expect(renderedRows[0]).toHaveAttribute("data-pretable-row-id", "evt-001");
  expect(renderedRows[1]).toHaveAttribute("data-pretable-row-id", "evt-002");
});

it("measures rendered row height from the tallest cell plus row chrome", () => {
  const row = document.createElement("div");
  row.innerHTML = `
    <div data-pretable-cell=""></div>
    <div data-pretable-cell=""></div>
  `;
  Object.defineProperty(row, "querySelectorAll", {
    configurable: true,
    value: () => [...row.children],
  });
  Object.defineProperty(row.children[0]!, "scrollHeight", {
    configurable: true,
    value: 84,
  });
  Object.defineProperty(row.children[1]!, "scrollHeight", {
    configurable: true,
    value: 120,
  });
  const origGetComputedStyle = window.getComputedStyle;
  Object.defineProperty(window, "getComputedStyle", {
    configurable: true,
    value: () =>
      ({
        paddingTop: "10px",
        paddingBottom: "10px",
        borderBottomWidth: "1px",
      }) satisfies Partial<CSSStyleDeclaration>,
  });

  try {
    expect(measureRenderedRowHeight(row)).toBe(141);
  } finally {
    Object.defineProperty(window, "getComputedStyle", {
      configurable: true,
      value: origGetComputedStyle,
    });
  }
});

it("measures the tallest cell even when another cell wraps", () => {
  const row = document.createElement("div");
  row.innerHTML = `
    <div data-pretable-cell="" data-pretable-wrap="true"></div>
    <div data-pretable-cell=""></div>
  `;
  Object.defineProperty(row, "querySelectorAll", {
    configurable: true,
    value: row.querySelectorAll.bind(row),
  });
  Object.defineProperty(row.children[0]!, "scrollHeight", {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(row.children[1]!, "scrollHeight", {
    configurable: true,
    value: 240,
  });
  const origGetComputedStyle = window.getComputedStyle;
  Object.defineProperty(window, "getComputedStyle", {
    configurable: true,
    value: () =>
      ({
        paddingTop: "10px",
        paddingBottom: "10px",
        borderBottomWidth: "1px",
      }) satisfies Partial<CSSStyleDeclaration>,
  });

  try {
    expect(measureRenderedRowHeight(row)).toBe(261);
  } finally {
    Object.defineProperty(window, "getComputedStyle", {
      configurable: true,
      value: origGetComputedStyle,
    });
  }
});

it("measures a wrapped cell's content via a Range, ignoring the stretched box", () => {
  // Cells flex-stretch to the row height, so `scrollHeight` reads the applied
  // box back (a feedback loop under streaming). The Range reports the true
  // content height instead, making the measurement idempotent.
  const row = document.createElement("div");
  row.innerHTML = `<div data-pretable-cell="" data-pretable-wrap="true"></div>`;
  const cell = row.children[0]!;
  Object.defineProperty(cell, "scrollHeight", {
    configurable: true,
    value: 999, // stretched-box readback — must be ignored
  });
  // Simulate a real layout engine (jsdom reports a zero-size box), so the
  // Range-based content path is taken instead of the jsdom scrollHeight path.
  Object.defineProperty(cell, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ width: 200, height: 56 }),
  });

  const origCreateRange = document.createRange;
  const origGetComputedStyle = window.getComputedStyle;
  Object.defineProperty(document, "createRange", {
    configurable: true,
    value: () => ({
      selectNodeContents() {},
      getBoundingClientRect: () => ({ height: 40 }),
    }),
  });
  Object.defineProperty(window, "getComputedStyle", {
    configurable: true,
    value: () =>
      ({
        paddingTop: "8px",
        paddingBottom: "8px",
        borderTopWidth: "0px",
        borderBottomWidth: "0px",
      }) satisfies Partial<CSSStyleDeclaration>,
  });

  try {
    // content 40 + cell padding 16 = 56 (NOT 999); row chrome +16 padding → 72.
    expect(measureRenderedRowHeight(row)).toBe(72);
  } finally {
    Object.defineProperty(document, "createRange", {
      configurable: true,
      value: origCreateRange,
    });
    Object.defineProperty(window, "getComputedStyle", {
      configurable: true,
      value: origGetComputedStyle,
    });
  }
});

it("exposes a public render model hook that reacts to grid viewport updates", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `row-${index}`,
    message: index === 0 ? "Short row" : `Row ${index}`,
  }));
  const column = createColumnHelper<(typeof rows)[number]>();
  const columns = [
    column.accessor("message", {
      header: "Message",
      type: "text",
      wrap: true,
      widthPx: 220,
    }),
  ] as const;
  const HookProbe = () => {
    const model = usePretable({
      columns,
      rows,
      viewportHeight: 88,
      overscan: 0,
    });

    useEffect(() => {
      model.grid.setViewport({
        scrollTop: 44 * 6,
        scrollLeft: 0,
        height: 88,
        width: 0,
      });
    }, [model.grid]);

    return (
      <output
        data-first-row-id={
          model.renderSnapshot.rows[0]?.ref.kind === "data"
            ? model.renderSnapshot.rows[0].ref.rowId
            : ""
        }
        data-rendered-row-ids={model.renderSnapshot.rows
          .map((row) =>
            row.ref.kind === "data" ? row.ref.rowId : row.ref.groupId,
          )
          .join(",")}
        data-rendered-row-count={model.renderSnapshot.rows.length}
        data-total-height={model.renderSnapshot.totalHeight}
        data-total-width={model.renderSnapshot.totalWidth}
        data-total-rows={model.rowModelSnapshot.sourceRowCount}
      />
    );
  };

  const view = render(<HookProbe />);
  const output = view.container.querySelector("output");

  expect(output).toHaveAttribute("data-total-rows", "12");
  expect(output).toHaveAttribute("data-total-width", "220");
  expect(output).toHaveAttribute("data-first-row-id", "row-4");
  expect(output).toHaveAttribute("data-rendered-row-ids", "row-4,row-5");
  expect(Number(output?.getAttribute("data-total-height"))).toBeGreaterThan(0);
  expect(Number(output?.getAttribute("data-rendered-row-count"))).toBe(2);
});

it("plans and reports visible rows from the provided body viewport height", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `row-${index}`,
    message: `Row ${index}`,
  }));
  const column = createColumnHelper<(typeof rows)[number]>();
  const columns = [
    column.accessor("message", { header: "Message", type: "text" }),
  ] as const;

  const HookProbe = () => {
    const model = usePretable({
      columns,
      rows,
      viewportHeight: 80,
      overscan: 0,
    });

    return (
      <output
        data-first-row-id={
          model.renderSnapshot.rows[0]?.ref.kind === "data"
            ? model.renderSnapshot.rows[0].ref.rowId
            : ""
        }
        data-rendered-row-count={model.renderSnapshot.rows.length}
        data-visible-row-count={model.renderSnapshot.rows.length}
        data-visible-row-range={`${model.renderSnapshot.rows[0]?.rowIndex ?? 0}:${(model.renderSnapshot.rows.at(-1)?.rowIndex ?? -1) + 1}`}
      />
    );
  };

  const view = render(<HookProbe />);
  const output = view.container.querySelector("output");

  expect(output).toHaveAttribute("data-first-row-id", "row-0");
  expect(output).toHaveAttribute("data-rendered-row-count", "2");
  expect(output).toHaveAttribute("data-visible-row-count", "2");
  expect(output).toHaveAttribute("data-visible-row-range", "0:2");
});

interface Row {
  readonly id: string;
  readonly name: string;
}

it("reports query changes without the caller controlling the query", async () => {
  const onQueryChange = vi.fn();
  const columns = [
    {
      id: "name",
      header: "Name",
      value: (row: Row) => row.name,
      type: "text",
    },
  ] as const;

  const view = render(
    <Pretable
      ariaLabel="Observed grid"
      rows={[{ id: "a", name: "Ada" }, { id: "b", name: "Grace" }]}
      columns={columns}
      getRowId={(row) => row.id}
      onQueryChange={onQueryChange}
    />,
  );

  fireEvent.click(view.getByRole("columnheader", { name: /name/i }));

  await waitFor(() => expect(onQueryChange).toHaveBeenCalled());
  const query = onQueryChange.mock.calls.at(-1)?.[0];
  expect(query.sort).toHaveLength(1);
  expect(query.sort[0].columnId).toBe("name");
});

// REMOVED: "does not reorder rows locally when sort authority is external".
//
// It passed, and it proved nothing. Deleting `processing={{ filter:
// "external", sort: "external" }}` from that test left it passing, because
// under jsdom a sort-header click does not reorder the rendered rows under
// EITHER authority -- verified with rows in an order no sort direction
// preserves (Grace, Ada, Mary). The assertion could therefore never
// distinguish external authority from engine authority.
//
// The claim is real and worth covering (design D1-GRID-02: no local
// re-application under external authority), but it needs a browser, where
// rows actually reorder. `apps/bench/tests/` is where that belongs. The two
// aria-rowcount tests below DO discriminate -- each was mutation-proved.

it("publishes the server's population through aria-rowcount under full external authority", () => {
  const columns = [
    {
      id: "name",
      header: "Name",
      value: (row: Row) => row.name,
      type: "text",
    },
  ] as const;

  const view = render(
    <Pretable
      ariaLabel="Observed grid"
      rows={[{ id: "a", name: "Ada" }]}
      columns={columns}
      getRowId={(row) => row.id}
      processing={{ filter: "external", sort: "external" }}
      resultMeta={{ total: { kind: "exact", count: 10_432 } }}
      onQueryChange={() => undefined}
    />,
  );

  const viewport = view.container.querySelector(
    "[data-pretable-scroll-viewport]",
  );
  expect(viewport).toHaveAttribute("aria-rowcount", "10433");
});

it("downgrades aria-rowcount and warns when the total claims fewer records than are loaded", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const columns = [
    {
      id: "name",
      header: "Name",
      value: (row: Row) => row.name,
      type: "text",
    },
  ] as const;

  const view = render(
    <Pretable
      ariaLabel="Observed grid"
      rows={[
        { id: "a", name: "Ada" },
        { id: "b", name: "Grace" },
      ]}
      columns={columns}
      getRowId={(row) => row.id}
      processing={{ filter: "external", sort: "external" }}
      resultMeta={{ total: { kind: "exact", count: 1 } }}
      onQueryChange={() => undefined}
    />,
  );

  const viewport = view.container.querySelector(
    "[data-pretable-scroll-viewport]",
  );
  expect(viewport).toHaveAttribute("aria-rowcount", "3");
  expect(warnSpy).toHaveBeenCalled();
});

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { App } from "../app";

afterEach(() => {
  cleanup();
});

describe("<App />", () => {
  test("renders Nav with primary links and version string", () => {
    render(<App />);

    // Nav's header landmark.
    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();

    // Primary nav links (post-website-pivot LINKS: pretable/bench/docs/github).
    // The "playground" link was retired when @pretable/ui's Nav swapped to a
    // website home tab; playground is being retired in Phase 3 of the pivot.
    // <Nav active="playground"> still typechecks but no link is highlighted.
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primaryNav).getByText("pretable")).toBeInTheDocument();
    expect(within(primaryNav).getByText("bench")).toBeInTheDocument();
    expect(within(primaryNav).getByText("docs")).toBeInTheDocument();
  });

  test("renders Footer with a ci status dot and a version string", () => {
    render(<App />);

    // Footer is a contentinfo landmark (HTMLFooter element)
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(/pretable/i);
    expect(footer).toHaveTextContent(/ci:/i);
  });

  test("renders a <main> landmark containing the page body", () => {
    render(<App />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  test("renders sections in order inside <main>: hero → grid → streaming → receipts", () => {
    render(<App />);
    const main = screen.getByRole("main");

    const h1 = within(main).getByRole("heading", { level: 1 });
    const grid = main.querySelector("#grid");
    const streamingHeading = within(main).getByRole("heading", {
      name: /stream.*tokens/i,
    });
    const receiptsHeading = within(main).getByRole("heading", {
      name: /receipts.*not claims/i,
    });

    expect(h1).toBeInTheDocument();
    expect(grid).toBeInTheDocument();
    expect(streamingHeading).toBeInTheDocument();
    expect(receiptsHeading).toBeInTheDocument();

    const all = Array.from(main.querySelectorAll("*"));
    const positions = {
      h1: all.indexOf(h1),
      grid: all.indexOf(grid as Element),
      streaming: all.indexOf(streamingHeading),
      receipts: all.indexOf(receiptsHeading),
    };

    expect(positions.h1).toBeLessThan(positions.grid);
    expect(positions.grid).toBeLessThan(positions.streaming);
    expect(positions.streaming).toBeLessThan(positions.receipts);
  });

  test("no InspectionDemo-era status card or sidebar is rendered", () => {
    render(<App />);
    // These testids used to live in InspectionDemo.
    expect(
      screen.queryByTestId("inspection-diagnostics"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("inspection-detail")).not.toBeInTheDocument();
  });
});

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { App } from "../app";

afterEach(() => {
  cleanup();
});

describe("<App />", () => {
  test("renders Nav with playground active and version string", () => {
    render(<App />);

    // Nav's header landmark.
    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();

    // Primary nav links (from @pretable/ui's LINKS: playground/bench/docs/github)
    const primaryNav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primaryNav).getByText("playground")).toBeInTheDocument();
    expect(within(primaryNav).getByText("bench")).toBeInTheDocument();

    // Active link carries "active" on the anchor
    const active = within(primaryNav).getByText("playground").closest("a");
    expect(active).toHaveClass("active");
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

  test("renders the three section components in order inside <main>", () => {
    render(<App />);
    const main = screen.getByRole("main");

    // hero h1 appears before receipts h2; grid section has id="grid"
    const h1 = within(main).getByRole("heading", { level: 1 });
    const h2 = within(main).getByRole("heading", { level: 2 });
    const grid = main.querySelector("#grid");

    expect(h1).toBeInTheDocument();
    expect(h2).toBeInTheDocument();
    expect(grid).toBeInTheDocument();

    // DOM order: h1 (hero) → grid section → h2 (receipts)
    const h1Pos = Array.from(main.querySelectorAll("*")).indexOf(h1);
    const gridPos = Array.from(main.querySelectorAll("*")).indexOf(
      grid as Element,
    );
    const h2Pos = Array.from(main.querySelectorAll("*")).indexOf(h2);

    expect(h1Pos).toBeLessThan(gridPos);
    expect(gridPos).toBeLessThan(h2Pos);
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

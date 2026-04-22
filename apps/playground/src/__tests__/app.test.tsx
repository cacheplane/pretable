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

    // Nav's header landmark
    // Note: Multiple headers may exist in the rendered output; find the one with banner role
    // that contains the Primary nav
    const headers = screen.getAllByRole("banner");
    const header = headers.find((h) => h.querySelector('nav[aria-label="Primary"]'));
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
});

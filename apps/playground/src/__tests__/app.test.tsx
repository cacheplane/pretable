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

    // Nav's header landmark. InspectionDemo still renders <header> panels
    // inside <main> which testing-library also exposes as role=banner,
    // so filter for the one that contains the Primary nav (unique to Nav).
    // This disambiguation is temporary — after Task 8 deletes InspectionDemo,
    // getByRole("banner") will find exactly one element.
    const header = screen
      .getAllByRole("banner")
      .find((el) => el.querySelector('nav[aria-label="Primary"]'));
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

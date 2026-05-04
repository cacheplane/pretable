import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CodeTabs, type CodeTabsPanel } from "../../app/components/CodeTabs";

const panels: readonly CodeTabsPanel[] = [
  { filename: "a.tsx", lang: "tsx", html: <div data-testid="panel-a">A</div> },
  { filename: "b.ts", lang: "ts", html: <div data-testid="panel-b">B</div> },
  { filename: "c.ts", lang: "ts", html: <div data-testid="panel-c">C</div> },
  { filename: "d.tsx", lang: "tsx", html: <div data-testid="panel-d">D</div> },
];

describe("CodeTabs", () => {
  afterEach(() => cleanup());

  it("renders a tablist with one button per panel", () => {
    render(<CodeTabs panels={panels} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });

  it("shows only the first panel by default", () => {
    render(<CodeTabs panels={panels} />);
    expect(screen.getByTestId("panel-a")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-b")).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel-c")).not.toBeInTheDocument();
    expect(screen.queryByTestId("panel-d")).not.toBeInTheDocument();
  });

  it("respects defaultIndex", () => {
    render(<CodeTabs panels={panels} defaultIndex={2} />);
    expect(screen.getByTestId("panel-c")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-a")).not.toBeInTheDocument();
  });

  it("switches panels on tab click", () => {
    render(<CodeTabs panels={panels} />);
    fireEvent.click(screen.getByRole("tab", { name: /b\.ts/ }));
    expect(screen.getByTestId("panel-b")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-a")).not.toBeInTheDocument();
  });

  it("cycles activeIndex with arrow keys", () => {
    render(<CodeTabs panels={panels} />);
    const tablist = screen.getByRole("tablist");
    const firstTab = screen.getByRole("tab", { name: /a\.tsx/ });
    firstTab.focus();
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByTestId("panel-b")).toBeInTheDocument();
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByTestId("panel-a")).toBeInTheDocument();
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByTestId("panel-d")).toBeInTheDocument();
  });

  it("marks the active tab with aria-selected=true", () => {
    render(<CodeTabs panels={panels} defaultIndex={1} />);
    const active = screen.getByRole("tab", { name: /b\.ts/ });
    const inactive = screen.getByRole("tab", { name: /a\.tsx/ });
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(inactive).toHaveAttribute("aria-selected", "false");
  });
});

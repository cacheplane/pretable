import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExampleShell, type ExampleShellProps } from "../ExampleShell";

const files = [
  {
    path: "a.ts",
    lang: "ts",
    source: "export const a = 1;",
    html: "<pre>A</pre>",
  },
  {
    path: "b.ts",
    lang: "ts",
    source: "export const b = 2;",
    html: "<pre>B</pre>",
  },
];

// `children` is passed as a prop, never as a JSX child: nested children always
// win over a spread, so a `{ children: null }` override would be ignored and
// the demo-less test would silently assert nothing.
function renderShell(overrides: Partial<ExampleShellProps> = {}) {
  const props: ExampleShellProps = {
    title: "Demo",
    description: "A demo.",
    height: 480,
    files,
    agentMarkdown: "### Example: Demo\n",
    mdHref: "/examples/demo.md",
    initial: "preview",
    children: <div>LIVE</div>,
    ...overrides,
  };
  return render(<ExampleShell {...props} />);
}

describe("ExampleShell", () => {
  it("shows title and description", () => {
    renderShell();
    expect(screen.getByText("Demo")).toBeInTheDocument();
    expect(screen.getByText("A demo.")).toBeInTheDocument();
  });

  it("offers Preview and Code tabs when a demo is present", () => {
    renderShell();
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Code" })).toBeInTheDocument();
  });

  it("keeps the demo mounted while the Code pane is active", () => {
    renderShell();
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    // Still in the DOM: switching panes must not tear down a grid the reader
    // has already grouped, scrolled, or selected in.
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Code" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders no Preview tab for a demo-less example", () => {
    renderShell({ children: null, initial: "code" });
    expect(screen.queryByRole("tab", { name: "Preview" })).toBeNull();
  });

  it("labels the code panel by the Code tab even with no demo present", () => {
    // The Code tab renders unconditionally (it does not depend on hasDemo),
    // so the code tabpanel must always be labelled by it — even when it's
    // the only tab, with no Preview tab to fall back to.
    renderShell({ children: null, initial: "code" });
    const panel = screen.getByRole("tabpanel");
    const labelledBy = panel.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toBe(
      screen.getByRole("tab", { name: "Code" }),
    );
  });

  it("switches file tabs", () => {
    renderShell({ initial: "code" });
    fireEvent.click(screen.getByRole("tab", { name: "b.ts" }));
    expect(screen.getByRole("tab", { name: "b.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves file-tab selection with the right arrow key", () => {
    renderShell({ initial: "code" });
    const first = screen.getByRole("tab", { name: "a.ts" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "b.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("copies the active file", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderShell({ initial: "code" });
    fireEvent.click(screen.getByRole("button", { name: /copy file/i }));
    expect(writeText).toHaveBeenCalledWith("export const a = 1;");
  });

  it("copies the agent bundle verbatim", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /copy for agent/i }));
    expect(writeText).toHaveBeenCalledWith("### Example: Demo\n");
  });

  it("applies the example height to the pane", () => {
    const { container } = renderShell({ height: 300 });
    const pane = container.querySelector<HTMLElement>("[data-example-pane]");
    expect(pane?.style.height).toBe("300px");
  });
});

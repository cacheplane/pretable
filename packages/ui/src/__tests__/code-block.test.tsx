import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { CodeBlock } from "../code-block";

describe("CodeBlock", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a single snippet with a language label and copy button", () => {
    render(
      <CodeBlock label="bash">
        <span>npm install @pretable/react</span>
      </CodeBlock>,
    );
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(screen.getByText("npm install @pretable/react")).toBeInTheDocument();
  });

  it("renders a row of tabs and shows only the active tab's content", () => {
    render(
      <CodeBlock
        tabs={[
          { label: "npm", content: "npm install @pretable/react" },
          { label: "pnpm", content: "pnpm add @pretable/react" },
        ]}
      />,
    );
    expect(screen.getByText("npm")).toHaveClass("pt-code-tab", "active");
    expect(screen.getByText("pnpm")).toHaveClass("pt-code-tab");
    expect(screen.getByText("pnpm")).not.toHaveClass("active");
    expect(screen.getByText("npm install @pretable/react")).toBeInTheDocument();
    expect(
      screen.queryByText("pnpm add @pretable/react"),
    ).not.toBeInTheDocument();
  });

  it("switches tabs on click and updates active content", () => {
    render(
      <CodeBlock
        tabs={[
          { label: "npm", content: "npm install X" },
          { label: "pnpm", content: "pnpm add X" },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("pnpm"));
    expect(screen.getByText("pnpm add X")).toBeInTheDocument();
    expect(screen.queryByText("npm install X")).not.toBeInTheDocument();
    expect(screen.getByText("pnpm")).toHaveClass("active");
  });

  it("copies the visible snippet to the clipboard when the copy button is clicked", async () => {
    render(<CodeBlock label="shell">npm install @pretable/react</CodeBlock>);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "npm install @pretable/react",
    );
  });
});

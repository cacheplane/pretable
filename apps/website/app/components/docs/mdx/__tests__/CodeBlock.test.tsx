import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CodeBlock } from "../CodeBlock";

describe("CodeBlock", () => {
  it("renders children and a copy button inside the header bar", () => {
    render(
      <CodeBlock raw="const x = 1;">
        <code>const x = 1;</code>
      </CodeBlock>,
    );
    const button = screen.getByRole("button", { name: /copy/i });
    expect(button).toBeInTheDocument();
    // Not floating over the code: the header bar contains both the button
    // and (when present) the filename, as a single row above the code — see
    // the design doc's "copy moves into the header bar" decision.
    expect(button.className).not.toContain("absolute");
  });

  it("writes raw to clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <CodeBlock raw="hello">
        <code>hello</code>
      </CodeBlock>,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("shows the filename in the header when one is supplied", () => {
    render(
      <CodeBlock raw="const x = 1;" filename="brand.css">
        <code>const x = 1;</code>
      </CodeBlock>,
    );
    expect(screen.getByText("brand.css")).toBeInTheDocument();
  });

  it("still renders a header bar (for Copy) when no filename is supplied", () => {
    // The bar must never show a bare, meaningless label — but it must also
    // never disappear, since Copy has to live somewhere other than floating
    // over the code. An untitled fence: bar present, identity blank.
    const { container } = render(
      <CodeBlock raw="const x = 1;">
        <code>const x = 1;</code>
      </CodeBlock>,
    );
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    // No language tag anywhere in the header — the exact "nothing worth its
    // space" case the design doc calls out.
    expect(container.textContent).not.toMatch(/^(TS|TSX|JS|JSX|CSS|BASH)$/i);
  });
});

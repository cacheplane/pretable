import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CodeSurface } from "../CodeSurface";

describe("CodeSurface", () => {
  it("shows the filename and a non-floating Copy button (fence variant)", () => {
    render(
      <CodeSurface raw="a" filename="brand.css" variant="fence" showCopy>
        <code>a</code>
      </CodeSurface>,
    );
    expect(screen.getByText("brand.css")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /copy/i });
    expect(button.className).not.toContain("absolute");
  });

  it("still renders a header bar when no filename is supplied", () => {
    render(
      <CodeSurface raw="a" variant="fence" showCopy>
        <code>a</code>
      </CodeSurface>,
    );
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("does not render a Copy button when showCopy is false (example variant)", () => {
    render(
      <CodeSurface raw="a" filename="a.ts" variant="example">
        <pre>a</pre>
      </CodeSurface>,
    );
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });

  it("writes raw to clipboard when Copy is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <CodeSurface raw="hello" variant="fence" showCopy>
        <code>hello</code>
      </CodeSurface>,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith("hello");
  });
});

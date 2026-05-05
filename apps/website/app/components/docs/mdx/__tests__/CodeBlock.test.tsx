import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CodeBlock } from "../CodeBlock";

describe("CodeBlock", () => {
  it("renders children pre and a copy button", () => {
    render(
      <CodeBlock raw="const x = 1;">
        <code>const x = 1;</code>
      </CodeBlock>,
    );
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
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
});

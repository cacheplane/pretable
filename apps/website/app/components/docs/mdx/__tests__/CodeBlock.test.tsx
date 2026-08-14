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

  it("wraps the code in a <pre>, so indentation survives", () => {
    // `MdxRenderer`'s `Pre` mapping drops rehype-pretty-code's `<pre>` and
    // hands `CodeBlock` the bare `<code>`. Nothing else supplies
    // `white-space: pre`, and because that `<code>` is `display: grid` the
    // lines still break — so a collapsed indent is invisible to any assertion
    // about line count or text content. Assert the element itself.
    //
    // jsdom applies no UA stylesheet arithmetic worth trusting here, so this
    // deliberately checks the TAG rather than a computed style: the tag is
    // what carries `white-space: pre` in a real browser, and it is the thing
    // that regressed. `apps/website/e2e` covers the rendered geometry.
    const { container } = render(
      <CodeBlock raw={"const a = 1;\n  const b = 2;"}>
        <code>{"const a = 1;\n  const b = 2;"}</code>
      </CodeBlock>,
    );
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.querySelector("code")).not.toBeNull();
  });

  it("shows the filename in the header when one is supplied", () => {
    render(
      <CodeBlock raw="const x = 1;" filename="brand.css" language="css">
        <code>const x = 1;</code>
      </CodeBlock>,
    );
    expect(screen.getByText("brand.css")).toBeInTheDocument();
    // A real name beats the language: the tag must not tag along beside it.
    expect(screen.queryByText(/^css$/i)).toBeNull();
  });

  // The header used to render its identity side blank for an untitled fence,
  // on the design doc's "a lone language tag is nothing worth its space"
  // call. That call assumed some fences would be titled; none were (0 of
  // 139), so in practice the bar was empty on every page in the docs. The
  // decision is now titles where practicable, falling back to the language —
  // see the design doc's "identity in the header" section.
  it("falls back to the language tag when no filename is supplied", () => {
    render(
      <CodeBlock raw="const x = 1;" language="tsx">
        <code>const x = 1;</code>
      </CodeBlock>,
    );
    // Scoped to the header, not the whole container: the code body of a real
    // fence can contain the language's own name (`import ... from "tsx"`),
    // which would make a container-wide text assertion pass for the wrong
    // reason.
    const header = screen
      .getByRole("button", { name: /copy/i })
      .closest("div")!;
    expect(header).toHaveTextContent(/^tsx/i);
  });

  it("keeps the header bar, without a tag, for a language that names nothing", () => {
    // A `text` fence has no language to report; "TEXT" would be the empty bar
    // again with extra ink. Copy still needs somewhere to live that isn't
    // floating over the code, so the bar itself stays.
    render(
      <CodeBlock raw="hello" language="text">
        <code>hello</code>
      </CodeBlock>,
    );
    const copy = screen.getByRole("button", { name: /copy/i });
    expect(copy).toBeInTheDocument();
    expect(copy.closest("div")!).not.toHaveTextContent(/text/i);
  });
});

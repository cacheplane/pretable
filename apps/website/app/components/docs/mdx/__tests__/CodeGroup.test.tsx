import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodeGroup } from "../CodeGroup";

/**
 * Keyboard, roving tabindex and aria wiring — the things jsdom is good at.
 *
 * The label assertions here are NOT the proof that labelling works. `Surface`
 * below reproduces the serialised child shape by hand, so these tests can only
 * confirm that `codeIdentity` reads the shape this file assumes; if the
 * assumption were wrong they would stay green while the page broke. That is
 * not hypothetical — `<Tabs>` shipped exactly that failure (see the note on
 * `isTab` in `../Tabs.tsx`).
 *
 * What checks the assumption is `e2e/docs-code-group.spec.ts` against
 * `/fixtures/code-group`, which compiles real MDX through the real server
 * components and therefore builds the real boundary. Keep that spec in mind
 * before "simplifying" the shape below to match whatever the component
 * currently reads.
 */

/**
 * What `MdxRenderer`'s `figure` → `Figure` → `Pre` → `CodeBlock` chain
 * actually delivers to a client component: a host `<figure>` wrapping a code
 * surface that carries `language` (and `filename`, when the fence had a
 * `title="…"`). Notably NOT `data-language` on the child's own props, which is
 * what this component used to read and why every tab said "tab N".
 */
function Surface({
  language,
  filename,
  children,
}: {
  language?: string;
  filename?: string;
  children: React.ReactNode;
}) {
  return <pre data-lang={language ?? filename}>{children}</pre>;
}

function fence(language: string, body: string, filename?: string) {
  return (
    <figure className="my-6">
      <Surface language={language} filename={filename}>
        <code>{body}</code>
      </Surface>
    </figure>
  );
}

const tabs = () => screen.getAllByRole("tab");

describe("CodeGroup", () => {
  it("labels tabs from the wrapped surface's language and switches panels", () => {
    render(
      <CodeGroup>
        {fence("ts", "ts-source")}
        {fence("js", "js-source")}
      </CodeGroup>,
    );
    expect(tabs().map((t) => t.textContent)).toEqual(["ts", "js"]);
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("ts-source")).toBeInTheDocument();
    fireEvent.click(tabs()[1]);
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("js-source")).toBeInTheDocument();
  });

  it("prefers a fence's title over its language", () => {
    render(<CodeGroup>{fence("css", "brand-source", "brand.css")}</CodeGroup>);
    expect(tabs()[0]).toHaveTextContent("brand.css");
  });

  it("falls back to an ordinal when there is no identity to read", () => {
    render(
      <CodeGroup>
        <div>bare</div>
        <div>bare</div>
      </CodeGroup>,
    );
    // Deliberately not invented: with nothing naming the panel, an ordinal is
    // the honest label. This is what EVERY tab used to say.
    expect(tabs().map((t) => t.textContent)).toEqual(["tab 1", "tab 2"]);
  });

  it("gives the tablist exactly one tab stop, on the selected tab", () => {
    render(
      <CodeGroup>
        {fence("ts", "a")}
        {fence("js", "b")}
        {fence("css", "c")}
      </CodeGroup>,
    );
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.click(tabs()[2]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("moves selection with the arrow keys and Home/End", () => {
    render(
      <CodeGroup>
        {fence("ts", "a")}
        {fence("js", "b")}
        {fence("css", "c")}
      </CodeGroup>,
    );
    fireEvent.keyDown(tabs()[0], { key: "ArrowRight" });
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[1]).toHaveFocus();

    fireEvent.keyDown(tabs()[1], { key: "End" });
    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0]);

    // Wraps rather than dead-ending.
    fireEvent.keyDown(tabs()[2], { key: "ArrowRight" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tabs()[0], { key: "End" });
    fireEvent.keyDown(tabs()[2], { key: "Home" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[0]).toHaveFocus();
  });

  it("wires each tab to the panel it controls", () => {
    render(
      <CodeGroup>
        {fence("ts", "a")}
        {fence("js", "b")}
      </CodeGroup>,
    );
    const panel = screen.getByRole("tabpanel");
    for (const t of tabs()) {
      expect(t).toHaveAttribute("aria-controls", panel.id);
    }
    expect(panel).toHaveAttribute("aria-labelledby", tabs()[0].id);
  });
});

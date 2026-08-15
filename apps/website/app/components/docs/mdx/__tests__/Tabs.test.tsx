import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tab, Tabs } from "../Tabs";

/**
 * Note what these tests cannot see. jsdom has no React Server Components
 * boundary, so a `<Tab>` here is this module's own function and the identity
 * check `<Tabs>` used to do (`child.type === Tab`) held — which is why this
 * file passed all the way through a period when `<Tabs>` rendered a
 * completely empty tablist on the real `/docs/streaming` page. It also cannot
 * model Safari's sequential-focus policy, so "is this reachable by Tab" is
 * unanswerable here.
 *
 * Both of those live in `e2e/docs-tabs-keyboard.spec.ts`, against the built
 * site in chromium and webkit. What is worth pinning here is the roving
 * bookkeeping itself: which tab carries `tabindex="0"`, and what each key
 * does to selection.
 */
function renderTabs() {
  return render(
    <Tabs>
      <Tab label="One">body-one</Tab>
      <Tab label="Two">body-two</Tab>
      <Tab label="Three">body-three</Tab>
    </Tabs>,
  );
}

const tabs = () => screen.getAllByRole("tab");

describe("Tabs", () => {
  it("shows first tab by default and switches on click", () => {
    renderTabs();
    expect(screen.getByText("body-one")).toBeInTheDocument();
    expect(screen.queryByText("body-two")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByText("body-two")).toBeInTheDocument();
  });

  it("gives the tablist exactly one tab stop, on the selected tab", () => {
    renderTabs();
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.click(screen.getByRole("tab", { name: "Three" }));
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("moves selection with the arrow keys, wrapping at both ends", () => {
    renderTabs();
    fireEvent.keyDown(tabs()[0], { key: "ArrowRight" });
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[1]).toHaveFocus();
    expect(screen.getByText("body-two")).toBeInTheDocument();

    fireEvent.keyDown(tabs()[1], { key: "ArrowLeft" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");

    // Wrap, rather than dead-ending on the first tab.
    fireEvent.keyDown(tabs()[0], { key: "ArrowLeft" });
    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tabs()[2], { key: "ArrowRight" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("jumps to the ends with Home and End", () => {
    renderTabs();
    fireEvent.keyDown(tabs()[0], { key: "End" });
    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[2]).toHaveFocus();

    fireEvent.keyDown(tabs()[2], { key: "Home" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[0]).toHaveFocus();
  });

  it("leaves keys it does not own alone", () => {
    renderTabs();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    tabs()[0].dispatchEvent(event);
    // Not swallowed: a horizontal tablist must not eat the page's scroll key.
    expect(event.defaultPrevented).toBe(false);
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("wires each tab to the panel it controls", () => {
    renderTabs();
    const panel = screen.getByRole("tabpanel");
    for (const t of tabs()) {
      expect(t).toHaveAttribute("aria-controls", panel.id);
    }
    expect(panel).toHaveAttribute("aria-labelledby", tabs()[0].id);
    fireEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      tabs()[1].id,
    );
  });

  it("gives two groups on one page distinct ids", () => {
    render(
      <>
        <Tabs>
          <Tab label="One">a</Tab>
        </Tabs>
        <Tabs>
          <Tab label="One">b</Tab>
        </Tabs>
      </>,
    );
    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(2);
    expect(panels[0].id).not.toBe(panels[1].id);
  });

  it("matches children by their label prop, not by component identity", () => {
    // The shape that broke on the real site: across the RSC boundary a
    // `<Tab>` child arrives with a `type` that is a client reference rather
    // than this module's `Tab`, while its props survive intact. A stand-in
    // component with the same props stands for that here — the point being
    // that `<Tabs>` must not care what the child's `type` is.
    function ForeignTab(props: { label: string; children: React.ReactNode }) {
      return <>{props.children}</>;
    }
    render(
      <Tabs>
        <ForeignTab label="Alien">alien-body</ForeignTab>
      </Tabs>,
    );
    expect(screen.getByRole("tab", { name: "Alien" })).toBeInTheDocument();
    expect(screen.getByText("alien-body")).toBeInTheDocument();
  });

  it("renders nothing when it has no tabs to show", () => {
    render(
      <Tabs>
        <p>stray</p>
      </Tabs>,
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});

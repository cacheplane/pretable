import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExampleShell, type ExampleShellProps } from "../ExampleShell";

// Firing IntersectionObserver so useInView's one-shot "in view" latch
// resolves synchronously in tests, matching the pattern already used by
// app/components/__tests__/ScaleGrid.test.tsx and useInView.test.ts.
class FiringIO {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe = () => {
    this.cb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  };
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}

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
function shellProps(
  overrides: Partial<ExampleShellProps> = {},
): ExampleShellProps {
  return {
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
}

function renderShell(overrides: Partial<ExampleShellProps> = {}) {
  return render(<ExampleShell {...shellProps(overrides)} />);
}

// Flushes `copy()`'s `await navigator.clipboard.writeText(...)` microtask —
// independent of the fake clock, which only controls setTimeout/clearTimeout
// — and then lets the fake clock process a 0ms tick, which is what actually
// commits the resulting state update into the DOM under fake timers. Needed
// after every click or timer advance that triggers a `setCopied` call in the
// tests below that use `vi.useFakeTimers()`.
async function flushCopyState() {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

describe("ExampleShell", () => {
  const originalIO = globalThis.IntersectionObserver;
  beforeEach(() => {
    globalThis.IntersectionObserver =
      FiringIO as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = originalIO;
    vi.useRealTimers();
  });

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

  it("moves file-tab selection with Home and End", () => {
    renderShell({ initial: "code" });
    const first = screen.getByRole("tab", { name: "a.ts" });
    const second = screen.getByRole("tab", { name: "b.ts" });
    second.focus();
    fireEvent.keyDown(second, { key: "Home" });
    expect(first).toHaveAttribute("aria-selected", "true");
    first.focus();
    fireEvent.keyDown(first, { key: "End" });
    expect(second).toHaveAttribute("aria-selected", "true");
  });

  // Regression test for the keyboard-unreachable Code tab: roving tabindex
  // was applied to the view tabs, but the arrow-key handler was wired only
  // to the file tabs, so the unselected view tab was neither Tab-reachable
  // nor arrow-reachable.
  it("gives only the selected view tab a positive tabIndex (roving tabindex)", () => {
    renderShell();
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Code" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByRole("tab", { name: "Code" })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("moves view-tab selection with the right arrow key, reaching Code", () => {
    renderShell();
    const preview = screen.getByRole("tab", { name: "Preview" });
    preview.focus();
    fireEvent.keyDown(preview, { key: "ArrowRight" });
    const code = screen.getByRole("tab", { name: "Code" });
    expect(code).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(code);
  });

  it("moves view-tab selection with Home and End", () => {
    renderShell();
    const preview = screen.getByRole("tab", { name: "Preview" });
    const code = screen.getByRole("tab", { name: "Code" });
    preview.focus();
    fireEvent.keyDown(preview, { key: "End" });
    expect(code).toHaveAttribute("aria-selected", "true");
    code.focus();
    fireEvent.keyDown(code, { key: "Home" });
    expect(preview).toHaveAttribute("aria-selected", "true");
  });

  // Marking an ancestor `inert` forcibly blurs any focus still inside it, so
  // a reader who clicks Code while focus is inside the demo would otherwise
  // land on document.body with no way back in via keyboard.
  it("focuses the newly selected view tab on click", () => {
    renderShell();
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Code" }),
    );
  });

  it("makes only the inactive pane inert and aria-hidden", () => {
    renderShell();
    const previewTab = screen.getByRole("tab", { name: "Preview" });
    const codeTab = screen.getByRole("tab", { name: "Code" });
    const previewPane = document.getElementById(
      previewTab.getAttribute("aria-controls")!,
    )!;
    const codePane = document.getElementById(
      codeTab.getAttribute("aria-controls")!,
    )!;

    expect(previewPane).not.toHaveAttribute("inert");
    expect(previewPane).toHaveAttribute("aria-hidden", "false");
    expect(codePane).toHaveAttribute("inert");
    expect(codePane).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(codeTab);

    expect(previewPane).toHaveAttribute("inert");
    expect(previewPane).toHaveAttribute("aria-hidden", "true");
    expect(codePane).not.toHaveAttribute("inert");
    expect(codePane).toHaveAttribute("aria-hidden", "false");
  });

  it("does not collide ids across two examples on the same page", () => {
    render(
      <>
        <ExampleShell {...shellProps()} />
        <ExampleShell {...shellProps()} />
      </>,
    );
    const previewTabs = screen.getAllByRole("tab", { name: "Preview" });
    expect(previewTabs).toHaveLength(2);
    expect(previewTabs[0].id).not.toBe(previewTabs[1].id);

    // Each tab's aria-controls must resolve — via getElementById — to a
    // panel that is labelled by that SAME tab, not the other instance's
    // panel appropriated by an id collision.
    for (const tab of previewTabs) {
      const panelId = tab.getAttribute("aria-controls")!;
      const panel = document.getElementById(panelId)!;
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    }
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

  it("shows a distinct failure label when the clipboard API is unavailable", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /copy for agent/i }));
    // "Copy for agent" is a headline feature — a non-secure context (no
    // navigator.clipboard) must not fail silently.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /copy failed/i }),
      ).toBeInTheDocument(),
    );
    if (original) Object.defineProperty(navigator, "clipboard", original);
  });

  it("shows a distinct failure label when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.assign(navigator, { clipboard: { writeText } });
    renderShell({ initial: "code" });
    fireEvent.click(screen.getByRole("button", { name: /copy file/i }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /copy failed/i }),
      ).toBeInTheDocument(),
    );
  });

  it("does not let an earlier copy's timeout clear a later copy's confirmation", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderShell({ initial: "code" });

    // Captured up front: each button's accessible name changes to "Copied"
    // once clicked, so re-querying by name (/copy file/i) after that point
    // would fail to find it. Hold stable element references instead.
    const fileBtn = screen.getByRole("button", { name: /copy file/i });
    const agentBtn = screen.getByRole("button", { name: /copy for agent/i });

    fireEvent.click(fileBtn);
    await flushCopyState();
    expect(fileBtn).toHaveTextContent("Copied");

    // 1.9s later — just before the file button's own 2s reset — copy a
    // second thing. Without owning the timeout in a ref and clearing it up
    // front, the FIRST timer is still armed and fires 100ms from now.
    await vi.advanceTimersByTimeAsync(1900);
    fireEvent.click(agentBtn);
    await flushCopyState();
    expect(agentBtn).toHaveTextContent("Copied");

    // The moment the first (unowned) timer would have fired: it must not
    // wipe the second button's confirmation out from under it.
    await vi.advanceTimersByTimeAsync(100);
    expect(agentBtn).toHaveTextContent("Copied");

    // The second copy's own timer still fires on its own schedule (a little
    // past the exact 2s mark, to avoid a flaky exact-boundary comparison).
    // The timer callback's `setCopied(null)` needs the same flush as the
    // click-triggered updates above before it reaches the DOM.
    await vi.advanceTimersByTimeAsync(1950);
    await flushCopyState();
    expect(agentBtn).toHaveTextContent("Copy for agent");
  });

  it("applies the example height to the pane", () => {
    const { container } = renderShell({ height: 300 });
    const pane = container.querySelector<HTMLElement>("[data-example-pane]");
    expect(pane?.style.height).toBe("300px");
  });
});

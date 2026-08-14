import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodeSurface } from "../CodeSurface";

// jsdom doesn't implement ResizeObserver (see HeroGrid.tsx for the same
// gap) and never lays anything out, so scrollHeight/clientHeight are always
// 0. This mock fires its callback synchronously on `observe()`, which is
// enough for CodeSurface's one-shot initial measurement (its effect calls
// `measure()` directly before ever touching the observer) as long as
// scrollHeight/clientHeight are stubbed at the *prototype* level before
// render — instance-level stubs would arrive too late, since Testing
// Library flushes the initial layout effect synchronously inside render().
class FiringRO {
  constructor(private cb: ResizeObserverCallback) {}
  observe = (target: Element) => {
    this.cb(
      [{ target } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  };
  unobserve = vi.fn();
  disconnect = vi.fn();
}

function stubScrollMetrics(scrollHeight: number, clientHeight: number) {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
}

describe("CodeSurface", () => {
  const originalRO = globalThis.ResizeObserver;
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight",
  );
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );

  beforeEach(() => {
    globalThis.ResizeObserver = FiringRO as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    globalThis.ResizeObserver = originalRO;
    if (originalScrollHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollHeight",
        originalScrollHeight,
      );
    }
    if (originalClientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientHeight",
        originalClientHeight,
      );
    }
  });

  describe("fence variant", () => {
    it("shows the filename and a non-floating Copy button", () => {
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

    it("never shows a line count or expand control — fences have no height prop", () => {
      stubScrollMetrics(4000, 480); // would clearly "overflow" if measured
      render(
        <CodeSurface
          raw={Array(300).fill("x").join("\n")}
          variant="fence"
          showCopy
        >
          <code>code</code>
        </CodeSurface>,
      );
      expect(screen.queryByText(/lines$/)).toBeNull();
      expect(screen.queryByRole("button", { name: /expand/i })).toBeNull();
    });
  });

  describe("example variant, no height set", () => {
    it("renders no Copy button (that stays in ExampleShell's outer row)", () => {
      render(
        <CodeSurface raw="a" filename="a.ts" variant="example">
          <pre>a</pre>
        </CodeSurface>,
      );
      expect(screen.getByText("a.ts")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    });
  });

  describe("example variant, height set (truncation)", () => {
    it("shows no fade, line count, or expand control when content fits", () => {
      stubScrollMetrics(400, 480); // content shorter than the box
      render(
        <CodeSurface raw="a\nb" filename="a.ts" variant="example" height={480}>
          <pre>short</pre>
        </CodeSurface>,
      );
      expect(screen.queryByText(/lines$/)).toBeNull();
      expect(screen.queryByRole("button", { name: /expand/i })).toBeNull();
    });

    it("shows the fade, line count, and Expand control when content overflows", () => {
      stubScrollMetrics(4000, 480);
      const onOverflowChange = vi.fn();
      const { container } = render(
        <CodeSurface
          raw={Array(200).fill("x").join("\n")}
          filename="brand.css"
          variant="example"
          height={480}
          onOverflowChange={onOverflowChange}
        >
          <pre>long</pre>
        </CodeSurface>,
      );

      expect(screen.getByText(/200 lines/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^expand$/i }),
      ).toBeInTheDocument();
      expect(
        container.querySelector('[aria-hidden="true"]'),
      ).toBeInTheDocument();
      expect(onOverflowChange).toHaveBeenCalledWith(true, expect.any(Number));
    });

    it("calls onToggleExpand when the Expand control is clicked", () => {
      stubScrollMetrics(4000, 480);
      const onToggleExpand = vi.fn();
      render(
        <CodeSurface
          raw={Array(200).fill("x").join("\n")}
          filename="brand.css"
          variant="example"
          height={480}
          onToggleExpand={onToggleExpand}
        >
          <pre>long</pre>
        </CodeSurface>,
      );

      fireEvent.click(screen.getByRole("button", { name: /^expand$/i }));
      expect(onToggleExpand).toHaveBeenCalledTimes(1);
    });

    it("keeps the Show less control (and line count) once expanded, even though the box now fits its content", () => {
      // Once `expanded` is true, the caller has already grown the ancestor
      // pane to fit, so the scroll region's own box grows to match its
      // content — scrollHeight === clientHeight, i.e. no longer
      // "overflowing" by the raw measurement. The control must not
      // disappear out from under an expanded reader.
      stubScrollMetrics(4000, 4000);
      const { container } = render(
        <CodeSurface
          raw={Array(200).fill("x").join("\n")}
          filename="brand.css"
          variant="example"
          height={480}
          expanded
        >
          <pre>long</pre>
        </CodeSurface>,
      );

      expect(
        screen.getByRole("button", { name: /show less/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/200 lines/)).toBeInTheDocument();
      // No fade once expanded — there's nothing left below the fold.
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });
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

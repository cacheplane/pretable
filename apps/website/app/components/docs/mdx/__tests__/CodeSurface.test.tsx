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

  // The header's own contents are the assertion target throughout: the code
  // body of a real surface routinely contains the same words as its identity
  // (a `.tsx` file importing from "tsx"), so a container-wide text query can
  // pass for entirely the wrong reason.
  function header(container: HTMLElement) {
    // The header is the surface's one bottom-ruled row; nothing else in the
    // component carries that border.
    return container.querySelector<HTMLElement>("div.border-b");
  }

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

    it("falls back to the language tag when no filename is supplied", () => {
      const { container } = render(
        <CodeSurface raw="a" language="tsx" variant="fence" showCopy>
          <code>a</code>
        </CodeSurface>,
      );
      expect(header(container)).toHaveTextContent(/^tsx/i);
      expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    });

    it("prefers a filename over the language when both are supplied", () => {
      const { container } = render(
        <CodeSurface
          raw="a"
          filename="brand.css"
          language="css"
          variant="fence"
          showCopy
        >
          <code>a</code>
        </CodeSurface>,
      );
      expect(header(container)).toHaveTextContent(/^brand\.css/);
      // Not "brand.css css" — the language would be noise beside a real name.
      expect(header(container)!.textContent).not.toMatch(/brand\.css\s*css/i);
    });

    it("draws the language tag as a quiet label, not as the filename", () => {
      // The two identities are different kinds of thing — a name is read as
      // written, a classification gets the small uppercase label treatment
      // this codebase uses elsewhere for exactly that. If they rendered
      // identically, the tag would read as a heading over the code.
      const { container: withLang } = render(
        <CodeSurface raw="a" language="tsx" variant="fence" showCopy>
          <code>a</code>
        </CodeSurface>,
      );
      const tag = header(withLang)!.firstElementChild!;
      expect(tag.className).toContain("uppercase");
      expect(tag.className).toContain("tracking-");
    });

    it("shows no tag for a language that names nothing, but keeps the bar", () => {
      const { container } = render(
        <CodeSurface raw="a" language="text" variant="fence" showCopy>
          <code>a</code>
        </CodeSurface>,
      );
      expect(header(container)).not.toHaveTextContent(/text/i);
      expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    });

    it("never clamps or fades — fences have no height prop", () => {
      stubScrollMetrics(4000, 480); // would clearly "overflow" if measured
      const { container } = render(
        <CodeSurface
          raw={Array(300).fill("x").join("\n")}
          language="ts"
          variant="fence"
          showCopy
        >
          <code>code</code>
        </CodeSurface>,
      );
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
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

    it("renders no header at all with nothing to put in it", () => {
      // What a multi-file example asks for: its file tabs already name the
      // file and its toolbar already carries the actions, so a bar here would
      // be an empty ~31px band of border and background above the code.
      const { container } = render(
        <CodeSurface raw="a" variant="example">
          <pre>a</pre>
        </CodeSurface>,
      );
      expect(container.querySelector("div.border-b")).toBeNull();
      expect(container.textContent).toBe("a");
    });
  });

  describe("example variant, height set (truncation)", () => {
    it("reports no overflow, and draws no fade, when content fits", () => {
      stubScrollMetrics(400, 480); // content shorter than the box
      const onOverflowChange = vi.fn();
      const { container } = render(
        <CodeSurface
          raw="a\nb"
          filename="a.ts"
          variant="example"
          height={480}
          onOverflowChange={onOverflowChange}
        >
          <pre>short</pre>
        </CodeSurface>,
      );
      expect(onOverflowChange).toHaveBeenCalledWith(false, expect.any(Number));
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });

    it("draws the fade and reports overflow when content overflows", () => {
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

      expect(
        container.querySelector('[aria-hidden="true"]'),
      ).toBeInTheDocument();
      expect(onOverflowChange).toHaveBeenCalledWith(true, expect.any(Number));
    });

    it("drops the fade once expanded — there is nothing left below the fold", () => {
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

  // Attribute guard only — jsdom reports this button focusable with or
  // without the attribute, so it cannot demonstrate the Safari bug. It exists
  // to stop the "redundant tabIndex on a <button>" cleanup that reintroduces
  // it. Real Tab presses in WebKit: e2e/example-tab-order.spec.ts. Rationale:
  // ../tabbable.ts.
  it("keeps Copy explicitly tabbable, for WebKit", () => {
    render(
      <CodeSurface raw="hello" variant="fence" showCopy>
        <code>hello</code>
      </CodeSurface>,
    );
    expect(screen.getByRole("button", { name: /copy/i })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });
});

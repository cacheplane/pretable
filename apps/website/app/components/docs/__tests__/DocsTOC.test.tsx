import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DocsTOC } from "../DocsTOC";

class IO {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", IO);
});

describe("DocsTOC", () => {
  it("renders headings as links", () => {
    render(<DocsTOC headings={[{ depth: 2, text: "A", slug: "a" }]} />);
    expect(screen.getByRole("link", { name: "A" })).toHaveAttribute(
      "href",
      "#a",
    );
  });
  it("returns null for empty headings", () => {
    const { container } = render(<DocsTOC headings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

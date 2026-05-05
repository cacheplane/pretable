import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsPrevNext } from "../DocsPrevNext";

describe("DocsPrevNext", () => {
  it("renders both links when given prev and next", () => {
    render(
      <DocsPrevNext
        prev={{ title: "A", href: "/docs/a" }}
        next={{ title: "C", href: "/docs/c" }}
      />,
    );
    expect(screen.getByRole("link", { name: /A/ })).toHaveAttribute(
      "href",
      "/docs/a",
    );
    expect(screen.getByRole("link", { name: /C/ })).toHaveAttribute(
      "href",
      "/docs/c",
    );
  });
  it("renders nothing when both are null", () => {
    const { container } = render(<DocsPrevNext prev={null} next={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

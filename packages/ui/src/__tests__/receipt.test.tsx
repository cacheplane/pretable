import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Receipt } from "../receipt";

describe("Receipt", () => {
  it("renders an inline <span> with class pt-receipt and the given content", () => {
    const { container } = render(<Receipt>60fps</Receipt>);
    const span = container.querySelector("span.pt-receipt");
    expect(span).toBeInTheDocument();
    expect(span).toHaveTextContent("60fps");
  });

  it("accepts and merges a custom className", () => {
    const { container } = render(<Receipt className="custom">500k</Receipt>);
    const span = container.querySelector("span.pt-receipt");
    expect(span).toHaveClass("pt-receipt", "custom");
  });
});

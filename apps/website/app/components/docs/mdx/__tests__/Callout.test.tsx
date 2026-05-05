import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Callout } from "../Callout";

describe("Callout", () => {
  it("renders children inside a region", () => {
    render(<Callout type="note">hello</Callout>);
    expect(screen.getByRole("note")).toHaveTextContent("hello");
  });
  it("supports tip/warning/info/check types", () => {
    for (const type of ["tip", "warning", "info", "check"] as const) {
      const { unmount } = render(<Callout type={type}>x</Callout>);
      expect(screen.getByRole("note")).toBeInTheDocument();
      unmount();
    }
  });
});

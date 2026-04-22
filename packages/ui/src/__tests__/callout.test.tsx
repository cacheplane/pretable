import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Callout } from "../callout";

describe("Callout", () => {
  it("renders with the default variant (class pt-callout, no variant modifier)", () => {
    const { container } = render(
      <Callout tag="Requirements">React 18.3+</Callout>,
    );
    const root = container.querySelector("div.pt-callout");
    expect(root).toBeInTheDocument();
    expect(root).not.toHaveClass("pt-callout-warn");
    expect(screen.getByText("Requirements")).toHaveClass("pt-callout-tag");
    expect(screen.getByText("React 18.3+")).toBeInTheDocument();
  });

  it("applies the warn variant modifier when variant='warn'", () => {
    const { container } = render(
      <Callout variant="warn" tag="Watch out">
        Something
      </Callout>,
    );
    const root = container.querySelector("div.pt-callout");
    expect(root).toHaveClass("pt-callout", "pt-callout-warn");
  });

  it("renders children without requiring a tag", () => {
    render(<Callout>Just a body</Callout>);
    expect(screen.getByText("Just a body")).toBeInTheDocument();
    expect(screen.queryByText(/^(Requirements|Watch)/)).toBeNull();
  });

  it("exposes role='note' for assistive technologies", () => {
    render(<Callout>Supplementary info</Callout>);
    expect(screen.getByRole("note")).toHaveTextContent("Supplementary info");
  });

  it("keeps role='note' for the warn variant (not role='alert')", () => {
    render(<Callout variant="warn">A persistent warning</Callout>);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

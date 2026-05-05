import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Frame } from "../Frame";

describe("Frame", () => {
  it("renders children with optional caption", () => {
    render(
      <Frame caption="A demo">
        <span>inner</span>
      </Frame>,
    );
    expect(screen.getByText("inner")).toBeInTheDocument();
    expect(screen.getByText("A demo")).toBeInTheDocument();
  });
  it("omits caption when not provided", () => {
    render(
      <Frame>
        <span>inner</span>
      </Frame>,
    );
    expect(screen.getByText("inner")).toBeInTheDocument();
  });
});

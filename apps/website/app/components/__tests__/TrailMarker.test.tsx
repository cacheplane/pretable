import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrailMarker } from "../TrailMarker";

describe("TrailMarker", () => {
  it("renders the green-circle variant with role=img and accessible label", () => {
    render(<TrailMarker variant="green" label="Beginner" />);
    const marker = screen.getByRole("img", { name: "Beginner" });
    expect(marker).toBeInTheDocument();
    expect(marker.tagName.toLowerCase()).toBe("svg");
  });

  it("renders the blue-square variant", () => {
    render(<TrailMarker variant="blue" label="Intermediate" />);
    expect(
      screen.getByRole("img", { name: "Intermediate" }),
    ).toBeInTheDocument();
  });

  it("renders the black-diamond variant", () => {
    render(<TrailMarker variant="black" label="Advanced" />);
    expect(screen.getByRole("img", { name: "Advanced" })).toBeInTheDocument();
  });

  it("renders the double-black-diamond variant", () => {
    render(<TrailMarker variant="double-black" label="Expert" />);
    expect(screen.getByRole("img", { name: "Expert" })).toBeInTheDocument();
  });
});

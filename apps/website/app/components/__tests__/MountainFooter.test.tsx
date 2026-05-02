import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MountainFooter } from "../MountainFooter";

describe("MountainFooter", () => {
  it("renders the Cascade silhouette with role=img and accessible name", () => {
    render(<MountainFooter />);
    expect(
      screen.getByRole("img", { name: /cascade range silhouette/i }),
    ).toBeInTheDocument();
  });

  it("renders the 'Built in Bend, OR.' caption", () => {
    const { container } = render(<MountainFooter />);
    const caption = container.querySelector("p");
    expect(caption).toBeInTheDocument();
    expect(caption).toHaveTextContent(/built in bend, or\./i);
  });
});

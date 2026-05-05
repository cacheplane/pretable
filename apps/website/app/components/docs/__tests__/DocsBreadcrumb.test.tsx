import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsBreadcrumb } from "../DocsBreadcrumb";

describe("DocsBreadcrumb", () => {
  it("renders group + title", () => {
    render(<DocsBreadcrumb group="Grid" title="Pretable component" />);
    expect(screen.getByText(/Grid/)).toBeInTheDocument();
    expect(screen.getByText(/Pretable component/)).toBeInTheDocument();
  });
});

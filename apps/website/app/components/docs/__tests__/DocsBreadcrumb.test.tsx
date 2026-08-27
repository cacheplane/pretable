// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocsBreadcrumb, getDocsBreadcrumbItems } from "../DocsBreadcrumb";

describe("DocsBreadcrumb", () => {
  it("renders labels from the same ordered items used by structured data", () => {
    const items = getDocsBreadcrumbItems({
      path: "/docs/grid/pretable-component",
      title: "Pretable component",
    });

    render(
      <DocsBreadcrumb
        path="/docs/grid/pretable-component"
        title="Pretable component"
      />,
    );

    expect(items).toEqual([
      { name: "Grid", path: "/docs/grid" },
      {
        name: "Pretable component",
        path: "/docs/grid/pretable-component",
      },
    ]);
    expect(screen.getByText(/Grid/)).toBeInTheDocument();
    expect(screen.getByText(/Pretable component/)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { docsNav } from "../../../docs/_nav";
import { DocsBreadcrumb, getDocsBreadcrumbItems } from "../DocsBreadcrumb";

describe("DocsBreadcrumb", () => {
  it.each(
    docsNav.map((section) => ({
      sectionTitle: section.title,
      root: section.items[0],
    })),
  )(
    "renders $sectionTitle section roots as one breadcrumb item",
    ({ sectionTitle, root }) => {
      if (!root) throw new Error(`Missing root item for ${sectionTitle}`);
      const items = getDocsBreadcrumbItems({
        path: root.href,
        title: root.title,
      });

      const { container } = render(
        <DocsBreadcrumb path={root.href} title={root.title} />,
      );

      expect(items).toEqual([{ name: sectionTitle, path: root.href }]);
      expect(container.textContent).toBe(sectionTitle);
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    },
  );

  it("renders nested labels from the same ordered items used by structured data", () => {
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

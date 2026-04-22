import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Nav } from "../nav";

describe("Nav", () => {
  it("renders the wordmark as 'pretable.' with an amber period span", () => {
    const { container } = render(<Nav active="playground" />);
    const brand = container.querySelector(".pt-nav-brand");
    expect(brand).toBeInTheDocument();
    expect(brand).toHaveTextContent("pretable.");
    const caret = container.querySelector(".pt-nav-brand .pt-nav-caret");
    expect(caret).toBeInTheDocument();
    expect(caret).toHaveTextContent(".");
  });

  it("renders the version pill when version prop is provided", () => {
    render(<Nav active="playground" version="0.4" />);
    expect(screen.getByText("v")).toBeInTheDocument();
    expect(screen.getByText("0.4")).toBeInTheDocument();
  });

  it("renders three standard links with the active one marked", () => {
    const { container } = render(<Nav active="bench" />);
    const links = Array.from(container.querySelectorAll(".pt-nav-link"));
    expect(links).toHaveLength(4); // playground, bench, docs, github
    const active = container.querySelector(".pt-nav-link.active");
    expect(active).toHaveTextContent(/bench/i);
  });

  it("renders the search trigger and invokes onSearchClick when clicked", () => {
    const onSearchClick = vi.fn();
    render(<Nav active="docs" onSearchClick={onSearchClick} />);
    const search = screen.getByRole("button", {
      name: /search the docs/i,
    });
    fireEvent.click(search);
    expect(onSearchClick).toHaveBeenCalledOnce();
  });

  it("renders the GitHub stars count when githubStars is provided", () => {
    render(<Nav active="playground" githubStars={1234} />);
    expect(screen.getByText("1.2k")).toBeInTheDocument();
  });

  it("renders the CTA button when cta is provided", () => {
    render(
      <Nav
        active="playground"
        cta={{ label: "Try playground →", href: "/" }}
      />,
    );
    const cta = screen.getByRole("link", { name: /try playground/i });
    expect(cta).toHaveAttribute("href", "/");
    expect(cta).toHaveClass("pt-nav-cta");
  });
});

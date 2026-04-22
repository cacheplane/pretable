import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Footer } from "../footer";

describe("Footer", () => {
  it("renders wordmark, version, and copyright in the left cell", () => {
    const { container } = render(<Footer version="0.4" ciStatus="green" />);
    const left = container.querySelector(".pt-footer-left");
    expect(left).toBeInTheDocument();
    expect(left).toHaveTextContent("pretable");
    expect(left).toHaveTextContent("0.4");
    expect(left).toHaveTextContent(/MIT/);
  });

  it("renders the CI status dot with green class when ciStatus='green'", () => {
    const { container } = render(<Footer version="0.4" ciStatus="green" />);
    const dot = container.querySelector(".pt-footer-ci");
    expect(dot).toHaveClass("pt-footer-ci-green");
  });

  it("renders the CI status dot with red class when ciStatus='red'", () => {
    const { container } = render(<Footer version="0.4" ciStatus="red" />);
    const dot = container.querySelector(".pt-footer-ci");
    expect(dot).toHaveClass("pt-footer-ci-red");
  });

  it("renders provided links in the right cell", () => {
    render(
      <Footer
        version="0.4"
        ciStatus="green"
        links={[
          { label: "github ↗", href: "https://github.com/cacheplane/pretable" },
          { label: "rss", href: "/rss.xml" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "github ↗" })).toHaveAttribute(
      "href",
      "https://github.com/cacheplane/pretable",
    );
    expect(screen.getByRole("link", { name: "rss" })).toHaveAttribute(
      "href",
      "/rss.xml",
    );
  });
});

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NavBar } from "../NavBar";

describe("NavBar", () => {
  describe("mode='site'", () => {
    it("renders brand + Docs + GitHub, no close button", () => {
      render(<NavBar mode="site" />);
      expect(screen.getByText(/pretable\.ai/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /docs/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /github/i })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /show the grid/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("mode='drawer'", () => {
    it("renders anchors + Docs + GitHub + close button", () => {
      const onClose = () => {};
      render(<NavBar mode="drawer" onClose={onClose} />);
      expect(screen.getByText(/pretable\.ai/i)).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /receipts/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /compare/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /show the grid/i }),
      ).toBeInTheDocument();
    });
  });
});

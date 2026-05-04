import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NavBar } from "../NavBar";

afterEach(() => {
  sessionStorage.clear();
});

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

    it("brand href is '/' by default", () => {
      render(<NavBar mode="site" />);
      const brand = screen.getByRole("link", { name: /pretable\.ai/i });
      expect(brand.getAttribute("href")).toBe("/");
    });

    it("brand href becomes '/#receipts' after mount when sessionStorage flag is set", async () => {
      sessionStorage.setItem("pretable:lastDrawer", "open");
      render(<NavBar mode="site" />);
      const brand = screen.getByRole("link", { name: /pretable\.ai/i });
      // Wait a microtask for useEffect to run.
      await Promise.resolve();
      expect(brand.getAttribute("href")).toBe("/#receipts");
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

    it("clicking the brand calls onClose and prevents navigation", () => {
      let closed = false;
      const onClose = () => {
        closed = true;
      };
      render(<NavBar mode="drawer" onClose={onClose} />);
      const brand = screen.getByRole("link", { name: /pretable\.ai/i });
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      brand.dispatchEvent(event);
      expect(closed).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    });
  });
});

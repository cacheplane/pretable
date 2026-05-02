import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Drawer } from "../Drawer";
import { DrawerHandle } from "../DrawerHandle";

describe("Drawer", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-drawer");
    history.replaceState({}, "", "/");
  });

  it("renders children inside a region with accessible label", () => {
    render(
      <Drawer>
        <p>Marketing content</p>
      </Drawer>,
    );
    expect(
      screen.getByRole("region", { name: /more about pretable/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Marketing content")).toBeInTheDocument();
  });

  it("renders a close button labelled Close", () => {
    render(<Drawer>x</Drawer>);
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });
});

describe("DrawerHandle", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-drawer");
  });

  it("renders an aria-expanded button labelled 'Learn more'", () => {
    render(<DrawerHandle />);
    const handle = screen.getByRole("button", { name: /learn more/i });
    expect(handle).toHaveAttribute("aria-expanded", "false");
  });

  it("flips aria-expanded after click", () => {
    Object.defineProperty(window, "innerWidth", { value: 1440, writable: true });
    render(<DrawerHandle />);
    const handle = screen.getByRole("button", { name: /learn more/i });
    fireEvent.click(handle);
    expect(handle).toHaveAttribute("aria-expanded", "true");
  });
});

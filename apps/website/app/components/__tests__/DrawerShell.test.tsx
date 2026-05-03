import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ControlStateProvider } from "../heroGrid/controlState";
import { DrawerShell } from "../DrawerShell";

describe("DrawerShell", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-drawer");
    history.replaceState({}, "", "/");
  });

  it("renders the handle as a clickable button", () => {
    render(
      <ControlStateProvider>
        <DrawerShell>content</DrawerShell>
      </ControlStateProvider>,
    );
    expect(
      screen.getByRole("button", { name: /why pretable/i }),
    ).toBeInTheDocument();
  });

  it("renders the drawer-content region with children", () => {
    render(
      <ControlStateProvider>
        <DrawerShell>
          <p>Section A</p>
        </DrawerShell>
      </ControlStateProvider>,
    );
    expect(screen.getByText("Section A")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /more about pretable/i }),
    ).toBeInTheDocument();
  });

  it("opens the drawer when handle is clicked", () => {
    render(
      <ControlStateProvider>
        <DrawerShell>x</DrawerShell>
      </ControlStateProvider>,
    );
    Object.defineProperty(window, "innerWidth", {
      value: 1440,
      writable: true,
    });
    fireEvent.click(screen.getByRole("button", { name: /why pretable/i }));
    expect(document.documentElement.getAttribute("data-drawer")).toBe("open");
  });
});

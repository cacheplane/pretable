import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DrawerHandle } from "../DrawerHandle";
import { DrawerShell } from "../DrawerShell";
import { ControlStateProvider } from "../heroGrid/controlState";

describe("DrawerShell", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-drawer");
    history.replaceState({}, "", "/");
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

  it("opens the drawer when sibling handle is clicked", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 1440,
      writable: true,
    });
    render(
      <ControlStateProvider>
        <DrawerHandle />
        <DrawerShell>content</DrawerShell>
      </ControlStateProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /why pretable/i }));
    expect(document.documentElement.getAttribute("data-drawer")).toBe("open");
  });
});

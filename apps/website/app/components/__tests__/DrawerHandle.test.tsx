import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { DrawerHandle } from "../DrawerHandle";
import { DrawerShell } from "../DrawerShell";
import { ControlStateProvider } from "../heroGrid/controlState";

const renderHandle = () =>
  render(
    <ControlStateProvider>
      <DrawerHandle />
      <DrawerShell>content</DrawerShell>
    </ControlStateProvider>,
  );

const handle = () => screen.getByRole("button", { name: /why pretable/i });

describe("DrawerHandle", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-drawer");
    history.replaceState({}, "", "/");
    sessionStorage.clear();
  });

  it("reports aria-expanded='false' while the drawer is closed", () => {
    renderHandle();
    expect(handle()).toHaveAttribute("aria-expanded", "false");
  });

  it("reports aria-expanded='true' once the drawer is open", () => {
    renderHandle();
    fireEvent.click(handle());
    expect(handle()).toHaveAttribute("aria-expanded", "true");
  });

  it("returns to aria-expanded='false' when the drawer closes again", () => {
    renderHandle();
    fireEvent.click(handle());
    expect(handle()).toHaveAttribute("aria-expanded", "true");

    // Escape is one of the real close paths (NavBar's close button and browser
    // back are the others); the handle itself is open-only.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(handle()).toHaveAttribute("aria-expanded", "false");
  });

  it("controls the drawer-content region it points at", () => {
    renderHandle();
    expect(handle()).toHaveAttribute("aria-controls", "drawer-content");
    expect(document.getElementById("drawer-content")).not.toBeNull();
  });

  it("reports data-hydrated='false' in the server-rendered markup", () => {
    // The SSR contract the e2e `openDrawer` helper waits on: the handle paints
    // from this markup with no click handler attached, and says so.
    const html = renderToStaticMarkup(
      <ControlStateProvider>
        <DrawerHandle />
      </ControlStateProvider>,
    );
    expect(html).toContain('data-hydrated="false"');
  });

  it("reports data-hydrated='true' once mounted on the client", () => {
    renderHandle();
    expect(handle()).toHaveAttribute("data-hydrated", "true");
  });

  it("is open-only: clicking again while open leaves it open", () => {
    renderHandle();
    fireEvent.click(handle());
    fireEvent.click(handle());
    expect(handle()).toHaveAttribute("aria-expanded", "true");
    expect(document.documentElement.getAttribute("data-drawer")).toBe("open");
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ControlStateProvider } from "../heroGrid/controlState";
import { useDrawer } from "../useDrawer";

const wrapper = ({ children }: { children: React.ReactNode }) =>
  ControlStateProvider({ children });

describe("useDrawer", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1440,
    });
  });

  afterEach(() => {
    history.replaceState({}, "", "/");
    document.documentElement.removeAttribute("data-drawer");
    sessionStorage.clear();
  });

  it("starts closed and writes data-drawer='closed' on the html element when wide enough", () => {
    renderHook(() => useDrawer(), { wrapper });
    expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
  });

  it("upgrades regardless of viewport width", () => {
    Object.defineProperty(window, "innerWidth", { value: 320, writable: true });
    renderHook(() => useDrawer(), { wrapper });
    expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
  });

  it("open() flips data-drawer to 'open' and pushes history state", () => {
    const { result } = renderHook(() => useDrawer(), { wrapper });
    const pushSpy = vi.spyOn(history, "pushState");
    act(() => result.current.open());
    expect(document.documentElement.getAttribute("data-drawer")).toBe("open");
    expect(pushSpy).toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  it("close() flips data-drawer back to 'closed'", () => {
    const { result } = renderHook(() => useDrawer(), { wrapper });
    act(() => result.current.open());
    act(() => result.current.close());
    expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
  });

  it("opens automatically when location.hash matches a drawer section on mount", () => {
    history.replaceState({}, "", "/#receipts");
    renderHook(() => useDrawer(), { wrapper });
    expect(document.documentElement.getAttribute("data-drawer")).toBe("open");
  });

  it("closes on Escape key", () => {
    const { result } = renderHook(() => useDrawer(), { wrapper });
    act(() => result.current.open());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
  });

  it("open() writes pretable:lastDrawer='open' to sessionStorage", () => {
    const { result } = renderHook(() => useDrawer(), { wrapper });
    act(() => result.current.open());
    expect(sessionStorage.getItem("pretable:lastDrawer")).toBe("open");
  });

  it("close() clears pretable:lastDrawer from sessionStorage", () => {
    const { result } = renderHook(() => useDrawer(), { wrapper });
    act(() => result.current.open());
    act(() => result.current.close());
    expect(sessionStorage.getItem("pretable:lastDrawer")).toBeNull();
  });

  it("hash-on-mount auto-open also writes the flag", () => {
    history.replaceState({}, "", "/#receipts");
    renderHook(() => useDrawer(), { wrapper });
    expect(sessionStorage.getItem("pretable:lastDrawer")).toBe("open");
  });
});

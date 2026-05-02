import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDrawer } from "../useDrawer";

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
  });

  it("starts closed and writes data-drawer='closed' on the html element when wide enough", () => {
    renderHook(() => useDrawer());
    expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
  });

  it("does not write data-drawer when viewport is narrower than 768px (mobile fallback)", () => {
    Object.defineProperty(window, "innerWidth", { value: 600 });
    renderHook(() => useDrawer());
    expect(document.documentElement.getAttribute("data-drawer")).toBeNull();
  });

  it("open() flips data-drawer to 'open' and pushes history state", () => {
    const { result } = renderHook(() => useDrawer());
    const pushSpy = vi.spyOn(history, "pushState");
    act(() => result.current.open());
    expect(document.documentElement.getAttribute("data-drawer")).toBe("open");
    expect(pushSpy).toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  it("close() flips data-drawer back to 'closed'", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.open());
    act(() => result.current.close());
    expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
  });

  it("opens automatically when location.hash matches a drawer section on mount", () => {
    history.replaceState({}, "", "/#receipts");
    renderHook(() => useDrawer());
    expect(document.documentElement.getAttribute("data-drawer")).toBe("open");
  });

  it("closes on Escape key", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.open());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.documentElement.getAttribute("data-drawer")).toBe("closed");
  });
});

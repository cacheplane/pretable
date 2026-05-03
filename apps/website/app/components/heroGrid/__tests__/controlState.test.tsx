import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ControlStateProvider, useControlState } from "../controlState";

describe("controlState", () => {
  it("defaults to ratePerSec=1000, isPaused=false, isDrawerOpen=false", () => {
    const { result } = renderHook(() => useControlState(), {
      wrapper: ({ children }) => (
        <ControlStateProvider>{children}</ControlStateProvider>
      ),
    });
    expect(result.current.ratePerSec).toBe(1000);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.isDrawerOpen).toBe(false);
    expect(result.current.isPlaying).toBe(true);
  });

  it("setRatePerSec updates rate", () => {
    const { result } = renderHook(() => useControlState(), {
      wrapper: ({ children }) => (
        <ControlStateProvider>{children}</ControlStateProvider>
      ),
    });
    act(() => result.current.setRatePerSec(5000));
    expect(result.current.ratePerSec).toBe(5000);
  });

  it("isPlaying is false when isPaused is true", () => {
    const { result } = renderHook(() => useControlState(), {
      wrapper: ({ children }) => (
        <ControlStateProvider>{children}</ControlStateProvider>
      ),
    });
    act(() => result.current.setIsPaused(true));
    expect(result.current.isPlaying).toBe(false);
  });

  it("isPlaying is false when isDrawerOpen is true", () => {
    const { result } = renderHook(() => useControlState(), {
      wrapper: ({ children }) => (
        <ControlStateProvider>{children}</ControlStateProvider>
      ),
    });
    act(() => result.current.setIsDrawerOpen(true));
    expect(result.current.isPlaying).toBe(false);
  });
});

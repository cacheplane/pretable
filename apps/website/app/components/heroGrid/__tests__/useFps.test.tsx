import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFps } from "../useFps";

describe("useFps", () => {
  let now = 0;
  let rafCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    now = 0;
    rafCallbacks = [];
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return 1 as unknown as number;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns 60 by default before any frames", () => {
    const { result } = renderHook(() => useFps());
    expect(result.current).toBe(60);
  });

  it("computes ~60 fps from 60 frames at ~16.67ms each", () => {
    const { result } = renderHook(() => useFps());
    act(() => {
      for (let i = 0; i < 60; i++) {
        now += 1000 / 60;
        const cb = rafCallbacks[i];
        if (cb) cb(now);
      }
    });
    expect(result.current).toBeGreaterThanOrEqual(58);
    expect(result.current).toBeLessThanOrEqual(62);
  });
});

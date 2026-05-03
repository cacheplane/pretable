import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFrameStats } from "../useFrameStats";

describe("useFrameStats", () => {
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

  it("returns fps=60 and p95Ms=0 by default before any frames", () => {
    const { result } = renderHook(() => useFrameStats());
    expect(result.current.fps).toBe(60);
    expect(result.current.p95Ms).toBe(0);
  });

  it("computes ~60 fps from 60 frames at ~16.67ms each", () => {
    const { result } = renderHook(() => useFrameStats());
    act(() => {
      for (let i = 0; i < 60; i++) {
        now += 1000 / 60;
        const cb = rafCallbacks[i];
        if (cb) cb(now);
      }
    });
    expect(result.current.fps).toBeGreaterThanOrEqual(58);
    expect(result.current.fps).toBeLessThanOrEqual(62);
  });

  it("computes p95Ms from a steady 60fps window (~16.67ms)", () => {
    const { result } = renderHook(() => useFrameStats());
    act(() => {
      for (let i = 0; i < 60; i++) {
        now += 1000 / 60;
        const cb = rafCallbacks[i];
        if (cb) cb(now);
      }
    });
    expect(result.current.p95Ms).toBeGreaterThan(15);
    expect(result.current.p95Ms).toBeLessThan(18);
  });

  it("p95Ms reflects the slowest 5% of frames", () => {
    const { result } = renderHook(() => useFrameStats());
    act(() => {
      // 57 fast frames at 16ms, then 3 slow frames at 50ms
      for (let i = 0; i < 57; i++) {
        now += 16;
        const cb = rafCallbacks[i];
        if (cb) cb(now);
      }
      for (let i = 57; i < 60; i++) {
        now += 50;
        const cb = rafCallbacks[i];
        if (cb) cb(now);
      }
    });
    // p95 should land in the slow tail (>= 50ms)
    expect(result.current.p95Ms).toBeGreaterThanOrEqual(50);
  });

  it("p95Ms stays 0 until at least 20 samples accumulate", () => {
    const { result } = renderHook(() => useFrameStats());
    act(() => {
      // Push 10 frames with a 250ms+ gap to force one publish
      for (let i = 0; i < 10; i++) {
        now += 30;
        const cb = rafCallbacks[i];
        if (cb) cb(now);
      }
    });
    expect(result.current.p95Ms).toBe(0);
  });
});

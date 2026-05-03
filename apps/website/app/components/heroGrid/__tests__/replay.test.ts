import { describe, expect, it, vi } from "vitest";

import { heroEventLog } from "../eventLog";
import { createHeroReplay } from "../replay";

describe("createHeroReplay", () => {
  it("emits events at the configured rate", () => {
    const onEmit = vi.fn();
    const replay = createHeroReplay({ ratePerSec: 100, onEmit });
    replay.tickAtMs(0);
    replay.tickAtMs(1000); // one second of emissions
    expect(onEmit).toHaveBeenCalledTimes(100);
  });

  it("loops the source array", () => {
    const onEmit = vi.fn();
    const replay = createHeroReplay({ ratePerSec: 100, onEmit });
    replay.tickAtMs(0);
    replay.tickAtMs(60_000); // 60 sec at 100/sec = 6,000 emissions
    expect(onEmit).toHaveBeenCalledTimes(6000);
    const first = onEmit.mock.calls[0]?.[0];
    const looped = onEmit.mock.calls[heroEventLog.length]?.[0];
    expect(first?.kind).toEqual(looped?.kind);
  });

  it("can change rate mid-stream via setRate", () => {
    const onEmit = vi.fn();
    const replay = createHeroReplay({ ratePerSec: 100, onEmit });
    replay.tickAtMs(0);
    replay.tickAtMs(1000); // 100 emissions at 100/sec
    expect(onEmit).toHaveBeenCalledTimes(100);
    replay.setRate(500);
    onEmit.mockClear();
    replay.tickAtMs(2000); // 1s at 500/sec = 500 emissions
    expect(onEmit).toHaveBeenCalledTimes(500);
  });

  it("is pausable and resumable without emitting backlog", () => {
    const onEmit = vi.fn();
    const replay = createHeroReplay({ ratePerSec: 100, onEmit });
    replay.tickAtMs(0);
    replay.tickAtMs(1000);
    expect(onEmit).toHaveBeenCalledTimes(100);
    replay.pause(1000);
    onEmit.mockClear();
    replay.tickAtMs(2000); // 1s of pause — no emissions
    expect(onEmit).not.toHaveBeenCalled();
    replay.resume(2000);
    replay.tickAtMs(2500); // 0.5s after resume = 50 emissions
    expect(onEmit).toHaveBeenCalledTimes(50);
  });
});

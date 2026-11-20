import { afterEach, expect, it, vi } from "vitest";
import { createAcceptanceDeadline } from "../acceptance-deadline";
afterEach(() => vi.useRealTimers());
it.each([1, 2, 5, 6])(
  "cleans deadline ownership when guard call %i throws",
  (throwAt) => {
    vi.useFakeTimers();
    let calls = 0;
    const expire = vi.fn();
    const owner = new AbortController();
    const remove = vi.spyOn(owner.signal, "removeEventListener");
    const deadline = createAcceptanceDeadline(
      owner.signal,
      {
        at: 100,
        clock: {
          now: () => 0,
          setTimeout: (fn, delay) => setTimeout(fn, delay),
          clearTimeout: (handle) =>
            clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
      },
      () => {
        if (++calls === throwAt) throw new Error("clock");
        return true;
      },
      expire,
    );
    if (calls < throwAt) vi.advanceTimersByTime(100);
    expect(deadline.current()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalled();
    expect(expire).toHaveBeenCalledTimes(1);
  },
);

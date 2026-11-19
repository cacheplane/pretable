import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteScheduler, type RemotePriority } from "../scheduler";
import { createRemoteSessionController } from "../session";
import { createDeferredProvider } from "./fixtures/provider";
import {
  capabilities,
  query,
  range,
  session,
  type Row,
  type Columns,
} from "./fixtures/responses";
import type { PretableRemoteResult } from "../types";

function deferred<T = number>() {
  let resolve!: (value: PretableRemoteResult<T>) => void;
  const promise = new Promise<PretableRemoteResult<T>>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const ok = { ok: true, value: 1 } as const;
const transient = { ok: false, error: { code: "transient" } } as const;
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function demand(
  key: string,
  priority: RemotePriority = "visible",
  signal = new AbortController().signal,
) {
  return { kind: "read" as const, generation: 1, key, priority, signal };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe("bounded remote scheduling", () => {
  it("dispatches focused, visible, overscan, prefetch in order", async () => {
    const s = createRemoteScheduler({ maxActive: 1 });
    const block = deferred();
    void s.schedule(demand("block"), () => block.promise);
    const order: string[] = [];
    const promises = (
      ["prefetch", "overscan", "visible", "focused"] as const
    ).map((p) =>
      s.schedule(demand(p, p), async () => {
        order.push(p);
        return ok;
      }),
    );
    expect(s.getSnapshot()).toMatchObject({ active: 1, queued: 4 });
    block.resolve(ok);
    await Promise.all(promises);
    expect(order).toEqual(["focused", "visible", "overscan", "prefetch"]);
    expect(s.getSnapshot()).toMatchObject({
      active: 0,
      queued: 0,
      subscribers: 0,
      timers: 0,
    });
  });
  it("holds all four physical permits through timeout until real settlement", async () => {
    const s = createRemoteScheduler();
    const waits = Array.from({ length: 4 }, () => deferred());
    const results = waits.map((d, i) =>
      s.schedule(demand(String(i)), () => d.promise),
    );
    const queued = vi.fn(async () => ok);
    const next = s.schedule(demand("next"), queued);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await Promise.all(results)).toEqual(
      Array(4).fill({ ok: false, error: { code: "timeout" } }),
    );
    expect(await next).toEqual({ ok: false, error: { code: "timeout" } });
    expect(queued).not.toHaveBeenCalled();
    expect(s.getSnapshot()).toMatchObject({
      active: 4,
      stalled: 4,
      queued: 0,
      timers: 0,
    });
    waits[0]!.resolve(ok);
    await tick();
    expect(s.getSnapshot().active).toBe(3);
    s.dispose();
    expect(s.getSnapshot()).toMatchObject({
      active: 3,
      stalled: 3,
      disposed: true,
      subscribers: 0,
    });
  });
  it("refuses a full queue and allows visible demand to displace prefetch", async () => {
    const s = createRemoteScheduler({ maxActive: 1, maxQueued: 1 });
    const block = deferred();
    void s.schedule(demand("block"), () => block.promise);
    const never = vi.fn(async () => ok);
    const prefetch = s.schedule(demand("old", "prefetch"), never);
    expect(
      await s.schedule(demand("refused", "prefetch"), never),
    ).toMatchObject({ ok: false, error: { code: "cancelled" } });
    const latest = s.schedule(demand("latest"), async () => ok);
    expect(await prefetch).toMatchObject({ ok: false });
    expect(never).not.toHaveBeenCalled();
    block.resolve(ok);
    expect(await latest).toEqual(ok);
  });
  it("dedupes subscribers without letting one abort another", async () => {
    const s = createRemoteScheduler();
    const d = deferred();
    const a = new AbortController(),
      b = new AbortController();
    let shared!: { readonly aborted: boolean };
    const run = vi.fn((signal) => {
      shared = signal;
      return d.promise;
    });
    const pa = s.schedule(demand("same", "prefetch", a.signal), run);
    const pb = s.schedule(demand("same", "focused", b.signal), run);
    a.abort();
    expect(await pa).toMatchObject({ ok: false });
    expect(shared.aborted).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    d.resolve(ok);
    expect(await pb).toEqual(ok);
  });
  it("does not dedupe aborted physical jobs or different generations", async () => {
    const s = createRemoteScheduler();
    const a = new AbortController();
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const old = s.schedule(demand("same", "visible", a.signal), run);
    a.abort();
    await old;
    void s.schedule(demand("same"), run);
    void s.schedule({ ...demand("same"), generation: 2 }, run);
    expect(run).toHaveBeenCalledTimes(3);
    s.dispose();
  });
  it("replaces scoped scroll demand and updates retained priorities", async () => {
    const s = createRemoteScheduler({ maxActive: 1 });
    const d = deferred();
    void s.schedule(demand("block"), () => d.promise);
    const run = vi.fn(async () => ok);
    const old = s.schedule({ ...demand("old"), scope: "viewport" }, run);
    const kept = s.schedule(
      { ...demand("kept", "prefetch"), scope: "viewport" },
      run,
    );
    s.replaceDemand("viewport", [{ ...demand("kept", "focused") }]);
    expect(await old).toMatchObject({ ok: false });
    expect(s.getSnapshot().queued).toBe(1);
    d.resolve(ok);
    await kept;
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("retries only transient failures twice using deterministic bounded backoff", async () => {
    const s = createRemoteScheduler({ jitterSeed: 1 });
    const times: number[] = [];
    const result = s.schedule(demand("retry"), async () => {
      times.push(Date.now());
      return transient;
    });
    await vi.runAllTimersAsync();
    expect(await result).toEqual(transient);
    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(250);
    expect(times[1]! - times[0]!).toBeLessThanOrEqual(300);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(1000);
    expect(times[2]! - times[1]!).toBeLessThanOrEqual(1200);
    expect(s.getSnapshot()).toMatchObject({ active: 0, queued: 0, timers: 0 });
  });
  it("respects retry-after and the overall deadline", async () => {
    const s = createRemoteScheduler();
    const run = vi.fn(
      async () =>
        ({
          ok: false,
          error: { code: "transient", retryAfterMs: 40_000 },
        }) as const,
    );
    const result = s.schedule(demand("retry"), run);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({
      ok: false,
      error: { code: "timeout" },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it.each([
    "invalid-response",
    "unsupported-query",
    "consistency",
    "cancelled",
    "expired",
    "timeout",
    "invalid-query",
  ] as const)("never retries %s", async (code) => {
    const s = createRemoteScheduler();
    const run = vi.fn(async () => ({ ok: false, error: { code } }) as const);
    expect(await s.schedule(demand(code), run)).toEqual({
      ok: false,
      error: { code },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("normalizes malformed envelopes without executing accessors", async () => {
    const s = createRemoteScheduler();
    const getter = vi.fn(() => "transient");
    const result = await s.schedule(
      demand("bad"),
      async () =>
        ({
          ok: false,
          error: Object.defineProperty({}, "code", { get: getter }),
        }) as never,
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-response" },
    });
    expect(getter).not.toHaveBeenCalled();
  });
  it("delivers late results to retained hooks and caps stalled subscriber ownership", async () => {
    const s = createRemoteScheduler({ maxSubscribers: 2 });
    const d = deferred();
    const late = vi.fn();
    const a = new AbortController();
    const first = s.schedule(
      { ...demand("one", "visible", a.signal), onLateResult: late },
      () => d.promise,
    );
    a.abort();
    await first;
    void s.schedule(
      { ...demand("two"), onLateResult: late },
      () => new Promise(() => {}),
    );
    expect(await s.schedule(demand("three"), async () => ok)).toMatchObject({
      ok: false,
    });
    d.resolve({ ok: false, error: { code: "unauthorized", scope: "session" } });
    await tick();
    expect(late).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot().subscribers).toBe(1);
    s.dispose();
  });
  it("cleans queued cancellation listeners and disposal timers", async () => {
    const s = createRemoteScheduler({ maxActive: 1 });
    const d = deferred();
    void s.schedule(demand("active"), () => d.promise);
    const a = new AbortController();
    const remove = vi.spyOn(a.signal, "removeEventListener");
    const run = vi.fn(async () => ok);
    const p = s.schedule(demand("queued", "visible", a.signal), run);
    a.abort();
    await p;
    expect(remove).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    s.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(s.getSnapshot()).toMatchObject({ queued: 0, subscribers: 0 });
  });
});

describe("scheduler session integration", () => {
  async function setup() {
    const transport = createDeferredProvider<Row, Columns>(capabilities);
    const scheduler = createRemoteScheduler();
    const controller = createRemoteSessionController(transport.provider, {
      rootRangeSize: 2,
      invoke: scheduler.schedule,
    });
    const ready = controller.setQuery(query);
    transport.opens[0]!.resolve({
      ok: true,
      value: { ...session, queryKey: transport.opens[0]!.request.queryKey },
    });
    await tick();
    transport.reads[0]!.resolve({
      ok: true,
      value: { ...range(0, 2), ...transport.reads[0]!.request },
    });
    await ready;
    return { ...transport, scheduler, controller };
  }
  it.each(["timeout", "supersession"] as const)(
    "preserves late authorization after %s",
    async (mode) => {
      const f = await setup();
      const pending = f.controller.read([], 2, 4);
      if (mode === "timeout") await vi.advanceTimersByTimeAsync(30_000);
      else void f.controller.read([], 2, 4);
      await pending;
      expect(f.reads[1]!.signal.aborted).toBe(true);
      expect(f.controller.getSnapshot().view).toBeDefined();
      f.reads[1]!.resolve({
        ok: false,
        error: { code: "unauthorized", scope: "session" },
      });
      await tick();
      expect(f.controller.getSnapshot()).toMatchObject({
        state: "error",
        error: { code: "unauthorized", scope: "session" },
      });
      expect(f.controller.getSnapshot().view).toBeUndefined();
      f.controller.dispose();
      f.scheduler.dispose();
    },
  );
  it("releases late successful opens after timeout", async () => {
    const f = createDeferredProvider<Row, Columns>(capabilities);
    const scheduler = createRemoteScheduler();
    const controller = createRemoteSessionController(f.provider, {
      rootRangeSize: 2,
      invoke: scheduler.schedule,
    });
    const pending = controller.setQuery(query);
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    f.opens[0]!.resolve({
      ok: true,
      value: { ...session, queryKey: f.opens[0]!.request.queryKey },
    });
    await tick();
    expect(f.released).toHaveLength(1);
    expect(f.reads).toHaveLength(0);
  });
  it("does not exceed queued bounds when a retry settles into a full queue", async () => {
    const s = createRemoteScheduler({ maxActive: 1, maxQueued: 1 });
    const d = deferred();
    const first = s.schedule(demand("first"), () => d.promise);
    const second = s.schedule(demand("second"), async () => ok);
    d.resolve(transient);
    await tick();
    expect(await first).toEqual(transient);
    expect(await second).toEqual(ok);
    expect(s.getSnapshot()).toMatchObject({ queued: 0, timers: 0 });
  });
});

describe("callback ownership and diagnostics", () => {
  it("rechecks subscriber admission after a reentrant clock callback", async () => {
    let entered = false;
    const d = deferred();
    const s = createRemoteScheduler({
      maxSubscribers: 1,
      clock: {
        now: () => {
          if (!entered) {
            entered = true;
            void s.schedule(demand("same"), () => d.promise);
          }
          return 0;
        },
        setTimeout: (f, ms) => setTimeout(f, ms),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
    });
    const outer = s.schedule(demand("same"), () => d.promise);
    expect(s.getSnapshot().subscribers).toBe(1);
    expect(await outer).toEqual({ ok: false, error: { code: "cancelled" } });
    s.dispose();
  });
  it("keeps backoff jobs inside the queue bound", async () => {
    const s = createRemoteScheduler({ maxActive: 1, maxQueued: 1 });
    const p = s.schedule(demand("retry"), async () => transient);
    await tick();
    expect(s.getSnapshot()).toMatchObject({ active: 0, queued: 1, timers: 2 });
    expect(await s.schedule(demand("another"), async () => ok)).toEqual({
      ok: false,
      error: { code: "cancelled" },
    });
    s.dispose();
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("survives synchronous provider throws and reentrant disposal", async () => {
    const s = createRemoteScheduler();
    let calls = 0;
    const p = s.schedule(demand("throw"), () => {
      calls++;
      if (calls === 1) throw new Error();
      s.dispose();
      return Promise.resolve(ok);
    });
    await vi.runAllTimersAsync();
    expect(await p).toEqual({ ok: false, error: { code: "cancelled" } });
    expect(s.getSnapshot()).toMatchObject({
      active: 0,
      queued: 0,
      subscribers: 0,
      timers: 0,
    });
  });
  it("isolates throwing late observers and does not retry authorization", async () => {
    const s = createRemoteScheduler();
    const d = deferred();
    const a = new AbortController();
    const p = s.schedule(
      {
        ...demand("auth", "visible", a.signal),
        onLateResult: () => {
          throw new Error();
        },
      },
      () => d.promise,
    );
    a.abort();
    await p;
    d.resolve({ ok: false, error: { code: "unauthorized", scope: "session" } });
    await tick();
    const run = vi.fn(
      async () =>
        ({
          ok: false,
          error: { code: "unauthorized", scope: "range" },
        }) as const,
    );
    await s.schedule(demand("denied"), run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot()).toMatchObject({
      active: 0,
      queued: 0,
      subscribers: 0,
    });
  });
  it("refuses work safely if the injected clock throws", async () => {
    const run = vi.fn(async () => ok);
    const s = createRemoteScheduler({
      clock: {
        now: () => {
          throw new Error();
        },
        setTimeout: () => {
          throw new Error();
        },
        clearTimeout: () => {},
      },
    });
    expect(await s.schedule(demand("clock"), run)).toEqual({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("deadline and priority edge cases", () => {
  it("caps enormous retry-after timers at the overall deadline", async () => {
    const delays: number[] = [];
    const s = createRemoteScheduler({
      clock: {
        now: Date.now,
        setTimeout: (f, ms) => {
          delays.push(ms);
          return setTimeout(f, ms);
        },
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
    });
    const p = s.schedule(demand("huge"), async () => ({
      ok: false,
      error: { code: "transient", retryAfterMs: Number.MAX_VALUE },
    }));
    await tick();
    expect(delays.every((ms) => ms <= 30_000)).toBe(true);
    s.dispose();
    await p;
  });
  it("removes cancelled focused subscriber priority from shared queued work", async () => {
    const s = createRemoteScheduler({ maxActive: 1 });
    const d = deferred();
    const a = new AbortController();
    const order: string[] = [];
    void s.schedule(demand("block"), () => d.promise);
    const shared = s.schedule(demand("shared", "prefetch"), async () => {
      order.push("prefetch");
      return ok;
    });
    const focus = s.schedule(
      demand("shared", "focused", a.signal),
      async () => ok,
    );
    const visible = s.schedule(demand("visible"), async () => {
      order.push("visible");
      return ok;
    });
    a.abort();
    await focus;
    d.resolve(ok);
    await Promise.all([shared, visible]);
    expect(order).toEqual(["visible", "prefetch"]);
  });
});

it("assigns root reads the focused priority tier", async () => {
  const s = createRemoteScheduler({ maxActive: 1 });
  const d = deferred();
  const order: string[] = [];
  void s.schedule(demand("block"), () => d.promise);
  const visible = s.schedule(demand("visible"), async () => {
    order.push("visible");
    return ok;
  });
  const root = s.schedule(
    { ...demand("root"), priority: undefined, root: true },
    async () => {
      order.push("root");
      return ok;
    },
  );
  d.resolve(ok);
  await Promise.all([root, visible]);
  expect(order).toEqual(["root", "visible"]);
});

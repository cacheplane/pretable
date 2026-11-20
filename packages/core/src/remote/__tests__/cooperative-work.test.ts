import { afterEach, expect, it, vi } from "vitest";
import { prepareCooperatively } from "../cooperative-work";

afterEach(() => vi.useRealTimers());
it("yields actual tasks after a bounded number of preparation steps", async () => {
  vi.useFakeTimers();
  let work = 0;
  function* steps() {
    for (let i = 0; i < 2050; i++) {
      work++;
      yield;
    }
    return "ready";
  }
  const owner = new AbortController();
  const pending = prepareCooperatively(steps(), owner.signal, () => true);
  expect(work).toBe(1024);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(work).toBe(1024);
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({ ok: true, value: "ready" });
  expect(work).toBe(2050);
});
it("cancels the continuation and drops generator references immediately on abort", async () => {
  vi.useFakeTimers();
  let released = false,
    work = 0;
  function* steps() {
    try {
      for (;;) {
        work++;
        yield;
      }
    } finally {
      released = true;
    }
  }
  const owner = new AbortController();
  const pending = prepareCooperatively(steps(), owner.signal, () => true);
  owner.abort();
  expect(await pending).toEqual({ ok: false });
  expect(released).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  await vi.runAllTimersAsync();
  expect(work).toBe(1024);
});
it("discards a superseded owner before the next slice", async () => {
  vi.useFakeTimers();
  let current = true,
    work = 0;
  function* steps() {
    for (;;) {
      work++;
      yield;
    }
  }
  const pending = prepareCooperatively(
    steps(),
    new AbortController().signal,
    () => current,
  );
  current = false;
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({ ok: false });
  expect(work).toBe(1024);
});
it("stops when cancellation reenters a preparation step", async () => {
  vi.useFakeTimers();
  const owner = new AbortController();
  let work = 0,
    released = false;
  function* steps() {
    try {
      for (;;) {
        work++;
        owner.abort();
        yield;
      }
    } finally {
      released = true;
    }
  }
  expect(await prepareCooperatively(steps(), owner.signal, () => true)).toEqual(
    { ok: false },
  );
  expect(work).toBe(1);
  expect(released).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("serializes acceptance and promptly drops aborted queued builders", async () => {
  const { createPreparationQueue } = await import("../cooperative-work");
  const queue = createPreparationQueue();
  const first = new AbortController(),
    second = new AbortController();
  let finish!: () => void;
  const order: number[] = [];
  const a = queue(
    first.signal,
    () =>
      new Promise<void>((resolve) => {
        order.push(1);
        finish = resolve;
      }),
  );
  const b = queue(second.signal, async () => {
    order.push(2);
  });
  const c = queue(first.signal, async () => {
    order.push(3);
  });
  expect(order).toEqual([1]);
  second.abort();
  await b;
  expect(order).toEqual([1]);
  finish();
  await Promise.all([a, c]);
  expect(order).toEqual([1, 3]);
});

it("copies wire data cooperatively without exposing a partial mutable result", async () => {
  vi.useFakeTimers();
  const { snapshotWireSteps, snapshotWire } =
    await import("../validate-response");
  const input = Array.from({ length: 2000 }, (_, value) => ({ value }));
  const pending = prepareCooperatively(
    snapshotWireSteps(input),
    new AbortController().signal,
    () => true,
  );
  await vi.runAllTimersAsync();
  const answer = await pending;
  expect(answer.ok).toBe(true);
  if (answer.ok) {
    expect(answer.value).toEqual(snapshotWire(input));
    expect(Object.isFrozen(answer.value)).toBe(true);
    expect(Object.isFrozen(answer.value[0])).toBe(true);
  }
});
it("detects a returned response changed while its properties are being copied", async () => {
  vi.useFakeTimers();
  const { snapshotWireSteps } = await import("../validate-response");
  const input = Object.fromEntries(
    Array.from({ length: 2000 }, (_, i) => [String(i), i]),
  );
  const pending = prepareCooperatively(
    snapshotWireSteps(input),
    new AbortController().signal,
    () => true,
  );
  const rejected = expect(pending).rejects.toMatchObject({
    code: "invalid-response",
  });
  input["0"] = -1;
  await vi.runAllTimersAsync();
  await rejected;
});

it("stages complete response validation without retaining partial evidence", async () => {
  vi.useFakeTimers();
  const { createResponseValidator } = await import("../validate-response");
  const { query, session } = await import("./fixtures/responses");
  const accepted = { ...session, rootCount: 2000 };
  const validator = createResponseValidator(query, accepted);
  const request = { ...accepted, route: [], start: 0, end: 2000 };
  const response = {
    ...request,
    siblingCount: 2000,
    entries: Array.from({ length: 2000 }, (_, id) => ({
      kind: "leaf" as const,
      id,
      row: { value: id },
    })),
  };
  const owner = new AbortController();
  const pending = validator.acceptRangeCooperatively(
    request,
    response,
    owner.signal,
    () => true,
  );
  expect(validator.retention().nodes).toBe(0);
  await vi.runAllTimersAsync();
  expect((await pending)?.ok).toBe(true);
  expect(validator.retention().nodes).toBe(0);
});

it("cancels cooperative summary copies without retaining aggregate evidence", async () => {
  vi.useFakeTimers();
  const { createResponseValidator } = await import("../validate-response");
  const { groupedQuery, session, summary, aggregate } =
    await import("./fixtures/responses");
  const validator = createResponseValidator(groupedQuery, session);
  const value = {
    ...summary(),
    values: {
      sum: { ...aggregate(), value: Array.from({ length: 2000 }, (_, i) => i) },
    },
  };
  const owner = new AbortController();
  const pending = validator.acceptSummaryCooperatively(
    "filtered",
    value,
    owner.signal,
    () => true,
  );
  owner.abort();
  expect(await pending).toBeUndefined();
  expect(validator.retention().summaries).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("counts JSON wire bytes incrementally with exact escaping and undefined semantics", async () => {
  vi.useFakeTimers();
  const { wireBytesSteps, wireBytes } = await import("../wire-cost");
  const value = {
    missing: undefined,
    zero: -0,
    text: "😀\ud800\n\u0000".repeat(50000),
    nested: [undefined, null, { quote: '\\"' }],
  };
  const pending = prepareCooperatively(
    wireBytesSteps(value),
    new AbortController().signal,
    () => true,
  );
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({ ok: true, value: wireBytes(value) });
});

it("shares one work budget across promise continuations in the same processing task", async () => {
  vi.useFakeTimers();
  const { createPreparationBudget } = await import("../cooperative-work");
  const budget = createPreparationBudget();
  const owner = new AbortController();
  let first = 0,
    second = 0;
  function* a() {
    for (let i = 0; i < 600; i++) {
      first++;
      yield;
    }
  }
  function* b() {
    for (let i = 0; i < 600; i++) {
      second++;
      yield;
    }
  }
  await prepareCooperatively(a(), owner.signal, () => true, budget);
  const pending = prepareCooperatively(b(), owner.signal, () => true, budget);
  expect(first).toBe(600);
  expect(second).toBe(424);
  await vi.runAllTimersAsync();
  await pending;
  expect(second).toBe(600);
});

it("shares task credit across consecutive response jobs instead of resetting on promises", async () => {
  vi.useFakeTimers();
  const { createPreparationQueue } = await import("../cooperative-work");
  const queue = createPreparationQueue();
  const owner = new AbortController();
  let work = 0;
  function* steps() {
    for (let i = 0; i < 600; i++) {
      work++;
      yield;
    }
  }
  await queue(owner.signal, async (budget) => {
    await prepareCooperatively(steps(), owner.signal, () => true, budget);
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const pending = queue(owner.signal, async (budget) => {
    await prepareCooperatively(steps(), owner.signal, () => true, budget);
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(work).toBe(1024);
  await vi.runAllTimersAsync();
  await pending;
  expect(work).toBe(1200);
});

it("compares retained wire evidence cooperatively without serializing a second full signature", async () => {
  vi.useFakeTimers();
  const { equalWireSteps } = await import("../wire-equality");
  const owner = new AbortController();
  const a = {
    values: Array.from({ length: 3000 }, (_, i) => ({
      i,
      z: -0,
      u: undefined,
    })),
  };
  const b = {
    values: Array.from({ length: 3000 }, (_, i) => ({
      u: undefined,
      z: -0,
      i,
    })),
  };
  const pending = prepareCooperatively(
    equalWireSteps(a, b),
    owner.signal,
    () => true,
  );
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({ ok: true, value: true });
  const zero = prepareCooperatively(
    equalWireSteps({ z: -0 }, { z: 0 }),
    owner.signal,
    () => true,
  );
  const missing = prepareCooperatively(
    equalWireSteps({ u: undefined }, {}),
    owner.signal,
    () => true,
  );
  expect(await zero).toEqual({ ok: true, value: false });
  expect(await missing).toEqual({ ok: true, value: false });
});

it("charges undefined-valued own keys and stops an oversized copy before retaining all properties", async () => {
  vi.useFakeTimers();
  const { snapshotWireSteps } = await import("../validate-response");
  const { wireBytes } = await import("../wire-cost");
  const value = Object.fromEntries(
    Array.from({ length: 5000 }, (_, i) => [
      `${i}:${"x".repeat(100)}`,
      undefined,
    ]),
  );
  expect(wireBytes(value)).toBeGreaterThan(1_000_000);
  const pending = prepareCooperatively(
    snapshotWireSteps(value, 2048),
    new AbortController().signal,
    () => true,
  );
  const rejected = expect(pending).rejects.toMatchObject({
    name: "ResponseCapacityError",
  });
  await vi.runAllTimersAsync();
  await rejected;
});

it("closes prepared containers if the ownership guard throws", async () => {
  vi.useFakeTimers();
  try {
    let closed = false,
      checks = 0;
    const steps = (function* () {
      try {
        for (let i = 0; i < 2000; i++) yield;
      } finally {
        closed = true;
      }
    })();
    const pending = prepareCooperatively(
      steps,
      new AbortController().signal,
      () => {
        if (++checks > 1) throw new Error("guard");
        return true;
      },
    );
    const failed = expect(pending).rejects.toThrow("guard");
    await vi.runAllTimersAsync();
    await failed;
    expect(closed).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

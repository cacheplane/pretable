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

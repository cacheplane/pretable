import type { RemoteInvocation } from "./session";
import type { PretableRemoteResult, PretableRemoteSignal } from "./types";
import { validateRemoteResult } from "./validate-response";

export type RemotePriority = "focused" | "visible" | "overscan" | "prefetch";
export interface RemoteDemand extends RemoteInvocation {
  readonly priority?: RemotePriority;
  readonly scope?: string;
}
export interface RemoteSchedulerClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}
interface Options {
  /** Undefined waits for capacity; false refuses permanently. Release runs after physical settlement and acceptance. */
  readonly acquire?: (demand: RemoteDemand) => (() => void) | false | undefined;
  readonly maxActive?: number;
  readonly maxQueued?: number;
  readonly maxSubscribers?: number;
  readonly deadlineMs?: number;
  readonly jitterSeed?: number;
  readonly clock?: RemoteSchedulerClock;
}
const ranks: Record<RemotePriority, number> = {
  focused: 0,
  visible: 1,
  overscan: 2,
  prefetch: 3,
};
const cancelled = Object.freeze({
  ok: false,
  error: Object.freeze({ code: "cancelled" }),
} as const);
const timeout = Object.freeze({
  ok: false,
  error: Object.freeze({ code: "timeout" }),
} as const);
type Result = PretableRemoteResult<unknown>;

/** One scheduler per model/controller. Keys are private, not telemetry. Physical
 * permits track invoked promises, including providers that ignore cancellation. */
export function createRemoteScheduler(options: Options = {}) {
  const maxActive = options.maxActive ?? 4;
  const maxQueued = options.maxQueued ?? 64;
  const maxSubscribers = options.maxSubscribers ?? 256;
  const deadlineMs = options.deadlineMs ?? 30_000;
  for (const n of [maxActive, maxQueued, maxSubscribers, deadlineMs]) {
    if (!Number.isSafeInteger(n) || n < 1)
      throw new Error("invalid scheduler limit");
  }
  if (deadlineMs > 2_147_483_647) throw new Error("invalid scheduler deadline");
  const clock: RemoteSchedulerClock = options.clock ?? {
    now: () => performance.now(),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let seed = (options.jitterSeed ?? 1) >>> 0;
  let disposed = false,
    pumping = false,
    sequence = 0,
    subscriberCount = 0;
  interface Subscriber {
    demand: RemoteDemand;
    resolve: (result: Result) => void;
    abort: () => void;
    done: boolean;
  }
  interface Job {
    id: string;
    order: number;
    priority: number;
    subscribers: Set<Subscriber>;
    controller: AbortController;
    run: (signal: PretableRemoteSignal) => Promise<Result>;
    finalizeDiscarded?: (value: unknown) => void;
    attempts: number;
    releaseIngress?: () => void;
    active: boolean;
    closed: boolean;
    ready: boolean;
    timers: Set<unknown>;
    deadline: number;
    deadlineArmed: boolean;
  }
  const jobs = new Set<Job>();
  const dedupe = new Map<string, Job>();
  const identity = (d: Pick<RemoteInvocation, "generation" | "kind" | "key">) =>
    JSON.stringify([d.generation, d.kind, d.key]);
  const priority = (d: RemoteDemand) =>
    ranks[d.priority ?? (d.kind === "open" || d.root ? "focused" : "visible")];
  const queued = () => [...jobs].filter((j) => !j.closed && !j.active);
  const activeCount = () => [...jobs].filter((j) => j.active).length;
  function safe(callback: () => void) {
    try {
      callback();
    } catch {
      /* External callbacks cannot interrupt ownership cleanup. */
    }
  }
  function clearTimers(j: Job) {
    const timers = [...j.timers];
    j.timers.clear();
    for (const timer of timers) safe(() => clock.clearTimeout(timer));
  }
  function removeSubscriber(j: Job, s: Subscriber) {
    if (j.subscribers.delete(s)) subscriberCount--;
  }
  function stageSubscriber(j: Job, s: Subscriber, result: Result): () => void {
    if (s.done) return () => {};
    s.done = true;
    // Only physically pending work can have a late authorization result.
    if (!j.active || !s.demand.onLateResult) removeSubscriber(j, s);
    s.resolve(result);
    const signal = s.demand.signal;
    return () => safe(() => signal.removeEventListener("abort", s.abort));
  }
  function close(j: Job, result: Result) {
    if (j.closed) return;
    j.closed = true;
    if (dedupe.get(j.id) === j) dedupe.delete(j.id);
    if (!j.active) jobs.delete(j);
    // Settle every owner before external timer/listener cleanup can reenter
    // dispose and erase records. Promise reactions run after this transition.
    const cleanup = [...j.subscribers].map((s) =>
      stageSubscriber(j, s, result),
    );
    clearTimers(j);
    for (const removeListener of cleanup) removeListener();
    safe(() => j.controller.abort());
    pump();
  }
  function timer(j: Job, delay: number, callback: () => void) {
    let handle: unknown;
    try {
      handle = clock.setTimeout(() => {
        j.timers.delete(handle);
        if (!j.closed && !disposed) callback();
      }, delay);
    } catch {
      close(j, cancelled);
      return;
    }
    if (j.closed || disposed) safe(() => clock.clearTimeout(handle));
    else j.timers.add(handle);
  }
  function remainingTime(j: Job): number | undefined {
    if (j.closed || disposed) return;
    let now: number;
    try {
      now = clock.now();
    } catch {
      close(j, cancelled);
      return;
    }
    if (j.closed || disposed) return;
    if (!Number.isFinite(now)) {
      close(j, cancelled);
      return;
    }
    const remaining = j.deadline - now;
    if (remaining <= 0) {
      close(j, timeout);
      return;
    }
    return remaining;
  }
  function withinDeadline(j: Job, delay: number, callback: () => void) {
    const remaining = remainingTime(j);
    if (remaining !== undefined) timer(j, Math.min(delay, remaining), callback);
  }
  function settled(j: Job, raw: unknown) {
    // Authority subscribers can be detached on disposal; the physical job owns
    // its resource finalizer until settlement, independently of those records.
    const subscribers = [...j.subscribers];
    const result = validateRemoteResult<unknown>(raw);
    remainingTime(j);
    // Deadline closure precedes late authority delivery. Keep physical ownership
    // until these callbacks finish so reentrancy cannot spend this permit twice.
    for (const s of subscribers) {
      if (!s.done) continue;
      removeSubscriber(j, s);
      if (!result.ok && !disposed) safe(() => s.demand.onLateResult?.(result));
    }
    // A success is discarded only if no live consumer can receive it. One
    // cancelled deduped subscriber must not release another owner's resource.
    if (result.ok) {
      const finalize = j.finalizeDiscarded;
      j.finalizeDiscarded = undefined;
      if (j.closed || disposed) safe(() => finalize?.(result.value));
    }
    const releaseIngress = j.releaseIngress;
    j.releaseIngress = undefined;
    if (releaseIngress) {
      const finish = () => {
        safe(releaseIngress);
        pump();
      };
      const acceptance =
        !j.closed &&
        !disposed &&
        !(
          !result.ok &&
          result.error.code === "transient" &&
          j.attempts < 3 &&
          queued().length <= maxQueued
        )
          ? subscribers
              .filter((s) => !s.done)
              .map((s) => s.demand.acceptanceDone)
              .filter(Boolean)
          : [];
      if (acceptance.length) void Promise.all(acceptance).then(finish, finish);
      else finish();
    }
    j.active = false;
    if (j.closed || disposed) {
      j.finalizeDiscarded = undefined;
      jobs.delete(j);
      for (const s of [...j.subscribers]) removeSubscriber(j, s);
      pump();
      return;
    }
    if (
      !result.ok &&
      result.error.code === "transient" &&
      j.attempts < 3 &&
      queued().length <= maxQueued
    ) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const base = j.attempts === 1 ? 250 : 1000;
      const delay = Math.max(
        base + Math.floor((seed / 0x100000000) * base * 0.2),
        result.error.retryAfterMs ?? 0,
      );
      j.ready = false;
      withinDeadline(j, delay, () => {
        j.ready = true;
        pump();
      });
    } else close(j, result);
    pump();
  }
  function pump() {
    if (pumping || disposed) return;
    pumping = true;
    try {
      while (!disposed && activeCount() < maxActive) {
        const j = queued()
          .filter((candidate) => candidate.ready)
          .sort((a, b) => a.priority - b.priority || a.order - b.order)[0];
        if (!j) break;
        if (remainingTime(j) === undefined) continue;
        // The clock may cancel, dispose, or replace demand. Selection and
        // ownership must still refer to this queued job after that callback.
        if (
          disposed ||
          j.closed ||
          j.active ||
          !j.ready ||
          dedupe.get(j.id) !== j
        )
          continue;
        if (options.acquire) {
          let release: (() => void) | false | undefined;
          try {
            release = options.acquire(
              [...j.subscribers].find((s) => !s.done)!.demand,
            );
          } catch {
            close(j, cancelled);
            continue;
          }
          if (release === false) {
            close(j, cancelled);
            continue;
          }
          if (!release) break;
          if (disposed || j.closed || dedupe.get(j.id) !== j) {
            safe(release);
            continue;
          }
          j.releaseIngress = release;
        }
        j.active = true;
        j.attempts++;
        let result: Promise<Result>;
        try {
          result = j.run(j.controller.signal);
        } catch {
          result = Promise.resolve({ ok: false, error: { code: "transient" } });
        }
        void Promise.resolve(result).then(
          (value) => settled(j, value),
          () => settled(j, { ok: false, error: { code: "transient" } }),
        );
      }
    } finally {
      pumping = false;
    }
  }
  function schedule<T>(
    demand: RemoteDemand,
    run: (signal: PretableRemoteSignal) => Promise<PretableRemoteResult<T>>,
  ): Promise<PretableRemoteResult<T>> {
    if (disposed || demand.signal.aborted || subscriberCount >= maxSubscribers)
      return Promise.resolve(cancelled);
    const id = identity(demand);
    let j = dedupe.get(id);
    if (!j) {
      let now: number;
      try {
        now = clock.now();
      } catch {
        return Promise.resolve(cancelled);
      }
      if (disposed || demand.signal.aborted || !Number.isFinite(now))
        return Promise.resolve(cancelled);
      // Clock callbacks may reenter scheduling; reread current ownership.
      j = dedupe.get(id);
      if (!j) {
        if (queued().length >= maxQueued && activeCount() >= maxActive) {
          const worst = queued().sort(
            (a, b) => b.priority - a.priority || a.order - b.order,
          )[0];
          if (!worst || worst.priority <= priority(demand))
            return Promise.resolve(cancelled);
          close(worst, cancelled);
        }
        if (
          disposed ||
          demand.signal.aborted ||
          subscriberCount >= maxSubscribers
        )
          return Promise.resolve(cancelled);
        j = dedupe.get(id);
        if (!j) {
          // A reentrant abort callback may have filled the space just freed.
          if (queued().length >= maxQueued) return Promise.resolve(cancelled);
          j = {
            id,
            order: sequence++,
            priority: priority(demand),
            subscribers: new Set(),
            controller: new AbortController(),
            run,
            finalizeDiscarded: demand.onDiscardedResult,
            attempts: 0,
            active: false,
            closed: false,
            ready: true,
            timers: new Set(),
            deadline: now + deadlineMs,
            deadlineArmed: false,
          };
          jobs.add(j);
          dedupe.set(id, j);
        }
      }
    }
    if (disposed || demand.signal.aborted || subscriberCount >= maxSubscribers)
      return Promise.resolve(cancelled);
    const job = j;
    try {
      demand.onDeadline?.({ at: job.deadline, clock });
    } catch {
      if (!job.subscribers.size) close(job, cancelled);
      return Promise.resolve(cancelled);
    }
    if (disposed || job.closed || demand.signal.aborted) {
      if (!job.subscribers.size) close(job, cancelled);
      return Promise.resolve(cancelled);
    }
    const promise = new Promise<Result>((resolve) => {
      const s: Subscriber = {
        demand,
        resolve,
        done: false,
        abort: () => {
          const cleanup = stageSubscriber(job, s, cancelled);
          const remaining = [...job.subscribers].filter(
            (subscriber) => !subscriber.done,
          );
          if (!remaining.length) close(job, cancelled);
          else
            job.priority = Math.min(
              ...remaining.map((subscriber) => priority(subscriber.demand)),
            );
          cleanup();
        },
      };
      job.subscribers.add(s);
      subscriberCount++;
      job.priority = Math.min(job.priority, priority(demand));
      try {
        demand.signal.addEventListener("abort", s.abort, { once: true });
      } catch {
        s.abort();
      }
      if (demand.signal.aborted || disposed) s.abort();
    });
    if (!job.closed && !job.deadlineArmed) {
      job.deadlineArmed = true;
      withinDeadline(job, deadlineMs, () => close(job, timeout));
    }
    pump();
    return promise as Promise<PretableRemoteResult<T>>;
  }
  return {
    schedule,
    wake: pump,
    /** Replace only a named viewport's demand. No inferred row geometry. */
    replaceDemand(
      scope: string,
      demands: readonly Pick<
        RemoteDemand,
        "generation" | "kind" | "key" | "priority"
      >[],
    ) {
      const wanted = new Map(demands.map((d) => [identity(d), d.priority]));
      for (const j of [...jobs]) {
        for (const s of [...j.subscribers]) {
          if (s.done || s.demand.scope !== scope) continue;
          if (!wanted.has(j.id)) s.abort();
          else s.demand = { ...s.demand, priority: wanted.get(j.id) };
        }
        const remaining = [...j.subscribers].filter((s) => !s.done);
        if (remaining.length)
          j.priority = Math.min(...remaining.map((s) => priority(s.demand)));
      }
      pump();
    },
    getSnapshot() {
      const active = activeCount();
      return Object.freeze({
        disposed,
        active,
        queued: queued().length,
        stalled: [...jobs].filter((j) => j.active && j.closed).length,
        subscribers: subscriberCount,
        dedupeEntries: dedupe.size,
        timers: [...jobs].reduce((n, j) => n + j.timers.size, 0),
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const j of [...jobs]) {
        close(j, cancelled);
        for (const s of [...j.subscribers]) removeSubscriber(j, s);
      }
    },
  };
}
